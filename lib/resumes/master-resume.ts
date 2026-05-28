import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import { buildAtsResumeDocx, buildAtsResumePdf } from "@/lib/artifacts/ats-template";
import { validateGeneratedPdf } from "@/lib/applications/pdf-validation";
import { getMaterialsModel, getOpenAIClient } from "@/lib/ai/openai";
import { brand } from "@/lib/brand";
import { recordQuotaEvent } from "@/lib/quota/quota-events";
import {
  buildProfileIntelligence,
  type ProfileIntelligence,
} from "@/lib/profile/profile-intelligence";
import {
  parseResumeContent,
  resumeContentSchema,
  type ResumeContent,
} from "@/lib/resumes/resume-content";
import { createClient } from "@/lib/supabase/server";

export const MASTER_RESUME_PROMPT_VERSION = "master-resume.v2";
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
  docx_storage_path: string | null;
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
    docxDownloadUrl: string | null;
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
        .select("id, content_json, pdf_storage_path, docx_storage_path, status, prompt_version, model, updated_at")
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
      intelligence: buildProfileIntelligence({
        facts: confirmedFacts,
        profile,
      }),
      instruction: parsed.instruction,
      profile,
    }),
    max_output_tokens: 3000,
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
      docx_storage_path: null,
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

export async function exportMasterResumeArtifacts(): Promise<MasterResumeOverview> {
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
  const templateInput = {
    contextLine: [profile.target_direction, profile.target_level].filter(Boolean).join(" | "),
    displayName: profile.display_name,
    resume,
  };
  const [pdfBytes, docxBytes] = await Promise.all([
    buildAtsResumePdf(templateInput),
    buildAtsResumeDocx(templateInput),
  ]);
  const validation = await validateGeneratedPdf({
    bytes: pdfBytes,
    requiredPhrases: [resume.headline, resume.summary],
  });

  if (!validation.valid) {
    throw new Error("PDF_VALIDATION_FAILED");
  }

  const pdfPath = `${userId}/master/${latestResume.id}-master-resume.pdf`;
  const docxPath = `${userId}/master/${latestResume.id}-master-resume.docx`;
  const [{ error: pdfUploadError }, { error: docxUploadError }] = await Promise.all([
    supabase.storage.from(GENERATED_ARTIFACT_BUCKET).upload(pdfPath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    }),
    supabase.storage.from(GENERATED_ARTIFACT_BUCKET).upload(docxPath, docxBytes, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    }),
  ]);

  if (pdfUploadError || docxUploadError) {
    throw new Error("ARTIFACT_UPLOAD_FAILED");
  }

  const { error: updateError } = await supabase
    .from("generated_resumes")
    .update({
      docx_storage_path: docxPath,
      pdf_storage_path: pdfPath,
      status: "ready",
    })
    .eq("id", latestResume.id)
    .eq("user_id", userId);

  if (updateError) {
    throw new Error("ARTIFACT_METADATA_UPDATE_FAILED");
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
          docxDownloadUrl: await createSignedArtifactUrl(latestResume.docx_storage_path),
          id: latestResume.id,
          model: latestResume.model,
          pdfDownloadUrl: await createSignedArtifactUrl(latestResume.pdf_storage_path),
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

Treat the master resume as the reusable source of truth. Do not overfit it to
one narrow role. Capture the user's broader leadership pattern, domain depth,
operating scope, and repeatable value.

Convert activity into employer value. Bullets should emphasize business
outcomes, operating scale, transformation complexity, stakeholder scope,
financial/commercial impact, customer impact, risk/control outcomes, adoption,
delivery capacity, cycle time, or productivity when the evidence supports it.

Use the supplied profile intelligence to decide what to foreground, what to
ask about, and what to keep out of final claims. Treat proof themes as strong
resume direction. Treat high-value gaps as reviewerNotes or keywordGaps, not as
facts. A gap prompt should become a pointed question, not an invented metric.

For senior transformation, GTM, professional services, operations, AI/
automation, customer success, technology, and advisory profiles, look for and
surface these signals when present:
- revenue/bookings/growth, margin/profitability, cost reduction, utilization,
  delivery capacity, pipeline/backlog, portfolio/pricing, customer adoption,
  time-to-value, NPS/retention/renewal, automation throughput, deployment time,
  governance, SOX/audit/control improvement, data quality, team size, regional
  or global remit, and executive stakeholder complexity.

If the source evidence names responsibilities but does not quantify them, do
not make up numbers. Put pointed metric prompts in reviewerNotes, phrased as
specific questions the user can answer.

If evidence is thin, be conservative and put concerns in reviewerNotes and
keywordGaps rather than pretending the profile is complete.
`.trim();
}

function buildMasterResumeInput({
  confirmedFacts,
  intelligence,
  instruction,
  profile,
}: {
  confirmedFacts: ConfirmedFact[];
  intelligence: ProfileIntelligence;
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

Profile intelligence:
- Evidence strength: ${intelligence.evidenceStrength}
- Role target read: ${intelligence.roleTargetRead}
- Positioning signals: ${intelligence.positioningSignals.join(", ") || "None yet"}
- Resume focus: ${intelligence.resumeFocus.join(" | ") || "None yet"}
- Proof themes:
${intelligence.proofThemes.length > 0 ? intelligence.proofThemes.map((theme) => `  - ${theme.label}: ${theme.evidence.join(" / ")}`).join("\n") : "  - None yet"}
- High-value gaps to resolve:
${intelligence.highValueGaps.length > 0 ? intelligence.highValueGaps.map((gap) => `  - [${gap.severity}] ${gap.label}: ${gap.prompt}`).join("\n") : "  - None"}

User refinement instruction:
${instruction ?? "No extra instruction."}

Return structured JSON only.
`.trim();
}

async function createSignedArtifactUrl(path: string | null) {
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

function hashUserId(userId: string) {
  return createHash("sha256").update(userId).digest("hex").slice(0, 64);
}
