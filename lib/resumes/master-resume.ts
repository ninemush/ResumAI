import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import { buildAtsResumeDocx, buildAtsResumePdf } from "@/lib/artifacts/ats-template";
import {
  ClaimReviewRequiredError,
  getBlockingExportRisks,
} from "@/lib/applications/export-gates";
import {
  validateGeneratedDocx,
  validateGeneratedPdf,
} from "@/lib/applications/pdf-validation";
import { getMaterialsModel, createOpenAIResponse } from "@/lib/ai/openai";
import {
  buildSupportedEvidenceCorpus,
  reviewResumeClaimProvenance,
} from "@/lib/ai/claim-provenance";
import { brand } from "@/lib/brand";
import {
  finalizeQuotaReservation,
  releaseQuotaReservation,
  reserveQuotaEvent,
  type QuotaReservationResult,
} from "@/lib/quota/quota-events";
import {
  buildProfileIntelligence,
  type ProfileIntelligence,
} from "@/lib/profile/profile-intelligence";
import {
  applyResumeExportSectionVisibility,
  defaultResumeExportSectionVisibility,
  isDefaultResumeExportSectionVisibility,
  type ResumeExportSectionVisibility,
} from "@/lib/resumes/export-readiness";
import {
  MAX_RESUME_CERTIFICATION_ITEMS,
  MAX_RESUME_EDUCATION_ITEMS,
  MAX_RESUME_EXPERIENCE_SECTIONS,
  MAX_RESUME_LANGUAGE_ITEMS,
  MAX_RESUME_SPECIAL_PROJECT_ITEMS,
  dedupeResumeExperienceSections,
  dedupeResumeSpecialProjects,
  normalizeResumeContent,
  resumeContentSchema,
  type ResumeContent,
} from "@/lib/resumes/resume-content";
import { sanitizeResumeContent } from "@/lib/resumes/resume-quality";
import { extractExperienceSectionsFromText } from "@/lib/resumes/source-experience";
import { createClient } from "@/lib/supabase/server";

export const MASTER_RESUME_PROMPT_VERSION = "master-resume.v8";
const GENERATED_ARTIFACT_BUCKET = "generated-artifacts";

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
  id: string;
  evidence_status: "user_confirmed" | "source_supported" | "inferred" | "conflict" | "missing_evidence" | null;
  origin: string | null;
  source_ids: string[] | null;
  user_confirmed: boolean | null;
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
  export_status?: string | null;
  export_validated_at?: string | null;
  claim_review_acknowledged_at?: string | null;
  id: string;
  model: string | null;
  pdf_storage_path: string | null;
  prompt_version: string | null;
  status: string;
  updated_at: string;
};

type SourceEvidence = {
  id: string;
  created_at?: string | null;
  extracted_text: string | null;
  original_filename: string | null;
  source_type: string;
  source_url: string | null;
};

type MasterResumeEvidenceBundle = {
  facts: {
    confidence: number | null;
    factType: string;
    factValue: string;
    sourceLabels: string[];
    support: "confirmed" | "source_supported" | "needs_confirmation" | "conflict" | "missing_evidence";
  }[];
  sourceTimelines: {
    label: string;
    roles: {
      bullets: string[];
      company: string | null;
      dates: string | null;
      location: string | null;
      roleTitle: string;
    }[];
  }[];
  sources: {
    label: string;
    linkedFactTypes: string[];
    readableCharacters: number;
    sourceType: string;
  }[];
};

type ExportStatus = "not_exported" | "export_pending" | "export_validated" | "export_failed";

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

export type MasterResumeArtifactExportResult = {
  didExport: boolean;
  overview: MasterResumeOverview;
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
        .select("id, fact_type, fact_value, confidence, evidence_status, origin, source_ids, user_confirmed")
        .eq("profile_id", profile.id)
        .eq("user_id", userId)
        .order("confidence", { ascending: false })
        .limit(80),
      supabase
        .from("generated_resumes")
        .select("id, content_json, pdf_storage_path, docx_storage_path, status, export_status, export_validated_at, prompt_version, model, updated_at")
        .eq("profile_id", profile.id)
        .eq("user_id", userId)
        .eq("resume_type", "master")
        .is("application_id", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("profile_sources")
        .select("id, source_type, source_url, original_filename, extracted_text, created_at")
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
  options: { quotaOperationKey?: string } = {},
): Promise<GenerateMasterResumeResult> {
  const parsed = generateMasterResumeSchema.parse(input);
  const { supabase, userId } = await getAuthenticatedContext();
  const { profile, confirmedFacts, sourceEvidence } = await readMasterResumeContext(userId);
  const missingEvidence = readMissingEvidence({ confirmedFacts, profile, sourceEvidence });

  if (missingEvidence.length > 0) {
    throw new Error("MASTER_RESUME_CONTEXT_TOO_THIN");
  }

  const model = getMaterialsModel();
  const quotaReservation = await reserveQuotaEvent({
    eventType: "generation_created",
    metadata: {
      model,
      prompt_version: MASTER_RESUME_PROMPT_VERSION,
    },
    operationKey:
      options.quotaOperationKey ??
      `masterResumeGenerate:${profile.id}:${hashOperationInput(parsed.instruction ?? "default")}`,
    resourceId: null,
    resourceType: "master_resume",
  });
  let generatedResumeId: string | null = null;

  try {
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

    generatedResumeId = generatedResume.id;
    await finalizeQuotaReservation({
      metadata: {
        model,
        prompt_version: MASTER_RESUME_PROMPT_VERSION,
        resume_id: generatedResume.id,
      },
      reservationId: quotaReservation.reservationId,
      resourceId: generatedResume.id,
    });
  } catch (error) {
    await releaseMasterResumeQuotaReservation(quotaReservation, error);
    throw error;
  }

  if (!generatedResumeId) {
    throw new Error("MASTER_RESUME_SAVE_FAILED");
  }

  return {
    overview: await getMasterResumeOverview(userId),
    resumeId: generatedResumeId,
    summary: "Created a master resume draft from your current career foundation.",
  };
}

async function releaseMasterResumeQuotaReservation(
  quotaReservation: QuotaReservationResult,
  error: unknown,
) {
  if (quotaReservation.status !== "reserved") {
    return;
  }

  await releaseQuotaReservation({
    reason: error instanceof Error ? error.message : "MASTER_RESUME_GENERATION_FAILED",
    reservationId: quotaReservation.reservationId,
  }).catch(() => undefined);
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
              "specialProjects",
              "languages",
              "education",
              "certifications",
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
              specialProjects: {
                type: "array",
                maxItems: MAX_RESUME_SPECIAL_PROJECT_ITEMS,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["name", "context", "dates", "bullets"],
                  properties: {
                    name: { type: "string" },
                    context: { anyOf: [{ type: "string" }, { type: "null" }] },
                    dates: { anyOf: [{ type: "string" }, { type: "null" }] },
                    bullets: {
                      type: "array",
                      maxItems: 5,
                      items: { type: "string" },
                    },
                  },
                },
              },
              languages: {
                type: "array",
                maxItems: MAX_RESUME_LANGUAGE_ITEMS,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["name", "proficiency"],
                  properties: {
                    name: { type: "string" },
                    proficiency: { anyOf: [{ type: "string" }, { type: "null" }] },
                  },
                },
              },
              education: {
                type: "array",
                maxItems: MAX_RESUME_EDUCATION_ITEMS,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["institution", "credential", "location", "dates"],
                  properties: {
                    institution: { type: "string" },
                    credential: { anyOf: [{ type: "string" }, { type: "null" }] },
                    location: { anyOf: [{ type: "string" }, { type: "null" }] },
                    dates: { anyOf: [{ type: "string" }, { type: "null" }] },
                  },
                },
              },
              certifications: {
                type: "array",
                maxItems: MAX_RESUME_CERTIFICATION_ITEMS,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["name", "issuer", "date"],
                  properties: {
                    name: { type: "string" },
                    issuer: { anyOf: [{ type: "string" }, { type: "null" }] },
                    date: { anyOf: [{ type: "string" }, { type: "null" }] },
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
      return reviewResumeClaimProvenance({
        evidenceCorpus: buildMasterResumeEvidenceCorpus(confirmedFacts, sourceEvidence),
        resume: enrichMasterResumeWithConfirmedFacts(
          enrichMasterResumeWithSourceEvidence(
            parseMasterResumeModelOutput(response.output_text),
            sourceEvidence,
          ),
          confirmedFacts,
        ),
      });
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

  return reviewResumeClaimProvenance({
    evidenceCorpus: buildMasterResumeEvidenceCorpus(confirmedFacts, sourceEvidence),
    resume: enrichMasterResumeWithConfirmedFacts(relaxedResume, confirmedFacts),
  });
}

function buildMasterResumeEvidenceCorpus(
  confirmedFacts: ConfirmedFact[],
  sourceEvidence: SourceEvidence[],
) {
  return buildSupportedEvidenceCorpus([
    ...confirmedFacts.map((fact) => ({
      confidence: fact.confidence,
      label: fact.fact_type,
      sourceIds: fact.source_ids,
      status: fact.evidence_status,
      text: fact.fact_value,
      userConfirmed: fact.user_confirmed,
    })),
    ...sourceEvidence.map((source) => ({
      label: source.original_filename ?? source.source_url ?? source.source_type,
      status: "source_excerpt",
      text: source.extracted_text,
      userConfirmed: true,
    })),
  ]);
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
  "specialProjects": [
    {
      "name": "special project from evidence",
      "context": "role, client, program, or context from evidence or null",
      "dates": "dates from evidence or null",
      "bullets": ["evidence-backed project bullet"]
    }
  ],
  "languages": [
    {
      "name": "language from evidence",
      "proficiency": "proficiency from evidence or null"
    }
  ],
  "education": [
    {
      "institution": "school or university from evidence",
      "credential": "degree, diploma, or credential from evidence or null",
      "location": "location from evidence or null",
      "dates": "dates from evidence or null"
    }
  ],
  "certifications": [
    {
      "name": "certification/license name from evidence",
      "issuer": "issuer from evidence or null",
      "date": "date from evidence or null"
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
  return sanitizeResumeContent(resumeContentSchema.parse(JSON.parse(stripJsonFence(outputText)))).content;
}

function enrichMasterResumeWithSourceEvidence(
  resume: ResumeContent,
  sourceEvidence: SourceEvidence[],
) {
  const sourceSections = extractExperienceSectionsFromSources(sourceEvidence);
  const optionalResume = enrichMasterResumeWithOptionalSourceEvidence(resume, sourceEvidence);

  if (
    sourceSections.length === 0 &&
    optionalResume.education.length === resume.education.length &&
    optionalResume.certifications.length === resume.certifications.length &&
    optionalResume.languages.length === resume.languages.length &&
    optionalResume.specialProjects.length === resume.specialProjects.length &&
    Object.entries(optionalResume.contact).every(
      ([key, value]) => value === resume.contact[key as keyof ResumeContent["contact"]],
    )
  ) {
    return normalizeResumeContent({
      ...resume,
      reviewerNotes: [
        ...resume.reviewerNotes,
        ...readOptionalResumeReviewNotes(resume),
      ].slice(0, 8),
    });
  }

  return normalizeResumeContent({
    ...optionalResume,
    experienceSections:
      sourceSections.length > 0
        ? mergeExperienceSections(sourceSections, optionalResume.experienceSections)
        : optionalResume.experienceSections,
    reviewerNotes: [
      ...optionalResume.reviewerNotes,
      ...(sourceSections.length > 0
        ? ["Review the imported role timeline for exact dates, company names, and ownership scope before downloading files."]
        : []),
      ...readOptionalResumeReviewNotes({
        education: optionalResume.education,
        languages: optionalResume.languages,
        specialProjects: optionalResume.specialProjects,
      }),
    ].slice(0, 8),
  });
}

export function enrichMasterResumeWithOptionalSourceEvidence(
  resume: ResumeContent,
  sourceEvidence: SourceEvidence[],
) {
  const sourceContact = extractResumeContactFromSources(sourceEvidence);
  const sourceEducation = extractResumeEducationFromSources(sourceEvidence);
  const sourceCertifications = extractResumeCertificationsFromSources(sourceEvidence);
  const sourceLanguages = extractResumeLanguagesFromSources(sourceEvidence);
  const sourceSpecialProjects = extractResumeSpecialProjectsFromSources(sourceEvidence);

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
    education: resume.education.length > 0 ? resume.education : sourceEducation,
    certifications: resume.certifications.length > 0 ? resume.certifications : sourceCertifications,
    languages: resume.languages.length > 0 ? resume.languages : sourceLanguages,
    specialProjects: resume.specialProjects.length > 0 ? resume.specialProjects : sourceSpecialProjects,
  });
}

function enrichMasterResumeWithConfirmedFacts(
  resume: ResumeContent,
  confirmedFacts: ConfirmedFact[],
) {
  const factProjects = extractResumeSpecialProjectsFromFacts(confirmedFacts);

  if (factProjects.length === 0) {
    return resume;
  }

  return normalizeResumeContent({
    ...resume,
    specialProjects: dedupeResumeSpecialProjects([
      ...resume.specialProjects,
      ...factProjects,
    ]).slice(0, MAX_RESUME_SPECIAL_PROJECT_ITEMS),
  });
}

function readOptionalResumeReviewNotes(
  resume: Pick<ResumeContent, "education" | "languages" | "specialProjects">,
) {
  const missing: string[] = [];

  if (resume.specialProjects.length === 0) {
    missing.push("special projects");
  }

  if (resume.languages.length === 0) {
    missing.push("languages");
  }

  if (resume.education.length === 0) {
    missing.push("education");
  }

  if (missing.length === 0) {
    return [];
  }

  return [
    `Optional resume sections still missing: ${formatHumanList(missing)}. Add them if they strengthen the story; ${brand.name} will keep them off the resume until you provide them.`,
  ];
}

function formatHumanList(items: string[]) {
  if (items.length <= 1) {
    return items[0] ?? "";
  }

  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
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

function extractResumeEducationFromSources(sourceEvidence: SourceEvidence[]) {
  const text = stripRecommendationSourceSections(
    sourceEvidence
      .map((source) => source.extracted_text)
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n"),
  );
  const sectionText = extractNamedSectionText(text, ["education"], [
    "licenses",
    "certifications",
    "skills",
    "experience",
    "recommendations",
    "projects",
  ]);

  return sectionText
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 4)
    .filter((line) =>
      /\b(university|college|school|institute|academy|bachelor|master|mba|degree|diploma|engineering|science|commerce|arts)\b/i.test(
        line,
      ),
    )
    .slice(0, MAX_RESUME_EDUCATION_ITEMS)
    .map((line) => ({
      credential: extractCredential(line),
      dates: extractYearRange(line),
      institution: cleanCredentialLine(
        line
          .replace(extractCredential(line) ?? "", "")
          .replace(extractYearRange(line) ?? "", ""),
      ),
      location: null,
    }))
    .filter((item) => item.institution.length > 0);
}

function extractResumeCertificationsFromSources(sourceEvidence: SourceEvidence[]) {
  const text = stripRecommendationSourceSections(
    sourceEvidence
      .map((source) => source.extracted_text)
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n"),
  );
  const sectionText = extractNamedSectionText(text, ["licenses", "certifications", "certificates"], [
    "education",
    "skills",
    "experience",
    "recommendations",
    "projects",
  ]);

  return sectionText
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 4)
    .filter((line) => !/^\d+$/.test(line))
    .slice(0, MAX_RESUME_CERTIFICATION_ITEMS)
    .map((line) => ({
      date: extractYearRange(line),
      issuer: null,
      name: cleanCredentialLine(line.replace(extractYearRange(line) ?? "", "")),
    }))
    .filter((item) => item.name.length > 0);
}

function extractResumeLanguagesFromSources(sourceEvidence: SourceEvidence[]) {
  const text = stripRecommendationSourceSections(
    sourceEvidence
      .map((source) => source.extracted_text)
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n"),
  );
  const sectionText = extractNamedSectionText(text, ["languages"], [
    "education",
    "licenses",
    "certifications",
    "certificates",
    "skills",
    "top skills",
    "experience",
    "professional experience",
    "work history",
    "employment",
    "recommendations",
    "projects",
    "special projects",
    "publications",
    "honors",
    "awards",
  ]);

  return sectionText
    ? parseLanguageLines(sectionText)
    : [];
}

function parseLanguageLines(sectionText: string) {
  const lines = sectionText
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 3)
    .filter((line) => !/^\d+$/.test(line));
  const languages: ResumeContent["languages"] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (isLanguageProficiency(line)) {
      continue;
    }

    const item = parseLanguageLine(line);

    if (!item) {
      continue;
    }

    const nextLine = lines[index + 1];

    if (!item.proficiency && nextLine && isLanguageProficiency(nextLine)) {
      languages.push({
        ...item,
        proficiency: cleanCredentialLine(nextLine),
      });
      index += 1;
      continue;
    }

    languages.push(item);
  }

  return languages
    .slice(0, MAX_RESUME_LANGUAGE_ITEMS);
}

function parseLanguageLine(line: string): ResumeContent["languages"][number] | null {
  const cleaned = cleanCredentialLine(line);
  if (!cleaned || /recommend|endorse|worked with|pleasure/i.test(cleaned)) {
    return null;
  }

  const suffixProficiency = cleaned.match(
    /^(.{2,60}?)\s+(native or bilingual|full professional|professional working|limited working|elementary proficiency|professional proficiency|working proficiency|native|bilingual|fluent|conversational|intermediate|advanced|basic|beginner)$/i,
  );
  if (suffixProficiency && isLikelyLanguageName(suffixProficiency[1])) {
    return {
      name: cleanCredentialLine(suffixProficiency[1]),
      proficiency: cleanCredentialLine(suffixProficiency[2]),
    };
  }

  const parenthetical = cleaned.match(/^([^()|;:-]{2,80})\s*\(([^()]{2,80})\)$/);
  if (parenthetical && isLikelyLanguageName(parenthetical[1])) {
    return {
      name: cleanCredentialLine(parenthetical[1]),
      proficiency: cleanCredentialLine(parenthetical[2]),
    };
  }

  const separated = cleaned.split(/\s+(?:-|–|—|\||:|•)\s+/).filter(Boolean);
  if (separated.length >= 2 && isLikelyLanguageName(separated[0])) {
    return {
      name: cleanCredentialLine(separated[0]),
      proficiency: cleanCredentialLine(separated.slice(1).join(" ")),
    };
  }

  return isLikelyLanguageName(cleaned)
    ? {
        name: cleaned,
        proficiency: null,
      }
    : null;
}

function isLikelyLanguageName(value: string) {
  const cleaned = normalizeLanguageName(value);

  if (!cleaned || cleaned.length > 48) {
    return false;
  }

  if (
    /\b(?:executive|director|manager|summary|profile|automation|technology|enterprise|adoption|dubai|united arab emirates|portfolio|linkedin|experience|skills?)\b/i.test(
      cleaned,
    )
  ) {
    return false;
  }

  return KNOWN_LANGUAGE_NAMES.has(cleaned);
}

function isLanguageProficiency(value: string) {
  return /^(?:native or bilingual|full professional|professional working|limited working|elementary proficiency|professional proficiency|working proficiency|native|bilingual|fluent|conversational|intermediate|advanced|basic|beginner|mother tongue)$/i.test(
    cleanCredentialLine(value),
  );
}

function normalizeLanguageName(value: string) {
  return cleanCredentialLine(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const KNOWN_LANGUAGE_NAMES = new Set([
  "afrikaans",
  "arabic",
  "bengali",
  "cantonese",
  "chinese",
  "czech",
  "danish",
  "dutch",
  "english",
  "farsi",
  "french",
  "german",
  "greek",
  "gujarati",
  "hebrew",
  "hindi",
  "indonesian",
  "italian",
  "japanese",
  "kannada",
  "korean",
  "malay",
  "malayalam",
  "mandarin",
  "mandarin chinese",
  "marathi",
  "polish",
  "portuguese",
  "punjabi",
  "russian",
  "spanish",
  "swedish",
  "tagalog",
  "tamil",
  "telugu",
  "thai",
  "turkish",
  "urdu",
  "vietnamese",
]);

function extractResumeSpecialProjectsFromSources(sourceEvidence: SourceEvidence[]) {
  const text = stripRecommendationSourceSections(
    sourceEvidence
      .map((source) => source.extracted_text)
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n"),
  );
  const sectionText = extractNamedSectionText(text, ["projects", "special projects", "key projects"], [
    "languages",
    "education",
    "licenses",
    "certifications",
    "certificates",
    "skills",
    "top skills",
    "experience",
    "professional experience",
    "work history",
    "employment",
    "recommendations",
    "publications",
    "honors",
    "awards",
  ]);

  return sectionText
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 8)
    .filter((line) => !/^\d+$/.test(line))
    .filter(
      (line) =>
        !/\b(recommendation|recommended|worked with|pleasure|reported to|managed directly|colleague)\b/i.test(
          line,
        ),
    )
    .slice(0, MAX_RESUME_SPECIAL_PROJECT_ITEMS)
    .map(parseSpecialProjectLine)
    .filter((item) => item.name.length > 0)
    .filter((item) =>
      normalizeResumeContent({
        certifications: [],
        contact: {},
        education: [],
        experienceBullets: [],
        experienceSections: [],
        headline: "Project evidence",
        keywordGaps: [],
        languages: [],
        reviewerNotes: [],
        skills: ["Project"],
        specialProjects: [item],
        summary: "Project evidence.",
      }).specialProjects.length > 0,
    );
}

function extractResumeSpecialProjectsFromFacts(confirmedFacts: ConfirmedFact[]) {
  return confirmedFacts
    .filter((fact) => fact.user_confirmed || fact.evidence_status === "source_supported")
    .filter((fact) =>
      /\b(?:project|initiative|program|publication)\b/i.test(fact.fact_type) ||
      /\b(?:project|initiative|program(?:me)?|implementation|migration|rollout|launch|integration|automation|redesign|deployment|optimization|publication)\b/i.test(
        fact.fact_value,
      ),
    )
    .map((fact) => fact.fact_value.replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 12)
    .filter((value) =>
      /\b(?:built|created|launched|led|delivered|implemented|migrated|integrated|designed|redesigned|automated|optimized|improved|reduced|increased|published|awarded|won|shipped|deployed|transformed|coordinated|managed)\b/i.test(
        value,
      ),
    )
    .filter(
      (value) =>
        !/\b(recommendation|recommended|worked with|pleasure|reported to|managed directly|colleague)\b/i.test(
          value,
        ),
    )
    .map(parseSpecialProjectLine)
    .filter((item) => item.name.length > 0)
    .filter((item) =>
      normalizeResumeContent({
        certifications: [],
        contact: {},
        education: [],
        experienceBullets: [],
        experienceSections: [],
        headline: "Project evidence",
        keywordGaps: [],
        languages: [],
        reviewerNotes: [],
        skills: ["Project"],
        specialProjects: [item],
        summary: "Project evidence.",
      }).specialProjects.length > 0,
    )
    .slice(0, MAX_RESUME_SPECIAL_PROJECT_ITEMS);
}

function parseSpecialProjectLine(value: string): ResumeContent["specialProjects"][number] {
  const dates = extractYearRange(value);
  const cleanLine = cleanCredentialLine(value.replace(dates ?? "", ""));
  const [name, ...rest] = cleanLine.split(/\s+(?:-|–|—|:|•)\s+/).filter(Boolean);
  const cleanName = name && rest.length > 0 ? cleanCredentialLine(name) : cleanLine.slice(0, 150);

  return {
    bullets: rest.length > 0 ? [cleanCredentialLine(rest.join(" "))] : [cleanLine],
    context: null,
    dates,
    name: cleanName,
  };
}

function extractNamedSectionText(text: string, starts: string[], stops: string[]) {
  const lines = text.split(/\n+/);
  const startIndex = lines.findIndex((line) =>
    starts.some((start) => sectionHeadingMatches(line, start)),
  );

  if (startIndex < 0) {
    return "";
  }

  const stopIndex = lines.findIndex(
    (line, index) =>
      index > startIndex &&
      stops.some((stop) => sectionHeadingMatches(line, stop)),
  );

  return lines.slice(startIndex + 1, stopIndex > startIndex ? stopIndex : undefined).join("\n");
}

function sectionHeadingMatches(line: string, heading: string) {
  return compactSectionHeading(line) === compactSectionHeading(heading);
}

function compactSectionHeading(value: string) {
  return value
    .trim()
    .replace(/[:：]+$/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function extractCredential(value: string) {
  return (
    value.match(
      /\b(?:Bachelor|Master|MBA|B\.?S\.?|M\.?S\.?|B\.?A\.?|M\.?A\.?|BEng|MEng|Diploma|Degree)[^,|;]*/i,
    )?.[0] ?? null
  );
}

function extractYearRange(value: string) {
  return value.match(/\b(?:19|20)\d{2}(?:\s*[-–]\s*(?:(?:19|20)\d{2}|Present|Current))?\b/i)?.[0] ?? null;
}

function cleanCredentialLine(value: string) {
  return value.replace(/[|,;:•-]+$/g, "").replace(/^[|,;:•-]+/g, "").replace(/\s+/g, " ").trim();
}

function normalizeLinkedInUrl(value: string) {
  const cleanValue = value.replace(/[).,;]+$/g, "");
  return cleanValue.startsWith("http") ? cleanValue : `https://${cleanValue}`;
}

function extractExperienceSectionsFromSources(sourceEvidence: SourceEvidence[]) {
  const sections = sourceEvidence
    .flatMap((source) => extractExperienceSectionsFromText(stripRecommendationSourceSections(source.extracted_text ?? "")))
    .filter((section) => section.roleTitle && (section.company || section.dates || section.bullets.length > 0));

  return dedupeResumeExperienceSections(sections)
    .slice(0, MAX_RESUME_EXPERIENCE_SECTIONS);
}

function mergeExperienceSections(
  sourceSections: ResumeContent["experienceSections"],
  modelSections: ResumeContent["experienceSections"],
) {
  return dedupeResumeExperienceSections([...sourceSections, ...modelSections]).slice(
    0,
    MAX_RESUME_EXPERIENCE_SECTIONS,
  );
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
  const { content: normalizedResume } = sanitizeResumeContent(parsed.resume);
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
      claim_review_acknowledged_at: null,
      claim_review_acknowledged_by: null,
      claim_review_acknowledgement: {},
      content_json: normalizedResume,
      docx_storage_path: null,
      export_failed_reason: null,
      export_status: "not_exported",
      export_validation: {},
      export_validated_at: null,
      pdf_storage_path: null,
      prompt_version: MASTER_RESUME_PROMPT_VERSION,
      status: "draft",
    })
    .eq("id", latestResume.id)
    .eq("user_id", userId);

  if (updateError) {
    throw new Error("MASTER_RESUME_UPDATE_FAILED");
  }

  return getMasterResumeOverview(userId);
}

export async function getReusableMasterResumeExport(): Promise<MasterResumeOverview | null> {
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
    .select("docx_storage_path, pdf_storage_path, status, export_status, export_validated_at")
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

  if (!isResumeExportReady(latestResume)) {
    return null;
  }

  return getMasterResumeOverview(userId);
}

export async function exportMasterResumeArtifacts(
  options: {
    acknowledgeClaimReview?: boolean;
    sectionVisibility?: ResumeExportSectionVisibility;
  } = {},
): Promise<MasterResumeArtifactExportResult> {
  const { supabase, userId } = await getAuthenticatedContext();
  const sectionVisibility =
    options.sectionVisibility ?? defaultResumeExportSectionVisibility;
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
    .select(
      "id, content_json, docx_storage_path, pdf_storage_path, prompt_version, status, export_status, claim_review_acknowledged_at, claim_review_acknowledgement",
    )
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

  if (
    isDefaultResumeExportSectionVisibility(sectionVisibility) &&
    isResumeExportReady(latestResume)
  ) {
    return {
      didExport: false,
      overview: await getMasterResumeOverview(userId),
    };
  }

  const { data: sourceEvidence, error: sourceError } = await supabase
    .from("profile_sources")
    .select("id, source_type, source_url, original_filename, extracted_text, created_at")
    .eq("profile_id", profile.id)
    .eq("user_id", userId)
    .not("extracted_text", "is", null)
    .order("created_at", { ascending: false })
    .limit(30);

  if (sourceError) {
    console.warn("master_resume.source_evidence_read_failed", {
      profileId: profile.id,
      userIdHash: hashUserId(userId),
    });
  }

  const { data: confirmedFacts, error: factsError } = await supabase
    .from("profile_facts")
    .select("id, fact_type, fact_value, confidence, evidence_status, origin, source_ids, user_confirmed")
    .eq("profile_id", profile.id)
    .eq("user_id", userId)
    .order("confidence", { ascending: false })
    .limit(80);

  if (factsError) {
    throw new Error("PROFILE_FACTS_READ_FAILED");
  }

  const { content: resume } = sanitizeResumeContent(latestResume.content_json);
  const normalizedResume = normalizeResumeForSavedRead({
    confirmedFacts: confirmedFacts ?? [],
    resume,
    sourceEvidence: sourceError ? [] : prioritizeSourceEvidence(sourceEvidence ?? []),
    promptVersion: latestResume.prompt_version,
  });

  const blockingRisks = getBlockingExportRisks(normalizedResume);

  if (
    blockingRisks.length > 0 &&
    !hasCurrentClaimReviewAcknowledgement({
      acknowledgement: latestResume.claim_review_acknowledgement,
      content: normalizedResume,
      risks: blockingRisks,
    })
  ) {
    if (!options.acknowledgeClaimReview) {
      throw new ClaimReviewRequiredError("MASTER_RESUME_CLAIM_REVIEW_REQUIRED", blockingRisks);
    }

    await acknowledgeMasterResumeClaimReview({
      content: normalizedResume,
      resumeId: latestResume.id,
      risks: blockingRisks,
      supabase,
      userId,
    });
  }

  await markMasterResumeExportStatus({
    resumeId: latestResume.id,
    status: "export_pending",
    supabase,
    userId,
  });

  const exportResume = applyResumeExportSectionVisibility(normalizedResume, sectionVisibility);
  const requiredSections = [
    "Skills",
    "Experience",
    exportResume.experienceBullets.length > 0 ? "Selected Highlights" : null,
    exportResume.specialProjects.length > 0 ? "Special Projects" : null,
    exportResume.languages.length > 0 ? "Languages" : null,
    exportResume.education.length > 0 ? "Education" : null,
    exportResume.certifications.length > 0 ? "Certifications" : null,
  ].filter((item): item is string => Boolean(item));

  const templateInput = {
    contextLine: [profile.target_direction, profile.target_level].filter(Boolean).join(" | "),
    displayName: profile.display_name,
    resume: exportResume,
  };
  const [pdfBytes, docxBytes] = await Promise.all([
    buildAtsResumePdf(templateInput),
    buildAtsResumeDocx(templateInput),
  ]);
  const [pdfValidation, docxValidation] = await Promise.all([
    validateGeneratedPdf({
      bytes: pdfBytes,
      maxPages: 4,
      requiredPhrases: [exportResume.headline, exportResume.summary],
      requiredSections,
    }),
    validateGeneratedDocx({
      bytes: docxBytes,
      requiredPhrases: [exportResume.headline, exportResume.summary],
    }),
  ]);

  if (!pdfValidation.valid || !docxValidation.valid) {
    await markMasterResumeExportStatus({
      reason: "ARTIFACT_VALIDATION_FAILED",
      resumeId: latestResume.id,
      status: "export_failed",
      supabase,
      userId,
      validation: {
        docx: docxValidation,
        pdf: pdfValidation,
      },
    });
    throw new Error("ARTIFACT_VALIDATION_FAILED");
  }

  const pdfPath = `${userId}/master/${latestResume.id}-master-resume.pdf`;
  const docxPath = `${userId}/master/${latestResume.id}-master-resume.docx`;
  const uploadedPaths: string[] = [];

  try {
    await uploadArtifact(pdfPath, pdfBytes, "application/pdf");
    await uploadArtifact(
      docxPath,
      docxBytes,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    const { error: updateError } = await supabase
      .from("generated_resumes")
      .update({
        docx_storage_path: docxPath,
        export_failed_reason: null,
        export_status: "export_validated",
        export_validation: {
          docx: docxValidation,
          pdf: pdfValidation,
          sectionVisibility,
        },
        export_validated_at: new Date().toISOString(),
        pdf_storage_path: pdfPath,
        status: "ready",
      })
      .eq("id", latestResume.id)
      .eq("user_id", userId);

    if (updateError) {
      throw new Error("ARTIFACT_METADATA_UPDATE_FAILED");
    }
  } catch (error) {
    if (uploadedPaths.length > 0) {
      await supabase.storage.from(GENERATED_ARTIFACT_BUCKET).remove(uploadedPaths).catch(() => undefined);
    }
    await markMasterResumeExportStatus({
      reason: error instanceof Error ? error.message : "ARTIFACT_EXPORT_FAILED",
      resumeId: latestResume.id,
      status: "export_failed",
      supabase,
      userId,
    }).catch(() => undefined);
    throw error;
  }

  return {
    didExport: true,
    overview: await getMasterResumeOverview(userId),
  };

  async function uploadArtifact(path: string, bytes: Uint8Array, contentType: string) {
    const { error } = await supabase.storage.from(GENERATED_ARTIFACT_BUCKET).upload(path, bytes, {
      contentType,
      upsert: true,
    });

    if (error) {
      throw new Error("ARTIFACT_UPLOAD_FAILED");
    }

    uploadedPaths.push(path);
  }
}

function isResumeExportReady(resume: {
  docx_storage_path: string | null;
  export_status?: string | null;
  export_validated_at?: string | null;
  pdf_storage_path: string | null;
  status: string;
}) {
  return (
    resume.status === "ready" &&
    readExportStatus(resume.export_status) === "export_validated" &&
    Boolean(resume.export_validated_at) &&
    Boolean(resume.docx_storage_path && resume.pdf_storage_path)
  );
}

async function acknowledgeMasterResumeClaimReview({
  content,
  resumeId,
  risks,
  supabase,
  userId,
}: {
  content: ResumeContent;
  resumeId: string;
  risks: ReturnType<typeof getBlockingExportRisks>;
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}) {
  const acknowledgedAt = new Date().toISOString();
  const { error } = await supabase
    .from("generated_resumes")
    .update({
      claim_review_acknowledged_at: acknowledgedAt,
      claim_review_acknowledged_by: userId,
      claim_review_acknowledgement: {
        acknowledgedAt,
        artifactId: resumeId,
        artifactType: "master_resume",
        contentHash: hashJson(content),
        profileVersion: hashJson({
          headline: content.headline,
          summary: content.summary,
          skills: content.skills,
        }),
        risks,
        riskHash: hashJson(risks),
        riskCount: risks.length,
        riskText: risks.map((risk) => risk.text),
        userId,
      },
    })
    .eq("id", resumeId)
    .eq("user_id", userId);

  if (error) {
    throw new Error("MASTER_RESUME_CLAIM_ACK_SAVE_FAILED");
  }
}

function hasCurrentClaimReviewAcknowledgement({
  acknowledgement,
  content,
  risks,
}: {
  acknowledgement: unknown;
  content: ResumeContent;
  risks: ReturnType<typeof getBlockingExportRisks>;
}) {
  const parsed = z
    .object({
      contentHash: z.string(),
      riskHash: z.string(),
    })
    .safeParse(acknowledgement);

  return (
    parsed.success &&
    parsed.data.contentHash === hashJson(content) &&
    parsed.data.riskHash === hashJson(risks)
  );
}

async function markMasterResumeExportStatus({
  reason = null,
  resumeId,
  status,
  supabase,
  userId,
  validation = {},
}: {
  reason?: string | null;
  resumeId: string;
  status: ExportStatus;
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  validation?: Record<string, unknown>;
}) {
  const { error } = await supabase
    .from("generated_resumes")
    .update({
      export_failed_reason: status === "export_failed" ? reason : null,
      export_status: status,
      export_validation: validation,
      export_validated_at: status === "export_validated" ? new Date().toISOString() : null,
    })
    .eq("id", resumeId)
    .eq("user_id", userId);

  if (error) {
    throw new Error("ARTIFACT_METADATA_UPDATE_FAILED");
  }
}

function readExportStatus(value: unknown): ExportStatus {
  return value === "export_pending" || value === "export_validated" || value === "export_failed"
    ? value
    : "not_exported";
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
    .select("id, fact_type, fact_value, confidence, evidence_status, origin, source_ids, user_confirmed")
    .eq("profile_id", profile.id)
    .eq("user_id", userId)
    .order("confidence", { ascending: false })
    .limit(80);
  const { data: sourceEvidence, error: sourceError } = await supabase
    .from("profile_sources")
    .select("id, source_type, source_url, original_filename, extracted_text, created_at")
    .eq("profile_id", profile.id)
    .eq("user_id", userId)
    .not("extracted_text", "is", null)
    .order("created_at", { ascending: false })
    .limit(30);
  const { data: careerProfile, error: careerProfileError } = await supabase
    .from("career_profiles")
    .select("id, version_number, content_json, updated_at")
    .eq("profile_id", profile.id)
    .eq("user_id", userId)
    .eq("is_current", true)
    .neq("status", "deleted")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (factsError) {
    throw new Error("PROFILE_FACTS_READ_FAILED");
  }

  if (sourceError) {
    console.warn("master_resume.source_evidence_read_failed", {
      profileId: profile.id,
      userIdHash: hashUserId(userId),
    });
  }

  if (careerProfileError) {
    console.warn("master_resume.career_profile_read_failed", {
      profileId: profile.id,
      userIdHash: hashUserId(userId),
    });
  }

  const prioritizedSourceEvidence = sourceError ? [] : prioritizeSourceEvidence(sourceEvidence ?? []);
  const canonicalSource = careerProfile?.content_json
    ? [
        {
          created_at: careerProfile.updated_at,
          extracted_text: JSON.stringify(careerProfile.content_json),
          id: careerProfile.id,
          original_filename: `Canonical career profile v${careerProfile.version_number}`,
          source_type: "career_profile",
          source_url: null,
        },
      ]
    : [];

  return {
    confirmedFacts: confirmedFacts ?? [],
    profile,
    sourceEvidence: [...canonicalSource, ...prioritizedSourceEvidence],
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
          content: normalizeResumeForSavedRead({
            confirmedFacts,
            resume: sanitizeResumeContent(latestResume.content_json).content,
            sourceEvidence,
            promptVersion: latestResume.prompt_version,
          }),
          docxDownloadUrl: buildArtifactDownloadUrl({
            format: "docx",
            hasFile: isResumeExportReady(latestResume),
            id: latestResume.id,
          }),
          id: latestResume.id,
          model: latestResume.model,
          pdfDownloadUrl: buildArtifactDownloadUrl({
            format: "pdf",
            hasFile: isResumeExportReady(latestResume),
            id: latestResume.id,
          }),
          promptVersion: latestResume.prompt_version,
          status: latestResume.status,
          updatedAt: latestResume.updated_at,
        }
      : null,
    missingEvidence,
  });
}

function normalizeResumeForSavedRead({
  confirmedFacts = [],
  promptVersion,
  resume,
  sourceEvidence,
}: {
  confirmedFacts?: ConfirmedFact[];
  promptVersion: string | null;
  resume: ResumeContent;
  sourceEvidence: SourceEvidence[];
}) {
  const { content: normalizedResume } = sanitizeResumeContent(resume);

  if (promptVersion === MASTER_RESUME_PROMPT_VERSION || sourceEvidence.length === 0) {
    return enrichMasterResumeWithConfirmedFacts(normalizedResume, confirmedFacts);
  }

  return enrichMasterResumeWithConfirmedFacts(
    enrichMasterResumeWithOptionalSourceEvidence(normalizedResume, sourceEvidence),
    confirmedFacts,
  );
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

Never treat LinkedIn Recommendations, testimonials, references, endorsements,
third-party praise, or "worked with" sections as work experience. Those sources
can inform reviewerNotes only if useful, but they must not become roleTitle,
company, dates, location, or work-history bullets.

Never write placeholder resume bullets. Do not output phrases like "Held [role]
at [company]", "Add measurable scope and outcomes", "responsibilities
included", or any bullet that asks the user to add details. If a role has no
real responsibility, scope, or outcome evidence, keep bullets empty and add a
reviewerNote asking for the missing scope outside the resume body.

Use this standard ATS section order: Professional Summary, Core Skills,
Selected Highlights, Professional Experience, Special Projects, Languages,
Education, Certifications. The headline must be a concise title or positioning
line under 95 characters, not a pipe-delimited keyword list. Put keyword
breadth into skills and experience, not the title. The summary should be tight
enough for a resume preview, usually 90-140 words.

Include a contact object for email, phone, LinkedIn URL, website, and location
when those details appear in the profile or readable source evidence. Use null
for missing contact fields. Do not invent contact details.

Preserve special projects, languages, education, and certifications/licenses in
their own arrays when they appear in profile or source evidence. Use empty
arrays when absent, and mention the missing optional sections in reviewerNotes
instead of rendering empty resume sections. Special Projects are standalone
initiatives, transformations, programs, or advisory/projects that are not
ordinary role responsibilities. Languages should only contain language names and
proficiency. Do not turn recommendations, testimonials, endorsements, interests,
or public praise into special projects, languages, education, certifications, or
work-history roles.

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

Use evidence-status labels strictly. Confirmed and source-supported facts may
be used as resume claims. Facts marked needs_confirmation, conflict, or
missing_evidence must not appear as hard claims; convert them into cautious
reviewerNotes, keywordGaps, or direct confirmation questions.

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
  const evidenceBundle = buildMasterResumeEvidenceBundle({
    confirmedFacts,
    sourceEvidence,
  });

  return `
Profile:
- Name: ${profile.display_name ?? "Not provided"}
- Current headline: ${profile.headline ?? "Not provided"}
- Current summary: ${profile.summary ?? "Not provided"}
- Target direction: ${profile.target_direction ?? "Not provided"}
- Target level: ${profile.target_level ?? "Not provided"}

Profile evidence:
${confirmedFacts.map((fact) => `- ${fact.fact_type} [${mapFactSupport(fact)}]: ${fact.fact_value}`).join("\n")}

Evidence bundle:
${formatMasterResumeEvidenceBundle(evidenceBundle)}

Readable source excerpts:
${formatSourceEvidenceForPrompt(sourceEvidence)}

Treat readable source excerpts as user-provided evidence. If extracted profile
facts are thin but source excerpts contain structured LinkedIn/resume history,
use the source excerpts to build role-based experience sections. Keep claims
grounded in the excerpt text.

Only use Special Projects when the evidence bundle or readable excerpts show a
standalone initiative with action, context or source support, and non-testimonial
language. Do not use broad labels, praise, recommendations, or unsupported
portfolio/program wording as projects.

Profile intelligence:
- Evidence strength: ${intelligence.evidenceStrength}
- Role target read: ${intelligence.roleTargetRead}
- Domain read:
${formatIntelligenceDomainReadForPrompt(intelligence)}
- Seniority read: ${intelligence.seniorityRead.label} (${intelligence.seniorityRead.confidence})
- Positioning context: ${intelligence.positioningSignals.join(", ") || "None yet"}
- Resume focus: ${intelligence.resumeFocus.join(" | ") || "None yet"}
- Domain-specific metric families: ${intelligence.advisorPromptPack.metricFamilies.join(" | ") || "None yet"}
- Domain/seniority resume implications: ${intelligence.advisorPromptPack.resumeImplications.join(" | ") || "None yet"}
- Suggested evidence questions:
${intelligence.advisorPromptPack.gentlePrompts.length > 0 ? intelligence.advisorPromptPack.gentlePrompts.map((prompt) => `  - ${prompt}`).join("\n") : "  - None yet"}
- Impact themes:
${intelligence.proofThemes.length > 0 ? intelligence.proofThemes.map((theme) => `  - ${theme.label}: ${theme.evidence.join(" / ")}`).join("\n") : "  - None yet"}
- High-value gaps to resolve:
${intelligence.highValueGaps.length > 0 ? intelligence.highValueGaps.map((gap) => `  - [${gap.severity}] ${gap.label}: ${gap.prompt}`).join("\n") : "  - None"}

User refinement instruction:
${instruction ?? "No extra instruction."}

Return structured JSON only.
`.trim();
}

function buildMasterResumeEvidenceBundle({
  confirmedFacts,
  sourceEvidence,
}: {
  confirmedFacts: ConfirmedFact[];
  sourceEvidence: SourceEvidence[];
}): MasterResumeEvidenceBundle {
  const sourceById = new Map(sourceEvidence.map((source) => [source.id, source]));
  const factTypesBySourceId = new Map<string, Set<string>>();

  for (const fact of confirmedFacts) {
    for (const sourceId of fact.source_ids ?? []) {
      const types = factTypesBySourceId.get(sourceId) ?? new Set<string>();
      types.add(fact.fact_type);
      factTypesBySourceId.set(sourceId, types);
    }
  }

  return {
    facts: confirmedFacts.slice(0, 80).map((fact) => {
      const sourceLabels = (fact.source_ids ?? [])
        .map((sourceId) => sourceById.get(sourceId))
        .filter((source): source is SourceEvidence => Boolean(source))
        .map(formatSourceEvidenceLabel)
        .slice(0, 4);

      return {
        confidence: fact.confidence,
        factType: fact.fact_type,
        factValue: fact.fact_value,
        sourceLabels,
        support: mapFactSupport(fact),
      };
    }),
    sources: sourceEvidence.map((source) => ({
      label: formatSourceEvidenceLabel(source),
      linkedFactTypes: Array.from(factTypesBySourceId.get(source.id) ?? []).sort(),
      readableCharacters: source.extracted_text?.replace(/\s+/g, " ").trim().length ?? 0,
      sourceType: source.source_type,
    })),
    sourceTimelines: sourceEvidence
      .map((source) => ({
        label: formatSourceEvidenceLabel(source),
        roles: extractExperienceSectionsFromText(stripRecommendationSourceSections(source.extracted_text ?? ""))
          .slice(0, 8)
          .map((section) => ({
            bullets: section.bullets.slice(0, 4),
            company: section.company,
            dates: section.dates,
            location: section.location,
            roleTitle: section.roleTitle,
          })),
      }))
      .filter((source) => source.roles.length > 0),
  };
}

function formatMasterResumeEvidenceBundle(bundle: MasterResumeEvidenceBundle) {
  const factLines = bundle.facts
    .slice(0, 24)
    .map((fact) => {
      const sourceNote =
        fact.sourceLabels.length > 0 ? `; sources: ${fact.sourceLabels.join(", ")}` : "";
      return `- ${fact.factType} [${fact.support}${sourceNote}]: ${fact.factValue}`;
    });
  const sourceLines = bundle.sources.map(
    (source) =>
      `- ${source.label}: ${source.sourceType}, ${source.readableCharacters} readable chars, linked fact types ${source.linkedFactTypes.join(", ") || "none"}`,
  );
  const timelineLines = bundle.sourceTimelines.flatMap((source) => [
    `- ${source.label}`,
    ...source.roles.map((role) => {
      const meta = [role.roleTitle, role.company, role.dates, role.location].filter(Boolean).join(" | ");
      const bullets = role.bullets.length > 0 ? `; bullets: ${role.bullets.join(" / ")}` : "";
      return `  - ${meta}${bullets}`;
    }),
  ]);

  return [
    "Facts with support:",
    factLines.length > 0 ? factLines.join("\n") : "- None",
    "Sources:",
    sourceLines.length > 0 ? sourceLines.join("\n") : "- None",
    "Parsed role timelines:",
    timelineLines.length > 0 ? timelineLines.join("\n") : "- None",
  ].join("\n");
}

function mapFactSupport(
  fact: ConfirmedFact,
): MasterResumeEvidenceBundle["facts"][number]["support"] {
  if (fact.user_confirmed || fact.evidence_status === "user_confirmed") {
    return "confirmed";
  }

  if (fact.evidence_status === "source_supported") {
    return "source_supported";
  }

  if (fact.evidence_status === "conflict") {
    return "conflict";
  }

  if (fact.evidence_status === "missing_evidence") {
    return "missing_evidence";
  }

  return "needs_confirmation";
}

function formatSourceEvidenceLabel(source: SourceEvidence) {
  return source.original_filename ?? source.source_url ?? source.source_type;
}

function formatIntelligenceDomainReadForPrompt(intelligence: ProfileIntelligence) {
  if (intelligence.domainReads.length === 0) {
    return "  - No confident domain read yet";
  }

  return intelligence.domainReads
    .map(
      (read) =>
        `  - ${read.label} (${read.confidence}; evidence: ${
          read.evidenceTerms.slice(0, 8).join(", ") || "none"
        })`,
    )
    .join("\n");
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
  const cleanText = stripRecommendationSourceSections(text ?? "").replace(/\s+/g, " ").trim();

  if (!cleanText) {
    return null;
  }

  if (cleanText.length <= 14000) {
    return cleanText;
  }

  const windows: Array<{ end: number; start: number }> = [{ start: 0, end: 1300 }];
  const sectionPattern =
    /\b(summary|experience|employment|work history|professional experience|projects?|skills?|education|certifications?|licenses?|awards?|honou?rs?|publications?|volunteer)\b/gi;
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

function stripRecommendationSourceSections(value: string) {
  const decoded = value
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  const recommendationMatch = /(?:^|\n|\r)\s*(recommendations?|testimonials?|endorsements?|references?)\s*(?:\n|\r|$)/i.exec(
    decoded,
  );

  if (!recommendationMatch) {
    return decoded;
  }

  return decoded.slice(0, recommendationMatch.index).trim();
}

function buildArtifactDownloadUrl({
  format,
  hasFile,
  id,
}: {
  format: "docx" | "pdf";
  hasFile: boolean;
  id: string;
}) {
  return hasFile ? `/api/artifacts/resume/${id}/download?format=${format}` : null;
}

function hashUserId(userId: string) {
  return createHash("sha256").update(userId).digest("hex").slice(0, 64);
}

function hashOperationInput(value: string) {
  return createHash("sha256").update(value.trim() || "default").digest("hex").slice(0, 24);
}

function hashJson(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}
