import "server-only";

import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont, PDFPage, RGB } from "pdf-lib";
import { z } from "zod";

import { validateGeneratedPdf } from "@/lib/applications/pdf-validation";
import { getMaterialsModel, getOpenAIClient } from "@/lib/ai/openai";
import { brand } from "@/lib/brand";
import { recordQuotaEvent } from "@/lib/quota/quota-events";
import {
  parseResumeContent,
  resumeContentSchema,
  type ResumeContent,
} from "@/lib/resumes/resume-content";
import { createClient } from "@/lib/supabase/server";

export const MASTER_RESUME_PROMPT_VERSION = "master-resume.v1";
const GENERATED_ARTIFACT_BUCKET = "generated-artifacts";
const PDF_SIGNED_URL_TTL_SECONDS = 10 * 60;

export const generateMasterResumeSchema = z.object({
  instruction: z.string().trim().min(3).max(500).optional(),
});

export const updateMasterResumeSchema = z.object({
  resume: resumeContentSchema,
});

type ConfirmedFact = {
  confidence: number | null;
  fact_type: string;
  fact_value: string;
};

type ProfileRecord = {
  display_name: string | null;
  headline: string | null;
  id: string;
  summary: string | null;
  target_direction: string | null;
  target_level: string | null;
};

type ResumeRow = {
  content_json: unknown;
  id: string;
  model: string | null;
  pdf_storage_path: string | null;
  prompt_version: string | null;
  status: string;
  updated_at: string;
};

export type MasterResumeOverview = {
  canGenerate: boolean;
  confirmedFactCount: number;
  latestResume: {
    content: ResumeContent;
    id: string;
    model: string | null;
    pdfDownloadUrl: string | null;
    promptVersion: string | null;
    status: string;
    updatedAt: string;
  } | null;
  missingEvidence: string[];
  readinessNote: string;
};

export type GenerateMasterResumeResult = {
  overview: MasterResumeOverview;
  resumeId: string;
  summary: string;
};

export async function getMasterResumeOverview(userId: string): Promise<MasterResumeOverview> {
  const supabase = await createClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, target_direction, target_level")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError) {
    throw new Error("PROFILE_READ_FAILED");
  }

  if (!profile) {
    return buildEmptyOverview({
      confirmedFactCount: 0,
      latestResume: null,
      missingEvidence: ["Add profile evidence", "Choose a target direction"],
    });
  }

  const [{ data: facts, error: factsError }, { data: latestResume, error: resumeError }] =
    await Promise.all([
      supabase
        .from("profile_facts")
        .select("fact_type, fact_value, confidence")
        .eq("profile_id", profile.id)
        .eq("user_id", userId)
        .order("confidence", { ascending: false })
        .limit(80),
      supabase
        .from("generated_resumes")
        .select("id, content_json, pdf_storage_path, status, prompt_version, model, updated_at")
        .eq("profile_id", profile.id)
        .eq("user_id", userId)
        .eq("resume_type", "master")
        .is("application_id", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (factsError) {
    throw new Error("PROFILE_FACTS_READ_FAILED");
  }

  if (resumeError) {
    throw new Error("MASTER_RESUME_READ_FAILED");
  }

  return buildOverview({
    confirmedFacts: facts ?? [],
    latestResume,
    profile,
  });
}

export async function generateMasterResume(
  input: z.input<typeof generateMasterResumeSchema> = {},
): Promise<GenerateMasterResumeResult> {
  const parsed = generateMasterResumeSchema.parse(input);
  const { supabase, userId } = await getAuthenticatedContext();
  const { profile, confirmedFacts } = await readMasterResumeContext(userId);
  const missingEvidence = readMissingEvidence({ confirmedFacts, profile });

  if (missingEvidence.length > 0) {
    throw new Error("MASTER_RESUME_CONTEXT_TOO_THIN");
  }

  const model = getMaterialsModel();
  const response = await getOpenAIClient().responses.create({
    model,
    instructions: buildMasterResumeInstructions(),
    input: buildMasterResumeInput({
      confirmedFacts,
      instruction: parsed.instruction,
      profile,
    }),
    max_output_tokens: 1700,
    metadata: {
      feature: "master_resume",
      profile_id: profile.id,
      prompt_version: MASTER_RESUME_PROMPT_VERSION,
    },
    safety_identifier: hashUserId(userId),
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "master_resume",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: [
            "headline",
            "summary",
            "skills",
            "experienceBullets",
            "keywordGaps",
            "reviewerNotes",
          ],
          properties: {
            headline: { type: "string" },
            summary: { type: "string" },
            skills: {
              type: "array",
              maxItems: 24,
              items: { type: "string" },
            },
            experienceBullets: {
              type: "array",
              maxItems: 14,
              items: { type: "string" },
            },
            keywordGaps: {
              type: "array",
              maxItems: 16,
              items: { type: "string" },
            },
            reviewerNotes: {
              type: "array",
              maxItems: 8,
              items: { type: "string" },
            },
          },
        },
      },
      verbosity: "medium",
    },
  });

  if (response.error || response.incomplete_details) {
    throw new Error("AI_MASTER_RESUME_FAILED");
  }

  const resume = resumeContentSchema.parse(JSON.parse(response.output_text));
  const { data: generatedResume, error: resumeError } = await supabase
    .from("generated_resumes")
    .insert({
      user_id: userId,
      profile_id: profile.id,
      application_id: null,
      resume_type: "master",
      prompt_version: MASTER_RESUME_PROMPT_VERSION,
      model,
      content_json: resume,
      status: "draft",
    })
    .select("id")
    .single();

  if (resumeError || !generatedResume) {
    throw new Error("MASTER_RESUME_SAVE_FAILED");
  }

  await recordQuotaEvent({
    eventType: "generation_created",
    metadata: {
      model,
      prompt_version: MASTER_RESUME_PROMPT_VERSION,
      resume_id: generatedResume.id,
    },
    resourceId: generatedResume.id,
    resourceType: "master_resume",
  });

  return {
    overview: await getMasterResumeOverview(userId),
    resumeId: generatedResume.id,
    summary: `Generated a master resume draft from ${confirmedFacts.length} profile signal${confirmedFacts.length === 1 ? "" : "s"}.`,
  };
}

export async function updateMasterResume(
  input: z.input<typeof updateMasterResumeSchema>,
): Promise<MasterResumeOverview> {
  const parsed = updateMasterResumeSchema.parse(input);
  const { supabase, userId } = await getAuthenticatedContext();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .single();

  if (profileError || !profile) {
    throw new Error("PROFILE_NOT_FOUND");
  }

  const { data: latestResume, error: resumeReadError } = await supabase
    .from("generated_resumes")
    .select("id")
    .eq("profile_id", profile.id)
    .eq("user_id", userId)
    .eq("resume_type", "master")
    .is("application_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (resumeReadError) {
    throw new Error("MASTER_RESUME_READ_FAILED");
  }

  if (!latestResume) {
    throw new Error("MASTER_RESUME_NOT_FOUND");
  }

  const { error: updateError } = await supabase
    .from("generated_resumes")
    .update({
      content_json: parsed.resume,
      pdf_storage_path: null,
      status: "draft",
    })
    .eq("id", latestResume.id)
    .eq("user_id", userId);

  if (updateError) {
    throw new Error("MASTER_RESUME_UPDATE_FAILED");
  }

  return getMasterResumeOverview(userId);
}

export async function exportMasterResumePdf(): Promise<MasterResumeOverview> {
  const { supabase, userId } = await getAuthenticatedContext();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, target_direction, target_level")
    .eq("user_id", userId)
    .single();

  if (profileError || !profile) {
    throw new Error("PROFILE_NOT_FOUND");
  }

  const { data: latestResume, error: resumeReadError } = await supabase
    .from("generated_resumes")
    .select("id, content_json")
    .eq("profile_id", profile.id)
    .eq("user_id", userId)
    .eq("resume_type", "master")
    .is("application_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (resumeReadError) {
    throw new Error("MASTER_RESUME_READ_FAILED");
  }

  if (!latestResume) {
    throw new Error("MASTER_RESUME_NOT_FOUND");
  }

  const resume = parseResumeContent(latestResume.content_json);
  const pdfBytes = await buildMasterResumePdf({
    profile: {
      displayName: profile.display_name,
      targetDirection: profile.target_direction,
      targetLevel: profile.target_level,
    },
    resume,
  });
  const validation = await validateGeneratedPdf({
    bytes: pdfBytes,
    requiredPhrases: [resume.headline, resume.summary],
  });

  if (!validation.valid) {
    throw new Error("PDF_VALIDATION_FAILED");
  }

  const pdfPath = `${userId}/master/${latestResume.id}-master-resume.pdf`;
  const { error: uploadError } = await supabase.storage
    .from(GENERATED_ARTIFACT_BUCKET)
    .upload(pdfPath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) {
    throw new Error("PDF_UPLOAD_FAILED");
  }

  const { error: updateError } = await supabase
    .from("generated_resumes")
    .update({
      pdf_storage_path: pdfPath,
      status: "ready",
    })
    .eq("id", latestResume.id)
    .eq("user_id", userId);

  if (updateError) {
    throw new Error("PDF_METADATA_UPDATE_FAILED");
  }

  return getMasterResumeOverview(userId);
}

async function getAuthenticatedContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  return {
    supabase,
    userId: user.id,
  };
}

async function readMasterResumeContext(userId: string) {
  const supabase = await createClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, headline, summary, target_direction, target_level")
    .eq("user_id", userId)
    .single();

  if (profileError || !profile) {
    throw new Error("PROFILE_NOT_FOUND");
  }

  const { data: confirmedFacts, error: factsError } = await supabase
        .from("profile_facts")
        .select("fact_type, fact_value, confidence")
        .eq("profile_id", profile.id)
        .eq("user_id", userId)
        .order("confidence", { ascending: false })
    .limit(80);

  if (factsError) {
    throw new Error("PROFILE_FACTS_READ_FAILED");
  }

  return {
    confirmedFacts: confirmedFacts ?? [],
    profile,
  };
}

async function buildOverview({
  confirmedFacts,
  latestResume,
  profile,
}: {
  confirmedFacts: ConfirmedFact[];
  latestResume: ResumeRow | null;
  profile: Pick<ProfileRecord, "target_direction" | "target_level">;
}) {
  const missingEvidence = readMissingEvidence({ confirmedFacts, profile });

  return buildEmptyOverview({
    confirmedFactCount: confirmedFacts.length,
    latestResume: latestResume
      ? {
          content: parseResumeContent(latestResume.content_json),
          id: latestResume.id,
          model: latestResume.model,
          pdfDownloadUrl: await createSignedPdfUrl(latestResume.pdf_storage_path),
          promptVersion: latestResume.prompt_version,
          status: latestResume.status,
          updatedAt: latestResume.updated_at,
        }
      : null,
    missingEvidence,
  });
}

function buildEmptyOverview({
  confirmedFactCount,
  latestResume,
  missingEvidence,
}: {
  confirmedFactCount: number;
  latestResume: MasterResumeOverview["latestResume"];
  missingEvidence: string[];
}): MasterResumeOverview {
  const canGenerate = missingEvidence.length === 0;

  return {
    canGenerate,
    confirmedFactCount,
    latestResume,
    missingEvidence,
    readinessNote: canGenerate
      ? "Enough profile evidence to draft an ATS-friendly master resume."
      : "Add more profile evidence before generating a trustworthy master resume.",
  };
}

function readMissingEvidence({
  confirmedFacts,
  profile,
}: {
  confirmedFacts: ConfirmedFact[];
  profile?: Pick<ProfileRecord, "target_direction" | "target_level">;
}) {
  const types = new Set(confirmedFacts.map((fact) => fact.fact_type));
  const missing: string[] = [];

  if (confirmedFacts.length < 3) {
    missing.push("At least 3 proof points");
  }

  if (!types.has("experience") && !types.has("project")) {
    missing.push("Work experience or project evidence");
  }

  if (!types.has("skill")) {
    missing.push("Skills");
  }

  if (profile && !profile.target_direction) {
    missing.push("Target direction");
  }

  return missing;
}

function buildMasterResumeInstructions() {
  return `
You are ${brand.name}'s senior resume strategist.

Create an ATS-friendly master resume draft using only captured profile facts
and profile direction supplied in the input. Do not invent employers, dates,
credentials, metrics, tools, titles, education, awards, or outcomes.

The resume should feel polished and human, not generic AI output. Preserve a
hint of the user's voice by keeping language clear, candid, and grounded.

Write for a broad master resume, not a specific job post. Use recruiter-grade
judgment: strong positioning, supported keywords, evidence-backed bullets, and
clear gaps the user should fill before using this as an application source.

If evidence is thin, be conservative and put concerns in reviewerNotes and
keywordGaps rather than pretending the profile is complete.
`.trim();
}

function buildMasterResumeInput({
  confirmedFacts,
  instruction,
  profile,
}: {
  confirmedFacts: ConfirmedFact[];
  instruction: string | undefined;
  profile: ProfileRecord;
}) {
  return `
Profile:
- Name: ${profile.display_name ?? "Not provided"}
- Current headline: ${profile.headline ?? "Not provided"}
- Current summary: ${profile.summary ?? "Not provided"}
- Target direction: ${profile.target_direction ?? "Not provided"}
- Target level: ${profile.target_level ?? "Not provided"}

Profile evidence:
${confirmedFacts.map((fact) => `- ${fact.fact_type}: ${fact.fact_value}`).join("\n")}

User refinement instruction:
${instruction ?? "No extra instruction."}

Return structured JSON only.
`.trim();
}

async function createSignedPdfUrl(path: string | null) {
  if (!path) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(GENERATED_ARTIFACT_BUCKET)
    .createSignedUrl(path, PDF_SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
}

async function buildMasterResumePdf({
  profile,
  resume,
}: {
  profile: {
    displayName: string | null;
    targetDirection: string | null;
    targetLevel: string | null;
  };
  resume: ResumeContent;
}) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const document = createPdfLayout({ bold, pdf, regular });

  drawTextBlock(document, profile.displayName ?? resume.headline, {
    font: bold,
    size: 18,
  });

  if (profile.displayName) {
    drawTextBlock(document, resume.headline, {
      color: rgb(0.42, 0.33, 0.24),
      font: regular,
      size: 11,
    });
  }

  const targetLine = [profile.targetDirection, profile.targetLevel].filter(Boolean).join(" | ");

  if (targetLine) {
    drawTextBlock(document, targetLine, {
      color: rgb(0.42, 0.33, 0.24),
      font: regular,
      size: 9,
    });
  }

  addVerticalSpace(document, 12);
  drawSection(document, "Professional Summary", [resume.summary], regular, bold);
  drawSection(document, "Core Skills", [resume.skills.join(", ")], regular, bold);
  drawSection(
    document,
    "Experience Highlights",
    resume.experienceBullets.map((bullet) => `- ${bullet}`),
    regular,
    bold,
  );

  if (resume.keywordGaps.length > 0 || resume.reviewerNotes.length > 0) {
    drawSection(
      document,
      "Review Before Use",
      [
        ...resume.keywordGaps.map((gap) => `Gap: ${gap}`),
        ...resume.reviewerNotes.map((note) => `Note: ${note}`),
      ],
      regular,
      bold,
    );
  }

  return pdf.save();
}

function drawSection(
  document: PdfLayout,
  title: string,
  lines: string[],
  regular: PDFFont,
  bold: PDFFont,
) {
  drawTextBlock(document, title, { font: bold, size: 12 });
  addVerticalSpace(document, 4);

  for (const line of lines) {
    drawTextBlock(document, line, { font: regular, size: 10 });
    addVerticalSpace(document, 4);
  }

  addVerticalSpace(document, 10);
}

function drawTextBlock(
  document: PdfLayout,
  text: string,
  {
    color = rgb(0.05, 0.09, 0.16),
    font,
    size,
    x = 54,
  }: {
    color?: RGB;
    font: PDFFont;
    size: number;
    x?: number;
  },
) {
  const lines = wrapText(text, font, size, 504);

  for (const line of lines) {
    ensureSpace(document, size + 5);

    document.page.drawText(line, {
      color,
      font,
      size,
      x,
      y: document.cursorY,
    });
    document.cursorY -= size + 5;
  }
}

type PdfLayout = {
  bold: PDFFont;
  cursorY: number;
  page: PDFPage;
  pdf: PDFDocument;
  regular: PDFFont;
};

function createPdfLayout({
  bold,
  pdf,
  regular,
}: {
  bold: PDFFont;
  pdf: PDFDocument;
  regular: PDFFont;
}): PdfLayout {
  return {
    bold,
    cursorY: 740,
    page: pdf.addPage([612, 792]),
    pdf,
    regular,
  };
}

function addVerticalSpace(document: PdfLayout, space: number) {
  ensureSpace(document, space);
  document.cursorY -= space;
}

function ensureSpace(document: PdfLayout, requiredHeight: number) {
  if (document.cursorY - requiredHeight >= 54) {
    return;
  }

  document.page = document.pdf.addPage([612, 792]);
  document.cursorY = 740;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  return text
    .split("\n")
    .flatMap((paragraph) => {
      const words = paragraph
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .flatMap((word) => splitLongWord(word, font, size, maxWidth));
      const lines: string[] = [];
      let currentLine = "";

      for (const word of words) {
        const candidate = currentLine ? `${currentLine} ${word}` : word;

        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
          currentLine = candidate;
          continue;
        }

        if (currentLine) {
          lines.push(currentLine);
        }
        currentLine = word;
      }

      if (currentLine) {
        lines.push(currentLine);
      }

      return lines.length > 0 ? lines : [""];
    });
}

function splitLongWord(word: string, font: PDFFont, size: number, maxWidth: number) {
  if (font.widthOfTextAtSize(word, size) <= maxWidth) {
    return [word];
  }

  const segments: string[] = [];
  let segment = "";

  for (const character of word) {
    const candidate = `${segment}${character}`;

    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      segment = candidate;
      continue;
    }

    if (segment) {
      segments.push(segment);
    }
    segment = character;
  }

  if (segment) {
    segments.push(segment);
  }

  return segments;
}

function hashUserId(userId: string) {
  return createHash("sha256").update(userId).digest("hex").slice(0, 64);
}
