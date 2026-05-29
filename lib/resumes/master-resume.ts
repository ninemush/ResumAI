import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import { buildAtsResumeDocx, buildAtsResumePdf } from "@/lib/artifacts/ats-template";
import { validateGeneratedPdf } from "@/lib/applications/pdf-validation";
import { getMaterialsModel, createOpenAIResponse } from "@/lib/ai/openai";
import { brand } from "@/lib/brand";
import { recordQuotaEvent } from "@/lib/quota/quota-events";
import {
  buildProfileIntelligence,
  type ProfileIntelligence,
} from "@/lib/profile/profile-intelligence";
import {
  normalizeResumeContent,
  parseResumeContent,
  resumeContentSchema,
  type ResumeContent,
} from "@/lib/resumes/resume-content";
import { createClient } from "@/lib/supabase/server";

export const MASTER_RESUME_PROMPT_VERSION = "master-resume.v3";
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

type SourceEvidence = {
  extracted_text: string | null;
  original_filename: string | null;
  source_type: string;
  source_url: string | null;
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

  const [
    { data: facts, error: factsError },
    { data: latestResume, error: resumeError },
    { data: sourceEvidence, error: sourceError },
  ] =
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
      supabase
        .from("profile_sources")
        .select("source_type, source_url, original_filename, extracted_text")
        .eq("profile_id", profile.id)
        .eq("user_id", userId)
        .not("extracted_text", "is", null)
        .order("created_at", { ascending: false })
        .limit(8),
    ]);

  if (factsError) {
    throw new Error("PROFILE_FACTS_READ_FAILED");
  }

  if (resumeError) {
    throw new Error("MASTER_RESUME_READ_FAILED");
  }

  if (sourceError) {
    console.warn("master_resume.source_evidence_read_failed", {
      profileId: profile.id,
      userIdHash: hashUserId(userId),
    });
  }

  return buildOverview({
    confirmedFacts: facts ?? [],
    latestResume,
    profile,
    sourceEvidence: sourceError ? [] : (sourceEvidence ?? []),
  });
}

export async function generateMasterResume(
  input: z.input<typeof generateMasterResumeSchema> = {},
): Promise<GenerateMasterResumeResult> {
  const parsed = generateMasterResumeSchema.parse(input);
  const { supabase, userId } = await getAuthenticatedContext();
  const { profile, confirmedFacts, sourceEvidence } = await readMasterResumeContext(userId);
  const missingEvidence = readMissingEvidence({ confirmedFacts, profile, sourceEvidence });

  if (missingEvidence.length > 0) {
    throw new Error("MASTER_RESUME_CONTEXT_TOO_THIN");
  }

  const model = getMaterialsModel();
  const response = await createOpenAIResponse({
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
      sourceEvidence,
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
            "experienceSections",
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
            experienceSections: {
              type: "array",
              maxItems: 8,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["roleTitle", "company", "location", "dates", "bullets"],
                properties: {
                  roleTitle: { type: "string" },
                  company: {
                    anyOf: [{ type: "string" }, { type: "null" }],
                  },
                  location: {
                    anyOf: [{ type: "string" }, { type: "null" }],
                  },
                  dates: {
                    anyOf: [{ type: "string" }, { type: "null" }],
                  },
                  bullets: {
                    type: "array",
                    maxItems: 7,
                    items: { type: "string" },
                  },
                },
              },
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

  const resume = normalizeResumeContent(resumeContentSchema.parse(JSON.parse(response.output_text)));
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
    summary: "Generated a master resume draft from your current career foundation.",
  };
}

export async function updateMasterResume(
  input: z.input<typeof updateMasterResumeSchema>,
): Promise<MasterResumeOverview> {
  const parsed = updateMasterResumeSchema.parse(input);
  const normalizedResume = normalizeResumeContent(parsed.resume);
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
      content_json: normalizedResume,
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
  const normalizedResume = normalizeResumeContent(resume);
  const templateInput = {
    contextLine: [profile.target_direction, profile.target_level].filter(Boolean).join(" | "),
    displayName: profile.display_name,
    resume: normalizedResume,
  };
  const [pdfBytes, docxBytes] = await Promise.all([
    buildAtsResumePdf(templateInput),
    buildAtsResumeDocx(templateInput),
  ]);
  const validation = await validateGeneratedPdf({
    bytes: pdfBytes,
    requiredPhrases: [normalizedResume.headline, normalizedResume.summary],
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
  const { data: sourceEvidence, error: sourceError } = await supabase
    .from("profile_sources")
    .select("source_type, source_url, original_filename, extracted_text")
    .eq("profile_id", profile.id)
    .eq("user_id", userId)
    .not("extracted_text", "is", null)
    .order("created_at", { ascending: false })
    .limit(8);

  if (factsError) {
    throw new Error("PROFILE_FACTS_READ_FAILED");
  }

  if (sourceError) {
    console.warn("master_resume.source_evidence_read_failed", {
      profileId: profile.id,
      userIdHash: hashUserId(userId),
    });
  }

  return {
    confirmedFacts: confirmedFacts ?? [],
    profile,
    sourceEvidence: sourceError ? [] : (sourceEvidence ?? []),
  };
}

async function buildOverview({
  confirmedFacts,
  latestResume,
  profile,
  sourceEvidence,
}: {
  confirmedFacts: ConfirmedFact[];
  latestResume: ResumeRow | null;
  profile: Pick<ProfileRecord, "target_direction" | "target_level">;
  sourceEvidence: SourceEvidence[];
}) {
  const missingEvidence = readMissingEvidence({ confirmedFacts, profile, sourceEvidence });

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
      ? "Ready to draft an ATS-friendly master resume from your current career foundation."
      : "Add role scope, outcomes, skills, or target direction before generating a trustworthy master resume.",
  };
}

function readMissingEvidence({
  confirmedFacts,
  profile,
  sourceEvidence = [],
}: {
  confirmedFacts: ConfirmedFact[];
  profile?: Pick<ProfileRecord, "target_direction" | "target_level">;
  sourceEvidence?: SourceEvidence[];
}) {
  const types = new Set(confirmedFacts.map((fact) => fact.fact_type));
  const sourceText = sourceEvidence.map((source) => source.extracted_text ?? "").join("\n");
  const hasSourceText = sourceText.replace(/\s+/g, " ").trim().length > 500;
  const hasWorkEvidence =
    types.has("experience") ||
    types.has("project") ||
    /\b(experience|employment|work history|company|director|vice president|manager|lead|consultant|advisor|engineer|analyst)\b/i.test(
      sourceText,
    );
  const hasSkillEvidence =
    types.has("skill") || /\b(skills?|competenc|technolog|tools?|expertise)\b/i.test(sourceText);
  const missing: string[] = [];

  if (confirmedFacts.length < 3 && !hasSourceText) {
    missing.push("At least 3 proof points");
  }

  if (!hasWorkEvidence) {
    missing.push("Work experience or project evidence");
  }

  if (!hasSkillEvidence) {
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

Create an ATS-friendly master resume draft using only captured profile facts,
readable source excerpts, and profile direction supplied in the input. Do not
invent employers, dates, credentials, metrics, tools, titles, education, awards,
or outcomes.

The resume should feel polished and human, not generic AI output. Preserve a
hint of the user's voice by keeping language clear, candid, and grounded.

Write for a broad master resume, not a specific job post. Use recruiter-grade
judgment: strong positioning, supported keywords, evidence-backed bullets, and
clear gaps the user should fill before using this as an application source.

Use a standard ATS structure. The headline must be a concise title or
positioning line under 95 characters, not a pipe-delimited keyword list. Put
keyword breadth into skills and experience, not the title. The summary should
be tight enough for a resume preview, usually 90-140 words.

The work history must be organized into role-based experienceSections whenever
the evidence names employers, roles, dates, scope, or repeated role context.
Order experienceSections from current/most recent to oldest based on the source
evidence. Each section should include roleTitle, company, location, and dates
when those are present in the evidence. Use null only when the evidence truly
does not include the field, and add a reviewerNote asking for the missing dates
or company instead of inventing them.

Each role section should contain resume bullets that combine action, scope, and
business value. Keep bullets tied to that role. Do not flatten rich work history
into a generic highlights list unless the source evidence is too thin to attach
work to employers. Also provide experienceBullets as fallback selected
highlights, but role-based experienceSections are the primary resume content.

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
  sourceEvidence,
}: {
  confirmedFacts: ConfirmedFact[];
  intelligence: ProfileIntelligence;
  instruction: string | undefined;
  profile: ProfileRecord;
  sourceEvidence: SourceEvidence[];
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

Readable source excerpts:
${formatSourceEvidenceForPrompt(sourceEvidence)}

Treat readable source excerpts as user-provided evidence. If extracted profile
facts are thin but source excerpts contain structured LinkedIn/resume history,
use the source excerpts to build role-based experience sections. Keep claims
grounded in the excerpt text.

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

function formatSourceEvidenceForPrompt(sourceEvidence: SourceEvidence[]) {
  const excerpts = sourceEvidence
    .map((source) => {
      const excerpt = source.extracted_text?.replace(/\s+/g, " ").trim().slice(0, 2200);
      if (!excerpt) return null;

      return `- ${source.original_filename ?? source.source_url ?? source.source_type}: ${excerpt}`;
    })
    .filter(Boolean);

  return excerpts.length > 0
    ? excerpts.join("\n")
    : "No readable source excerpts available.";
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
