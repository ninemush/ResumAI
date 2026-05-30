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
  MAX_RESUME_EXPERIENCE_SECTIONS,
  normalizeResumeContent,
  parseResumeContent,
  resumeContentSchema,
  type ResumeContent,
} from "@/lib/resumes/resume-content";
import { extractExperienceSectionsFromText } from "@/lib/resumes/source-experience";
import { createClient } from "@/lib/supabase/server";

export const MASTER_RESUME_PROMPT_VERSION = "master-resume.v4";
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
        .limit(30),
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
    sourceEvidence: sourceError ? [] : prioritizeSourceEvidence(sourceEvidence ?? []),
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
  const resume = await generateMasterResumeDraft({
    confirmedFacts,
    instruction: parsed.instruction,
    model,
    profile,
    sourceEvidence,
    userId,
  });

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

async function generateMasterResumeDraft({
  confirmedFacts,
  instruction,
  model,
  profile,
  sourceEvidence,
  userId,
}: {
  confirmedFacts: ConfirmedFact[];
  instruction: string | undefined;
  model: string;
  profile: ProfileRecord;
  sourceEvidence: SourceEvidence[];
  userId: string;
}) {
  const masterResumeInput = buildMasterResumeInput({
    confirmedFacts,
    intelligence: buildProfileIntelligence({
      facts: confirmedFacts,
      profile,
    }),
    instruction,
    profile,
    sourceEvidence,
  });
  let strictFailureCode: string | null = null;

  try {
    const response = await createOpenAIResponse({
      model,
      instructions: buildMasterResumeInstructions(),
      input: masterResumeInput,
      max_output_tokens: 5000,
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
              "contact",
              "headline",
              "summary",
              "skills",
              "experienceSections",
              "experienceBullets",
              "keywordGaps",
              "reviewerNotes",
            ],
            properties: {
              contact: {
                type: "object",
                additionalProperties: false,
                required: ["email", "phone", "linkedin", "website", "location"],
                properties: {
                  email: { anyOf: [{ type: "string" }, { type: "null" }] },
                  phone: { anyOf: [{ type: "string" }, { type: "null" }] },
                  linkedin: { anyOf: [{ type: "string" }, { type: "null" }] },
                  website: { anyOf: [{ type: "string" }, { type: "null" }] },
                  location: { anyOf: [{ type: "string" }, { type: "null" }] },
                },
              },
              headline: { type: "string" },
              summary: { type: "string" },
              skills: {
                type: "array",
                maxItems: 24,
                items: { type: "string" },
              },
              experienceSections: {
                type: "array",
                maxItems: MAX_RESUME_EXPERIENCE_SECTIONS,
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
      strictFailureCode = "AI_MASTER_RESUME_INCOMPLETE";
    } else {
      return enrichMasterResumeWithSourceEvidence(
        parseMasterResumeModelOutput(response.output_text),
        sourceEvidence,
      );
    }
  } catch (error) {
    strictFailureCode = toMasterResumeFailureCode(error);
  }

  console.warn(
    JSON.stringify({
      event: "master_resume_strict_generation_failed",
      code: strictFailureCode ?? "AI_MASTER_RESUME_FAILED",
      promptVersion: MASTER_RESUME_PROMPT_VERSION,
    }),
  );

  const relaxedResume = await runRelaxedMasterResumeModel({
    input: masterResumeInput,
    model,
    profileId: profile.id,
    sourceEvidence,
    userId,
  });

  if (!relaxedResume) {
    throw new Error(strictFailureCode ?? "AI_MASTER_RESUME_FAILED");
  }

  return relaxedResume;
}

async function runRelaxedMasterResumeModel({
  input,
  model,
  profileId,
  sourceEvidence,
  userId,
}: {
  input: string;
  model: string;
  profileId: string;
  sourceEvidence: SourceEvidence[];
  userId: string;
}) {
  try {
    const response = await createOpenAIResponse({
      model,
      instructions: `${buildMasterResumeInstructions()}

Return valid JSON only. Do not wrap it in markdown or code fences.
Use this exact object shape:
{
  "contact": {
    "email": "email from evidence or null",
    "phone": "phone from evidence or null",
    "linkedin": "LinkedIn URL from evidence or null",
    "website": "website from evidence or null",
    "location": "location from evidence or null"
  },
  "headline": "concise positioning headline under 95 characters",
  "summary": "resume summary grounded in evidence",
  "skills": ["skill"],
  "experienceSections": [
    {
      "roleTitle": "role title",
      "company": "company or null",
      "location": "location or null",
      "dates": "dates or null",
      "bullets": ["evidence-backed impact bullet"]
    }
  ],
  "experienceBullets": ["fallback selected highlight"],
  "keywordGaps": ["specific missing keyword or evidence gap"],
  "reviewerNotes": ["specific review prompt"]
}
If dates or employers are present in the source excerpts, preserve them in role-based experienceSections.
If the source is a LinkedIn profile PDF or archive, use its role history as the primary structure.`,
      input,
      max_output_tokens: 5600,
      metadata: {
        feature: "master_resume",
        profile_id: profileId,
        prompt_version: MASTER_RESUME_PROMPT_VERSION,
        response_mode: "relaxed_json",
      },
      safety_identifier: hashUserId(userId),
      store: false,
      text: {
        verbosity: "medium",
      },
    });

    if (response.error || response.incomplete_details || !response.output_text.trim()) {
      return null;
    }

    return enrichMasterResumeWithSourceEvidence(
      parseMasterResumeModelOutput(stripJsonFence(response.output_text)),
      sourceEvidence,
    );
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "master_resume_relaxed_generation_failed",
        code: toMasterResumeFailureCode(error),
        promptVersion: MASTER_RESUME_PROMPT_VERSION,
      }),
    );

    return null;
  }
}

function parseMasterResumeModelOutput(outputText: string) {
  return normalizeResumeContent(resumeContentSchema.parse(JSON.parse(stripJsonFence(outputText))));
}

function enrichMasterResumeWithSourceEvidence(
  resume: ResumeContent,
  sourceEvidence: SourceEvidence[],
) {
  const sourceSections = extractExperienceSectionsFromSources(sourceEvidence);
  const sourceContact = extractResumeContactFromSources(sourceEvidence);

  if (sourceSections.length === 0 && Object.values(sourceContact).every((value) => !value)) {
    return resume;
  }

  return normalizeResumeContent({
    ...resume,
    contact: {
      ...resume.contact,
      email: resume.contact.email ?? sourceContact.email,
      linkedin: resume.contact.linkedin ?? sourceContact.linkedin,
      location: resume.contact.location ?? sourceContact.location,
      phone: resume.contact.phone ?? sourceContact.phone,
      website: resume.contact.website ?? sourceContact.website,
    },
    experienceSections:
      sourceSections.length > 0
        ? mergeExperienceSections(resume.experienceSections, sourceSections)
        : resume.experienceSections,
    reviewerNotes: [
      ...resume.reviewerNotes,
      ...(sourceSections.length > 0
        ? ["Review the imported role timeline for exact dates, company names, and ownership scope before exporting."]
        : []),
    ].slice(0, 8),
  });
}

function extractResumeContactFromSources(sourceEvidence: SourceEvidence[]) {
  const text = sourceEvidence
    .map((source) => [source.source_url, source.extracted_text].filter(Boolean).join("\n"))
    .join("\n");
  const cleaned = text.replace(/\s+/g, " ").trim();
  const email = cleaned.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  const linkedinMatch =
    cleaned.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[^\s),;]+/i)?.[0] ?? null;
  const websiteMatch =
    cleaned.match(/https?:\/\/(?![^/\s]*linkedin\.com)[^\s),;]+\.[^\s),;]+/i)?.[0] ?? null;
  const phone = cleaned.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0] ?? null;
  const location =
    cleaned.match(/\b(?:Dubai|Abu Dhabi|United Arab Emirates|UAE|Riyadh|London|New York|Toronto|Singapore)\b[^|,\n]*/i)?.[0] ??
    null;

  return {
    email,
    linkedin: linkedinMatch ? normalizeLinkedInUrl(linkedinMatch) : null,
    location,
    phone,
    website: websiteMatch,
  };
}

function normalizeLinkedInUrl(value: string) {
  const cleanValue = value.replace(/[).,;]+$/g, "");
  return cleanValue.startsWith("http") ? cleanValue : `https://${cleanValue}`;
}

function extractExperienceSectionsFromSources(sourceEvidence: SourceEvidence[]) {
  const sections = sourceEvidence
    .flatMap((source) => extractExperienceSectionsFromText(source.extracted_text ?? ""))
    .filter((section) => section.roleTitle && (section.company || section.dates || section.bullets.length > 0));

  const seen = new Set<string>();

  return sections
    .filter((section) => {
      const key = [section.roleTitle, section.company ?? "", section.dates ?? ""]
        .join("|")
        .toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .slice(0, MAX_RESUME_EXPERIENCE_SECTIONS);
}

function mergeExperienceSections(
  sourceSections: ResumeContent["experienceSections"],
  modelSections: ResumeContent["experienceSections"],
) {
  const merged = [...sourceSections];

  for (const section of modelSections) {
    const matchesExisting = merged.some((item) =>
      [item.roleTitle, item.company ?? ""].join(" ").toLowerCase().includes(
        [section.roleTitle, section.company ?? ""].join(" ").toLowerCase().slice(0, 40),
      ),
    );

    if (!matchesExisting) {
      merged.push(section);
    }
  }

  return merged.slice(0, MAX_RESUME_EXPERIENCE_SECTIONS);
}

function stripJsonFence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function toMasterResumeFailureCode(error: unknown) {
  if (error instanceof SyntaxError || error instanceof z.ZodError) {
    return "AI_MASTER_RESUME_SCHEMA_FAILED";
  }

  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : null;

  if (status === 401 || status === 403) {
    return "AI_MASTER_RESUME_PROVIDER_AUTH_FAILED";
  }

  if (status === 400 || status === 422) {
    return "AI_MASTER_RESUME_PROVIDER_REJECTED_INPUT";
  }

  if (status === 408 || status === 409 || status === 429 || (status !== null && status >= 500)) {
    return "AI_MASTER_RESUME_PROVIDER_TEMPORARY_FAILURE";
  }

  return "AI_MASTER_RESUME_PROVIDER_UNAVAILABLE";
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

  const [
    { data: latestResume, error: resumeReadError },
    { data: sourceEvidence, error: sourceError },
  ] = await Promise.all([
    supabase
    .from("generated_resumes")
    .select("id, content_json")
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
      .limit(30),
  ]);

  if (resumeReadError) {
    throw new Error("MASTER_RESUME_READ_FAILED");
  }

  if (!latestResume) {
    throw new Error("MASTER_RESUME_NOT_FOUND");
  }

  if (sourceError) {
    console.warn("master_resume.export_source_evidence_read_failed", {
      profileId: profile.id,
      userIdHash: hashUserId(userId),
    });
  }

  const resume = parseResumeContent(latestResume.content_json);
  const normalizedResume = enrichMasterResumeWithSourceEvidence(
    normalizeResumeContent(resume),
    sourceError ? [] : prioritizeSourceEvidence(sourceEvidence ?? []),
  );
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
    .limit(30);

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
    sourceEvidence: sourceError ? [] : prioritizeSourceEvidence(sourceEvidence ?? []),
  };
}

function prioritizeSourceEvidence(sourceEvidence: SourceEvidence[]) {
  return [...sourceEvidence]
    .sort((left, right) => readSourceEvidenceUsefulness(right) - readSourceEvidenceUsefulness(left))
    .slice(0, 10);
}

function readSourceEvidenceUsefulness(source: SourceEvidence) {
  const readableLength = source.extracted_text?.replace(/\s+/g, " ").trim().length ?? 0;
  const readableScore = Math.min(readableLength / 700, 12);
  const typeScore =
    source.source_type === "linkedin" || source.source_type === "pdf"
      ? 5
      : source.source_type === "docx"
        ? 4
        : source.source_type === "txt"
          ? 3
          : source.source_type === "natural_language"
            ? 2
            : 1;

  return readableScore + typeScore;
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
          content: enrichMasterResumeWithSourceEvidence(
            parseResumeContent(latestResume.content_json),
            sourceEvidence,
          ),
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
    missing.push("Role outcomes or achievement evidence");
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

Create an ATS-friendly master resume draft using only saved profile context,
readable source excerpts, and profile direction supplied in the input. Do not
invent employers, dates, credentials, metrics, tools, titles, education, awards,
or outcomes.

The resume should feel polished and human, not generic AI output. Preserve a
hint of the user's voice by keeping language clear, candid, and grounded.
Never include internal interface labels such as "Draft", "ATS master resume",
"Master ATS Resume", or "Master resume" inside the resume content itself.

Write for a broad master resume, not a specific job post. Use recruiter-grade
judgment: strong positioning, supported keywords, evidence-backed bullets, and
clear gaps the user should fill before using this as an application source.

Use a standard ATS structure. The headline must be a concise title or
positioning line under 95 characters, not a pipe-delimited keyword list. Put
keyword breadth into skills and experience, not the title. The summary should
be tight enough for a resume preview, usually 90-140 words.

Include a contact object for email, phone, LinkedIn URL, website, and location
when those details appear in the profile or readable source evidence. Use null
for missing contact fields. Do not invent contact details.

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
highlights. experienceBullets should be an AI-curated highlight reel across the
most relevant roles and should support the user's likely target direction; it
does not replace the role-by-role work history.

Treat the master resume as the reusable source of truth. Do not overfit it to
one narrow role. Capture the user's broader leadership pattern, domain depth,
operating scope, and repeatable value.

Convert activity into employer value. Bullets should emphasize business
outcomes, operating scale, transformation complexity, stakeholder scope,
financial/commercial impact, customer impact, risk/control outcomes, adoption,
delivery capacity, cycle time, or productivity when the evidence supports it.

Use the supplied profile intelligence to decide what to foreground, what to
ask about, and what to keep out of final claims. Treat impact themes as strong
resume direction. Treat high-value gaps as reviewerNotes or keywordGaps, not as
facts. A gap prompt should become a pointed question, not an invented metric.

For senior transformation, GTM, professional services, operations, AI/
automation, customer success, technology, and advisory profiles, look for and
surface these evidence types when present:
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
- Positioning context: ${intelligence.positioningSignals.join(", ") || "None yet"}
- Resume focus: ${intelligence.resumeFocus.join(" | ") || "None yet"}
- Impact themes:
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
      const excerpt = buildResumeSourceExcerpt(source.extracted_text);
      if (!excerpt) return null;

      const timeline = buildStructuredExperienceTimelineForPrompt(source.extracted_text);

      return `- ${source.original_filename ?? source.source_url ?? source.source_type}:${timeline ? `\n  Structured role timeline:\n${timeline}` : ""}\n  Source excerpt: ${excerpt}`;
    })
    .filter(Boolean);

  return excerpts.length > 0
    ? excerpts.join("\n")
    : "No readable source excerpts available.";
}

function buildStructuredExperienceTimelineForPrompt(text: string | null) {
  const sections = extractExperienceSectionsFromText(text ?? "");

  if (sections.length === 0) {
    return "";
  }

  return sections
    .map((section) => {
      const meta = [section.roleTitle, section.company, section.dates, section.location]
        .filter(Boolean)
        .join(" | ");
      const bullets = section.bullets.slice(0, 5).map((bullet) => `    - ${bullet}`).join("\n");

      return `  - ${meta}${bullets ? `\n${bullets}` : ""}`;
    })
    .join("\n");
}

function buildResumeSourceExcerpt(text: string | null) {
  const cleanText = text?.replace(/\s+/g, " ").trim();

  if (!cleanText) {
    return null;
  }

  if (cleanText.length <= 14000) {
    return cleanText;
  }

  const windows: Array<{ end: number; start: number }> = [{ start: 0, end: 1300 }];
  const sectionPattern =
    /\b(summary|experience|employment|work history|professional experience|projects?|skills?|education|certifications?|licenses?|awards?|honou?rs?|publications?|volunteer|recommendations?)\b/gi;
  let match: RegExpExecArray | null;

  while ((match = sectionPattern.exec(cleanText)) && windows.length < 7) {
    windows.push({
      start: Math.max(0, match.index - 320),
      end: Math.min(cleanText.length, match.index + 1500),
    });
  }

  const merged = windows
    .sort((left, right) => left.start - right.start)
    .reduce<Array<{ end: number; start: number }>>((items, window) => {
      const previous = items.at(-1);

      if (previous && window.start <= previous.end + 120) {
        previous.end = Math.max(previous.end, window.end);
        return items;
      }

      items.push({ ...window });
      return items;
    }, []);

  return merged
    .map((window) => cleanText.slice(window.start, window.end).trim())
    .filter(Boolean)
    .join(" [...] ")
    .slice(0, 14000);
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
