import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import {
  APPLICATION_MATERIALS_INSTRUCTIONS,
  APPLICATION_MATERIALS_PROMPT_VERSION,
} from "@/lib/ai/prompts/application-materials";
import { getMaterialsModel, getOpenAIClient } from "@/lib/ai/openai";
import { analyzeJobFit, readUserFitContext, type JobFitAnalysis } from "@/lib/jobs/job-fit";
import { recordQuotaEvent } from "@/lib/quota/quota-events";
import {
  parseResumeContent,
  resumeContentSchema,
  type ResumeContent,
} from "@/lib/resumes/resume-content";
import { createClient } from "@/lib/supabase/server";

export const generateApplicationMaterialsSchema = z.object({
  applicationId: z.string().uuid(),
});

const generatedMaterialsSchema = z.object({
  resume: resumeContentSchema,
  coverLetter: z.string().min(1).max(4000),
});

export type GenerateApplicationMaterialsResult = {
  coverLetterId: string;
  model: string;
  promptVersion: string;
  resumeId: string;
  summary: string;
};

type ApplicationContext = {
  id: string;
  company_name: string;
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

export async function generateApplicationMaterials(
  input: z.input<typeof generateApplicationMaterialsSchema>,
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
      "id, company_name, job_title, job_url, profile_id, job_ingestions(id, extracted_text, title, company)",
    )
    .eq("id", parsed.applicationId)
    .eq("user_id", user.id)
    .single();

  if (applicationError || !application) {
    throw new Error("APPLICATION_NOT_FOUND");
  }

  const context = normalizeApplicationContext(application);

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
    .select("fact_type, fact_value, confidence, user_confirmed")
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
  const model = getMaterialsModel();
  const response = await getOpenAIClient().responses.create({
    model,
    instructions: APPLICATION_MATERIALS_INSTRUCTIONS,
    input: buildMaterialsInput({
      application: context,
      facts: facts ?? [],
      fitAnalysis,
      masterResume,
      profile,
    }),
    max_output_tokens: 1800,
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
                  maxItems: 18,
                  items: { type: "string" },
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
  const [{ data: resume, error: resumeError }, { data: coverLetter, error: coverLetterError }] =
    await Promise.all([
      supabase
        .from("generated_resumes")
        .insert({
          user_id: user.id,
          profile_id: context.profile_id,
          application_id: context.id,
          resume_type: "application",
          prompt_version: APPLICATION_MATERIALS_PROMPT_VERSION,
          model,
          content_json: generated.resume,
          status: "ready",
        })
        .select("id")
        .single(),
      supabase
        .from("generated_cover_letters")
        .insert({
          user_id: user.id,
          application_id: context.id,
          prompt_version: APPLICATION_MATERIALS_PROMPT_VERSION,
          model,
          content: generated.coverLetter,
          status: "ready",
        })
        .select("id")
        .single(),
    ]);

  if (resumeError || !resume) {
    throw new Error("RESUME_SAVE_FAILED");
  }

  if (coverLetterError || !coverLetter) {
    throw new Error("COVER_LETTER_SAVE_FAILED");
  }

  await recordQuotaEvent({
    eventType: "generation_created",
    metadata: {
      cover_letter_id: coverLetter.id,
      model,
      prompt_version: APPLICATION_MATERIALS_PROMPT_VERSION,
      resume_id: resume.id,
      fit_recommendation: fitAnalysis.recommendation,
      fit_score: fitAnalysis.score,
    },
    resourceId: context.id,
    resourceType: "application_materials",
  });

  return {
    coverLetterId: coverLetter.id,
    model,
    promptVersion: APPLICATION_MATERIALS_PROMPT_VERSION,
    resumeId: resume.id,
    summary: `Generated targeted resume bullets and a cover letter for ${context.job_title ?? "the role"} at ${context.company_name}.`,
  };
}

function buildMaterialsInput({
  application,
  facts,
  fitAnalysis,
  masterResume,
  profile,
}: {
  application: ApplicationContext;
  facts: {
    confidence: number | null;
    fact_type: string;
    fact_value: string;
    user_confirmed: boolean;
  }[];
  fitAnalysis: JobFitAnalysis;
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
${facts.map((fact) => `- [${fact.fact_type}${fact.user_confirmed ? ", confirmed" : ""}] ${fact.fact_value}`).join("\n")}

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
- resume.skills: high-signal ATS skills that are supported by profile evidence.
- resume.experienceBullets: rewritten bullets that align evidence to the role.
- resume.keywordGaps: important job keywords or proof points missing from the
  captured profile/master resume evidence. Do not hide gaps.
- resume.reviewerNotes: candid recruiter-style notes about fit, unsupported
  claims to avoid, risk, and what the user should verify before export.
- coverLetter: concise, credible cover letter in the user's implied professional voice.
`.trim();
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
    `- Headline: ${masterResume.headline}`,
    `- Summary: ${masterResume.summary}`,
    `- Skills: ${masterResume.skills.join(", ")}`,
    "- Experience bullets:",
    ...masterResume.experienceBullets.map((bullet) => `  - ${bullet}`),
    "- Existing gaps/notes:",
    ...[...masterResume.keywordGaps, ...masterResume.reviewerNotes].map((note) => `  - ${note}`),
  ].join("\n");
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
