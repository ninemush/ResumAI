import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import {
  APPLICATION_MATERIALS_INSTRUCTIONS,
  APPLICATION_MATERIALS_PROMPT_VERSION,
} from "@/lib/ai/prompts/application-materials";
import {
  buildSupportedEvidenceCorpus,
  reviewCoverLetterClaimProvenance,
  reviewResumeClaimProvenance,
} from "@/lib/ai/claim-provenance";
import { getMaterialsModel, createOpenAIResponse } from "@/lib/ai/openai";
import { analyzeJobFit, readUserFitContext, type JobFitAnalysis } from "@/lib/jobs/job-fit";
import {
  buildProfileIntelligence,
  type ProfileIntelligence,
} from "@/lib/profile/profile-intelligence";
import {
  finalizeQuotaReservation,
  releaseQuotaReservation,
  reserveQuotaEvent,
  type QuotaReservationResult,
} from "@/lib/quota/quota-events";
import {
  MAX_RESUME_CERTIFICATION_ITEMS,
  MAX_RESUME_EDUCATION_ITEMS,
  MAX_RESUME_EXPERIENCE_SECTIONS,
  MAX_RESUME_LANGUAGE_ITEMS,
  MAX_RESUME_SPECIAL_PROJECT_ITEMS,
  normalizeResumeContent,
  parseResumeContent,
  resumeContentSchema,
  type ResumeContent,
} from "@/lib/resumes/resume-content";
import { createClient } from "@/lib/supabase/server";

export const generateApplicationMaterialsSchema = z.object({
  applicationId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(8).max(180).optional(),
  mode: z.enum(["reuse", "regenerate"]).default("reuse"),
  reason: z.string().trim().max(500).optional(),
});

const generatedMaterialsSchema = z.object({
  resume: resumeContentSchema,
  coverLetter: z.string().min(1).max(4000),
});

export type GenerateApplicationMaterialsResult = {
  coverLetterId: string;
  didGenerate: boolean;
  model: string;
  promptVersion: string;
  resumeId: string;
  summary: string;
};

type ApplicationContext = {
  id: string;
  company_name: string;
  fit_decision: string | null;
  fit_decision_reason: string | null;
  job_title: string | null;
  job_url: string;
  profile_id: string;
  job_ingestions: {
    id: string;
    extracted_text: string | null;
    title: string | null;
    company: string | null;
  } | null;
};

type RawApplicationContext = Omit<ApplicationContext, "job_ingestions"> & {
  job_ingestions:
    | ApplicationContext["job_ingestions"]
    | NonNullable<ApplicationContext["job_ingestions"]>[];
};

export async function getReusableApplicationMaterials(
  input: z.input<typeof generateApplicationMaterialsSchema>,
): Promise<GenerateApplicationMaterialsResult | null> {
  const parsed = generateApplicationMaterialsSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { data: application, error: applicationError } = await supabase
    .from("applications")
    .select("id, company_name, job_title")
    .eq("id", parsed.applicationId)
    .eq("user_id", user.id)
    .single();

  if (applicationError || !application) {
    throw new Error("APPLICATION_NOT_FOUND");
  }

  const existingMaterials = await readLatestMaterialPair({
    applicationId: parsed.applicationId,
    userId: user.id,
  });

  if (!existingMaterials) {
    return null;
  }

  return buildReusableMaterialsResult({
    application,
    coverLetter: existingMaterials.coverLetter,
    resume: existingMaterials.resume,
  });
}

export async function generateApplicationMaterials(
  input: z.input<typeof generateApplicationMaterialsSchema>,
  options: { quotaOperationKey?: string } = {},
): Promise<GenerateApplicationMaterialsResult> {
  const parsed = generateApplicationMaterialsSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { data: application, error: applicationError } = await supabase
    .from("applications")
    .select(
      "id, company_name, fit_decision, fit_decision_reason, job_title, job_url, profile_id, job_ingestions(id, extracted_text, title, company)",
    )
    .eq("id", parsed.applicationId)
    .eq("user_id", user.id)
    .single();

  if (applicationError || !application) {
    throw new Error("APPLICATION_NOT_FOUND");
  }

  const context = normalizeApplicationContext(application);
  const existingMaterials = await readLatestMaterialPair({
    applicationId: context.id,
    userId: user.id,
  });

  if (existingMaterials && parsed.mode !== "regenerate") {
    return buildReusableMaterialsResult({
      application: context,
      coverLetter: existingMaterials.coverLetter,
      resume: existingMaterials.resume,
    });
  }

  assertApplicationMaterialDecisionAllowsGeneration(context);

  if (!context.job_ingestions?.extracted_text) {
    throw new Error("JOB_TEXT_REQUIRED");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name, headline, summary, target_direction, target_level")
    .eq("id", context.profile_id)
    .eq("user_id", user.id)
    .single();

  if (profileError || !profile) {
    throw new Error("PROFILE_NOT_FOUND");
  }

  const { data: facts, error: factsError } = await supabase
    .from("profile_facts")
    .select("fact_type, fact_value, confidence, evidence_status, user_confirmed")
    .eq("profile_id", context.profile_id)
    .eq("user_id", user.id)
    .order("user_confirmed", { ascending: false })
    .order("confidence", { ascending: false })
    .limit(80);

  if (factsError) {
    throw new Error("PROFILE_FACTS_READ_FAILED");
  }

  if ((facts ?? []).length < 3 && !profile.summary) {
    throw new Error("PROFILE_CONTEXT_TOO_THIN");
  }

  const [masterResume, fitContext] = await Promise.all([
    readLatestMasterResume({
      profileId: context.profile_id,
      userId: user.id,
    }),
    readUserFitContext(user.id),
  ]);
  const fitAnalysis = analyzeJobFit({
    jobText: context.job_ingestions.extracted_text,
    masterResume,
    profileFacts: fitContext.profileFacts,
  });
  const intelligence = buildProfileIntelligence({
    facts: facts ?? [],
    profile,
  });
  const model = getMaterialsModel();
  const quotaReservation = await reserveQuotaEvent({
    eventType: "generation_created",
    metadata: {
      application_id: context.id,
      model,
      prompt_version: APPLICATION_MATERIALS_PROMPT_VERSION,
    },
    operationKey:
      options.quotaOperationKey ??
      `applicationMaterialsGenerate:${context.id}:${parsed.mode}:${hashOperationInput(parsed.reason ?? "default")}`,
    resourceId: context.id,
    resourceType: "application_materials",
  });

  try {
    const response = await createOpenAIResponse({
      model,
      instructions: APPLICATION_MATERIALS_INSTRUCTIONS,
      input: buildMaterialsInput({
        application: context,
        facts: facts ?? [],
        fitAnalysis,
        intelligence,
        masterResume,
        profile,
      }),
      max_output_tokens: 3400,
      metadata: {
        application_id: context.id,
        feature: "application_materials",
        fit_recommendation: fitAnalysis.recommendation,
        fit_score: fitAnalysis.score?.toString() ?? "unknown",
        prompt_version: APPLICATION_MATERIALS_PROMPT_VERSION,
      },
      safety_identifier: hashUserId(user.id),
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "application_materials",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["resume", "coverLetter"],
            properties: {
              resume: {
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
                    maxItems: 18,
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
                        company: { anyOf: [{ type: "string" }, { type: "null" }] },
                        location: { anyOf: [{ type: "string" }, { type: "null" }] },
                        dates: { anyOf: [{ type: "string" }, { type: "null" }] },
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
                          maxItems: 6,
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
                    maxItems: 10,
                    items: { type: "string" },
                  },
                  keywordGaps: {
                    type: "array",
                    maxItems: 12,
                    items: { type: "string" },
                  },
                  reviewerNotes: {
                    type: "array",
                    maxItems: 6,
                    items: { type: "string" },
                  },
                },
              },
              coverLetter: { type: "string" },
            },
          },
        },
        verbosity: "medium",
      },
    });

    if (response.error || response.incomplete_details) {
      throw new Error("AI_MATERIALS_FAILED");
    }

    const generated = generatedMaterialsSchema.parse(JSON.parse(response.output_text));
    const generatedResume = reviewResumeClaimProvenance({
      evidenceCorpus: buildApplicationResumeEvidenceCorpus(facts ?? [], masterResume),
      resume: normalizeGeneratedApplicationResume(generated.resume, masterResume),
    });
    const coverLetterReview = reviewCoverLetterClaimProvenance({
      coverLetter: generated.coverLetter,
      evidenceCorpus: buildApplicationCoverLetterEvidenceCorpus({
        application: context,
        facts: facts ?? [],
        masterResume,
      }),
    });
    const nextVersion = existingMaterials
      ? Math.max(existingMaterials.resume.version_number, existingMaterials.coverLetter.version_number) + 1
      : 1;
    const generationBasis = {
      applicationId: context.id,
      fitAnalysis,
      fitDecision: context.fit_decision,
      generationReason: parsed.reason ?? (parsed.mode === "regenerate" ? "regenerate" : "initial"),
      generatedAt: new Date().toISOString(),
      jobIngestionId: context.job_ingestions?.id ?? null,
      masterResumeIncluded: Boolean(masterResume),
      model,
      promptVersion: APPLICATION_MATERIALS_PROMPT_VERSION,
    };

    const { coverLetter, resume } = await createGeneratedMaterialPair({
      applicationId: context.id,
      coverLetter: generated.coverLetter,
      coverLetterReview,
      existingMaterials,
      generationBasis,
      generationReason: parsed.reason ?? (parsed.mode === "regenerate" ? "regenerate" : "initial"),
      generatedResume,
      model,
      nextVersion,
      profileId: context.profile_id,
      supabase,
      userId: user.id,
    });

    await finalizeQuotaReservation({
      metadata: {
        cover_letter_id: coverLetter.id,
        cover_letter_claim_risk_count: coverLetterReview.claimRisks.length,
        fit_recommendation: fitAnalysis.recommendation,
        fit_score: fitAnalysis.score,
        model,
        prompt_version: APPLICATION_MATERIALS_PROMPT_VERSION,
        resume_id: resume.id,
      },
      reservationId: quotaReservation.reservationId,
      resourceId: context.id,
    });

    return {
      coverLetterId: coverLetter.id,
      didGenerate: true,
      model,
      promptVersion: APPLICATION_MATERIALS_PROMPT_VERSION,
      resumeId: resume.id,
      summary: `Created a role-specific resume packet for ${context.job_title ?? "the role"} at ${context.company_name}.`,
    };
  } catch (error) {
    await releaseApplicationMaterialsQuotaReservation(quotaReservation, error);
    throw error;
  }
}

async function releaseApplicationMaterialsQuotaReservation(
  quotaReservation: QuotaReservationResult,
  error: unknown,
) {
  if (quotaReservation.status !== "reserved") {
    return;
  }

  await releaseQuotaReservation({
    reason: error instanceof Error ? error.message : "APPLICATION_MATERIAL_GENERATION_FAILED",
    reservationId: quotaReservation.reservationId,
  }).catch(() => undefined);
}

async function readLatestMaterialPair({
  applicationId,
  userId,
}: {
  applicationId: string;
  userId: string;
}) {
  const supabase = await createClient();
  const [{ data: resume, error: resumeError }, { data: coverLetter, error: coverLetterError }] =
    await Promise.all([
      supabase
        .from("generated_resumes")
        .select("id, model, prompt_version, version_number")
        .eq("application_id", applicationId)
        .eq("user_id", userId)
        .eq("is_current", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("generated_cover_letters")
        .select("id, model, prompt_version, version_number")
        .eq("application_id", applicationId)
        .eq("user_id", userId)
        .eq("is_current", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (resumeError) {
    throw new Error("RESUME_READ_FAILED");
  }

  if (coverLetterError) {
    throw new Error("COVER_LETTER_READ_FAILED");
  }

  if (!resume || !coverLetter) {
    return null;
  }

  return {
    coverLetter,
    resume,
  };
}

async function createGeneratedMaterialPair({
  applicationId,
  coverLetter,
  coverLetterReview,
  existingMaterials,
  generationBasis,
  generationReason,
  generatedResume,
  model,
  nextVersion,
  profileId,
  supabase,
  userId,
}: {
  applicationId: string;
  coverLetter: string;
  coverLetterReview: ReturnType<typeof reviewCoverLetterClaimProvenance>;
  existingMaterials: Awaited<ReturnType<typeof readLatestMaterialPair>>;
  generationBasis: Record<string, unknown>;
  generationReason: string;
  generatedResume: ResumeContent;
  model: string;
  nextVersion: number;
  profileId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}) {
  const { data: resume, error: resumeError } = await supabase
    .from("generated_resumes")
    .insert({
      user_id: userId,
      profile_id: profileId,
      application_id: applicationId,
      resume_type: "application",
      prompt_version: APPLICATION_MATERIALS_PROMPT_VERSION,
      model,
      content_json: generatedResume,
      generation_basis: generationBasis,
      generation_reason: generationReason,
      is_current: true,
      parent_artifact_id: existingMaterials?.resume.id ?? null,
      status: "ready",
      version_number: nextVersion,
    })
    .select("id")
    .single();

  if (resumeError || !resume) {
    throw new Error("RESUME_SAVE_FAILED");
  }

  const { data: savedCoverLetter, error: coverLetterError } = await supabase
    .from("generated_cover_letters")
    .insert({
      user_id: userId,
      application_id: applicationId,
      claim_risks: coverLetterReview.claimRisks,
      prompt_version: APPLICATION_MATERIALS_PROMPT_VERSION,
      model,
      content: coverLetter,
      generation_basis: generationBasis,
      generation_reason: generationReason,
      is_current: true,
      parent_artifact_id: existingMaterials?.coverLetter.id ?? null,
      reviewer_notes: coverLetterReview.reviewerNotes,
      status: "ready",
      version_number: nextVersion,
    })
    .select("id")
    .single();

  if (coverLetterError || !savedCoverLetter) {
    await supabase
      .from("generated_resumes")
      .delete()
      .eq("id", resume.id)
      .eq("user_id", userId);
    throw new Error("COVER_LETTER_SAVE_FAILED");
  }

  if (existingMaterials) {
    await Promise.all([
      supabase
        .from("generated_resumes")
        .update({ is_current: false })
        .eq("id", existingMaterials.resume.id)
        .eq("user_id", userId),
      supabase
        .from("generated_cover_letters")
        .update({ is_current: false })
        .eq("id", existingMaterials.coverLetter.id)
        .eq("user_id", userId),
    ]);
  }

  return {
    coverLetter: savedCoverLetter,
    resume,
  };
}

function buildReusableMaterialsResult({
  application,
  coverLetter,
  resume,
}: {
  application: Pick<ApplicationContext, "company_name" | "job_title">;
  coverLetter: {
    id: string;
    model: string | null;
    prompt_version: string | null;
    version_number: number;
  };
  resume: {
    id: string;
    model: string | null;
    prompt_version: string | null;
    version_number: number;
  };
}): GenerateApplicationMaterialsResult {
  return {
    coverLetterId: coverLetter.id,
    didGenerate: false,
    model: resume.model ?? coverLetter.model ?? getMaterialsModel(),
    promptVersion:
      resume.prompt_version ?? coverLetter.prompt_version ?? APPLICATION_MATERIALS_PROMPT_VERSION,
    resumeId: resume.id,
    summary: `Kept the existing role-specific resume packet for ${application.job_title ?? "the role"} at ${application.company_name}.`,
  };
}

function assertApplicationMaterialDecisionAllowsGeneration(application: ApplicationContext) {
  if (application.fit_decision === "skip") {
    throw new Error("APPLICATION_DECISION_SKIP");
  }

  if (application.fit_decision === "needs_more_profile" || application.fit_decision === "needs_profile") {
    throw new Error("APPLICATION_DECISION_NEEDS_PROFILE");
  }
}

function buildMaterialsInput({
  application,
  facts,
  fitAnalysis,
  intelligence,
  masterResume,
  profile,
}: {
  application: ApplicationContext;
  facts: {
    confidence: number | null;
    evidence_status: "user_confirmed" | "source_supported" | "inferred" | "conflict" | "missing_evidence" | null;
    fact_type: string;
    fact_value: string;
    user_confirmed: boolean;
  }[];
  fitAnalysis: JobFitAnalysis;
  intelligence: ProfileIntelligence;
  masterResume: ResumeContent | null;
  profile: {
    display_name: string | null;
    headline: string | null;
    summary: string | null;
    target_direction: string | null;
    target_level: string | null;
  };
}) {
  return `
Application:
- Company: ${application.company_name}
- Role: ${application.job_title ?? application.job_ingestions?.title ?? "Unknown role"}
- URL: ${application.job_url}

Profile draft:
- Name: ${profile.display_name ?? "Not provided"}
- Headline: ${profile.headline ?? "Not provided"}
- Summary: ${profile.summary ?? "Not provided"}
- Target direction: ${profile.target_direction ?? "Not provided"}
- Target level: ${profile.target_level ?? "Not provided"}

Profile facts:
${facts.map((fact) => `- [${fact.fact_type}, ${formatFactEvidenceStatus(fact)}] ${fact.fact_value}`).join("\n")}

Use confirmed and source-supported facts as claims. Treat inferred,
conflicting, or missing-evidence facts as review notes or confirmation
questions; do not present them as hard truth in the resume or cover letter.

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
- High-value gaps: ${intelligence.highValueGaps.map((gap) => `${gap.label}: ${gap.prompt}`).join(" | ") || "None"}

Master resume context:
${formatMasterResume(masterResume)}

Job fit analysis:
- Score: ${fitAnalysis.score ?? "Unknown"}
- Recommendation: ${fitAnalysis.recommendation}
- Summary: ${fitAnalysis.summary}
- Matched keywords: ${fitAnalysis.matchedKeywords.join(", ") || "None"}
- Missing keywords/gaps: ${fitAnalysis.missingKeywords.join(", ") || "None"}
- Risks: ${fitAnalysis.risks.join(" | ") || "None"}
- Questions to resolve: ${fitAnalysis.questions.join(" | ") || "None"}

Job post text:
${application.job_ingestions?.extracted_text?.slice(0, 14000)}

Return:
- resume.headline: targeted, ATS-aware headline.
- resume.summary: concise professional summary.
- resume.skills: high-value ATS skills that are supported by profile evidence.
- resume.experienceBullets: rewritten bullets that align evidence to the role.
- resume.keywordGaps: important job keywords or evidence gaps missing from the
  captured profile/master resume evidence. Do not hide gaps.
- resume.reviewerNotes: candid recruiter-style notes about fit, unsupported
  claims to avoid, risk, and what the user should verify before export.
- coverLetter: concise, credible cover letter in the user's implied professional voice.
- resume.contact: carry verified contact fields from the master resume/profile.
- resume.experienceSections: preserve chronological role history by company,
  title, date, and location from the master resume, but tailor only the bullets
  that are relevant to this role. Do not flatten chronology into highlights.
- resume.specialProjects, resume.languages, resume.education, and
  resume.certifications: preserve supported master resume values when present
  and useful. Use empty arrays only when no evidence exists.
- ATS order is summary, skills, selected highlights, role-based work history,
  special projects, languages, education, certifications.
- resume.experienceBullets: selected highlights for this application. This is
  a highlight reel, not a replacement for role-by-role work history.
`.trim();
}

function formatFactEvidenceStatus(fact: {
  evidence_status:
    | "user_confirmed"
    | "source_supported"
    | "inferred"
    | "conflict"
    | "missing_evidence"
    | null;
  user_confirmed: boolean;
}) {
  if (fact.user_confirmed || fact.evidence_status === "user_confirmed") {
    return "confirmed";
  }

  if (fact.evidence_status === "source_supported") {
    return "source-supported";
  }

  if (fact.evidence_status === "conflict") {
    return "conflict-needs-review";
  }

  if (fact.evidence_status === "missing_evidence") {
    return "missing-evidence";
  }

  return "inferred-needs-confirmation";
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

async function readLatestMasterResume({
  profileId,
  userId,
}: {
  profileId: string;
  userId: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("generated_resumes")
    .select("content_json")
    .eq("profile_id", profileId)
    .eq("user_id", userId)
    .eq("resume_type", "master")
    .is("application_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("MASTER_RESUME_READ_FAILED");
  }

  if (!data?.content_json) {
    return null;
  }

  try {
    return parseResumeContent(data.content_json);
  } catch {
    return null;
  }
}

function formatMasterResume(masterResume: ResumeContent | null) {
  if (!masterResume) {
    return "No master resume draft exists yet.";
  }

  return [
    `- Contact: ${[masterResume.contact.email, masterResume.contact.phone, masterResume.contact.linkedin, masterResume.contact.website, masterResume.contact.location].filter(Boolean).join(" | ") || "None captured"}`,
    `- Headline: ${masterResume.headline}`,
    `- Summary: ${masterResume.summary}`,
    `- Skills: ${masterResume.skills.join(", ")}`,
    "- Selected highlights:",
    ...masterResume.experienceBullets.map((bullet) => `  - ${bullet}`),
    "- Role-based work history:",
    ...masterResume.experienceSections.flatMap((section) => {
      const heading = [section.roleTitle, section.company, section.dates, section.location]
        .filter(Boolean)
        .join(" | ");
      return [heading ? `  - ${heading}` : "  - Role", ...section.bullets.map((bullet) => `    - ${bullet}`)];
    }),
    "- Special projects:",
    ...(masterResume.specialProjects.length > 0
      ? masterResume.specialProjects.map((item) => {
          const heading = [item.name, item.context, item.dates].filter(Boolean).join(" | ");
          return `  - ${heading || "Project"}${item.bullets.length > 0 ? `: ${item.bullets.join(" / ")}` : ""}`;
        })
      : ["  - None"]),
    "- Languages:",
    ...(masterResume.languages.length > 0
      ? masterResume.languages.map((item) =>
          `  - ${[item.name, item.proficiency].filter(Boolean).join(" | ")}`,
        )
      : ["  - None"]),
    "- Education:",
    ...(masterResume.education.length > 0
      ? masterResume.education.map((item) =>
          `  - ${[item.credential, item.institution, item.location, item.dates].filter(Boolean).join(" | ")}`,
        )
      : ["  - None"]),
    "- Certifications:",
    ...(masterResume.certifications.length > 0
      ? masterResume.certifications.map((item) =>
          `  - ${[item.name, item.issuer, item.date].filter(Boolean).join(" | ")}`,
        )
      : ["  - None"]),
    "- Existing gaps/notes:",
    ...[...masterResume.keywordGaps, ...masterResume.reviewerNotes].map((note) => `  - ${note}`),
  ].join("\n");
}

function normalizeGeneratedApplicationResume(resume: ResumeContent, masterResume: ResumeContent | null) {
  return normalizeResumeContent({
    ...resume,
    contact: {
      ...masterResume?.contact,
      ...resume.contact,
    },
    experienceSections:
      resume.experienceSections.length > 0
        ? resume.experienceSections
        : (masterResume?.experienceSections ?? []),
    specialProjects:
      normalizeResumeContent(resume).specialProjects.length > 0
        ? resume.specialProjects
        : (masterResume?.specialProjects ?? []),
    languages: resume.languages.length > 0 ? resume.languages : (masterResume?.languages ?? []),
    education: resume.education.length > 0 ? resume.education : (masterResume?.education ?? []),
    certifications:
      resume.certifications.length > 0 ? resume.certifications : (masterResume?.certifications ?? []),
  });
}

function buildApplicationResumeEvidenceCorpus(
  facts: Array<{
    evidence_status: string | null;
    fact_type: string;
    fact_value: string;
    user_confirmed: boolean | null;
  }>,
  masterResume: ResumeContent | null,
) {
  return buildSupportedEvidenceCorpus([
    ...facts.map((fact) => ({
      label: fact.fact_type,
      status: fact.evidence_status,
      text: fact.fact_value,
      userConfirmed: fact.user_confirmed,
    })),
    {
      label: "master resume",
      status: "source_excerpt",
      text: masterResume ? flattenResumeEvidence(masterResume) : null,
      userConfirmed: true,
    },
  ]);
}

function buildApplicationCoverLetterEvidenceCorpus({
  application,
  facts,
  masterResume,
}: {
  application: ApplicationContext;
  facts: Array<{
    evidence_status: string | null;
    fact_type: string;
    fact_value: string;
    user_confirmed: boolean | null;
  }>;
  masterResume: ResumeContent | null;
}) {
  return buildSupportedEvidenceCorpus([
    ...facts.map((fact) => ({
      label: fact.fact_type,
      status: fact.evidence_status,
      text: fact.fact_value,
      userConfirmed: fact.user_confirmed,
    })),
    {
      label: "master resume",
      status: "source_excerpt",
      text: masterResume ? flattenResumeEvidence(masterResume) : null,
      userConfirmed: true,
    },
    {
      label: "target job",
      status: "source_excerpt",
      text: [
        application.company_name,
        application.job_title,
        application.job_ingestions?.title,
        application.job_ingestions?.company,
        application.job_ingestions?.extracted_text,
      ]
        .filter(Boolean)
        .join(" "),
      userConfirmed: true,
    },
  ]);
}

function flattenResumeEvidence(resume: ResumeContent) {
  return [
    resume.headline,
    resume.summary,
    ...resume.skills,
    ...resume.experienceBullets,
    ...resume.experienceSections.flatMap((section) => [
      section.roleTitle,
      section.company,
      section.location,
      section.dates,
      ...section.bullets,
    ]),
    ...resume.specialProjects.flatMap((project) => [
      project.name,
      project.context,
      project.dates,
      ...project.bullets,
    ]),
    ...resume.languages.flatMap((language) => [language.name, language.proficiency]),
    ...resume.education.flatMap((education) => [
      education.institution,
      education.credential,
      education.location,
      education.dates,
    ]),
    ...resume.certifications.flatMap((certification) => [
      certification.name,
      certification.issuer,
      certification.date,
    ]),
  ]
    .filter(Boolean)
    .join(" ");
}

function normalizeApplicationContext(application: RawApplicationContext): ApplicationContext {
  const jobIngestion = Array.isArray(application.job_ingestions)
    ? application.job_ingestions[0] ?? null
    : application.job_ingestions;

  return {
    ...application,
    job_ingestions: jobIngestion,
  };
}

function hashUserId(userId: string) {
  return createHash("sha256").update(userId).digest("hex");
}

function hashOperationInput(value: string) {
  return createHash("sha256").update(value.trim() || "default").digest("hex").slice(0, 24);
}
