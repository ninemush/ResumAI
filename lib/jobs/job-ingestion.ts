import "server-only";

import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { z } from "zod";

import { createOpenAIResponse, getProfileIntakeModel } from "@/lib/ai/openai";
import { buildEvidenceBasedFitAnalysis } from "@/lib/jobs/evidence-based-fit";
import { analyzeJobFit, readUserFitContext, type JobFitAnalysis } from "@/lib/jobs/job-fit";
import { cleanJobCompany, cleanJobTitle, readJobMetadataFromTitle } from "@/lib/jobs/job-metadata";
import { isUnavailableJobPostingRedirect } from "@/lib/jobs/job-url-diagnostics";
import { safeFetchExternalHtml } from "@/lib/security/safe-fetch";
import { assertExternalHttpUrl, isHttpUrl } from "@/lib/security/url-safety";
import { createClient } from "@/lib/supabase/server";

const MAX_JOB_HTML_BYTES = 1_500_000;
const MAX_JOB_TEXT_CHARS = 20_000;
const FETCH_TIMEOUT_MS = 8000;
const JOB_METADATA_PROMPT_VERSION = "job_metadata_v1";

const aiJobMetadataSchema = z.object({
  acceptingApplications: z.boolean().nullable(),
  company: z.string().trim().max(140).nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  employmentType: z.string().trim().max(80).nullable(),
  location: z.string().trim().max(160).nullable(),
  title: z.string().trim().max(180).nullable(),
  workplaceType: z.string().trim().max(80).nullable(),
});

export const jobIngestionRequestSchema = z.object({
  jobUrl: z
    .string()
    .trim()
    .url()
    .refine((value) => isHttpUrl(value), {
      message: "Only http and https job links are supported.",
    })
    .optional(),
  jobText: z.string().trim().min(80).max(MAX_JOB_TEXT_CHARS).optional(),
  sourceType: z.enum(["url_fetch", "manual_paste", "screenshot", "file"]).default("url_fetch"),
}).superRefine((value, context) => {
  if (value.sourceType === "url_fetch" && !value.jobUrl) {
    context.addIssue({
      code: "custom",
      message: "Job URL is required for URL fetch ingestion.",
      path: ["jobUrl"],
    });
  }

  if (value.sourceType !== "url_fetch" && !value.jobText) {
    context.addIssue({
      code: "custom",
      message: "Job description text is required for manual job ingestion.",
      path: ["jobText"],
    });
  }
});

export type JobIngestionResult = {
  didIngest: boolean;
  job: {
    id: string;
    jobUrl: string;
    resolvedUrl: string | null;
    title: string | null;
    company: string | null;
    extractedTextLength: number;
    fitAnalysis: JobFitAnalysis | null;
    ingestionStatus: "pending" | "processing" | "succeeded" | "failed" | "deleted";
  };
};

export async function getReusableJobIngestion({
  jobUrl,
  sourceType,
}: z.infer<typeof jobIngestionRequestSchema>): Promise<JobIngestionResult | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  if (sourceType !== "url_fetch" || !jobUrl) {
    return null;
  }

  assertSafeJobUrl(jobUrl);

  return readReusableJobIngestion({
    jobUrl,
    userId: user.id,
  });
}

export async function getJobIngestionById({
  jobId,
  userId,
}: {
  jobId: string;
  userId: string;
}): Promise<JobIngestionResult | null> {
  const supabase = await createClient();
  const { data: job, error } = await supabase
    .from("job_ingestions")
    .select("id, job_url, resolved_url, title, company, extracted_text, ingestion_status")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("JOB_READ_FAILED");
  }

  return job?.extracted_text
    ? buildJobIngestionResult({
        didIngest: false,
        job,
        userId,
      })
    : null;
}

export async function ingestJobUrl({
  jobText,
  jobUrl,
  sourceType,
}: z.infer<typeof jobIngestionRequestSchema>): Promise<JobIngestionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  if (sourceType === "url_fetch" && jobUrl) {
    assertSafeJobUrl(jobUrl);
  }

  const reusableJob =
    sourceType === "url_fetch" && jobUrl
      ? await readReusableJobIngestion({
          jobUrl,
          userId: user.id,
        })
      : null;

  if (reusableJob) {
    return reusableJob;
  }

  if (sourceType !== "url_fetch") {
    return ingestManualJobText({
      jobText: jobText ?? "",
      sourceType,
      userId: user.id,
    });
  }

  if (!jobUrl) {
    throw new Error("JOB_URL_REQUIRED");
  }

  const { data: startedJob, error: insertError } = await supabase
    .from("job_ingestions")
    .insert({
      user_id: user.id,
      job_url: jobUrl,
      source_type: "url_fetch",
      ingestion_status: "processing",
    })
    .select("id")
    .single();

  if (insertError || !startedJob) {
    throw new Error("JOB_INSERT_FAILED");
  }

  try {
    const fetched = await fetchJobPage(jobUrl);
    assertSafeJobUrl(fetched.resolvedUrl);

    const parsed = extractJobPageText(fetched.html);

    if (parsed.text.length < 80) {
      throw new Error("JOB_TEXT_TOO_SHORT");
    }

    const metadata = await readBestJobMetadata({
      parsed,
      resolvedUrl: fetched.resolvedUrl,
      userId: user.id,
    });
    const extractedText = prependJobMetadata(parsed.text, metadata);

    const { data: completedJob, error: updateError } = await supabase
      .from("job_ingestions")
      .update({
        resolved_url: fetched.resolvedUrl,
        title: metadata.title,
        company: metadata.company,
        extracted_text: extractedText,
        ingestion_status: "succeeded",
        failure_reason: null,
      })
      .eq("id", startedJob.id)
      .eq("user_id", user.id)
      .select("id, job_url, resolved_url, title, company, extracted_text, ingestion_status")
      .single();

    if (updateError || !completedJob) {
      throw new Error("JOB_UPDATE_FAILED");
    }

    const fitContext = await readUserFitContext(user.id);
    const fitAnalysis = analyzeJobFit({
      jobText: completedJob.extracted_text,
      masterResume: fitContext.masterResume,
      profileFacts: fitContext.profileFacts,
    });
    const evidenceBased = buildEvidenceBasedFitAnalysis(fitAnalysis);
    const enrichedFitAnalysis = enrichFitAnalysis(fitAnalysis);

    await supabase
      .from("job_ingestions")
      .update({
        current_fit_analysis: evidenceBased,
        fit_decision: evidenceBased.recommendation,
        fit_decision_reason: evidenceBased.nextBestAction,
        fit_snapshot_at_ingestion: enrichedFitAnalysis,
      })
      .eq("id", completedJob.id)
      .eq("user_id", user.id);

    return {
      didIngest: true,
      job: {
        id: completedJob.id,
        jobUrl: completedJob.job_url,
        resolvedUrl: completedJob.resolved_url,
        title: completedJob.title,
        company: completedJob.company,
        extractedTextLength: completedJob.extracted_text?.length ?? 0,
        fitAnalysis: enrichedFitAnalysis,
        ingestionStatus: completedJob.ingestion_status,
      },
    };
  } catch (error) {
    await supabase
      .from("job_ingestions")
      .update({
        ingestion_status: "failed",
        failure_reason: error instanceof Error ? error.message : "JOB_INGESTION_FAILED",
      })
      .eq("id", startedJob.id)
      .eq("user_id", user.id);

    throw error;
  }
}

async function readReusableJobIngestion({
  jobUrl,
  userId,
}: {
  jobUrl: string;
  userId: string;
}): Promise<JobIngestionResult | null> {
  const supabase = await createClient();
  const { data: existingJob, error } = await supabase
    .from("job_ingestions")
    .select("id, job_url, resolved_url, title, company, extracted_text, ingestion_status")
    .eq("user_id", userId)
    .eq("job_url", jobUrl)
    .eq("ingestion_status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("JOB_READ_FAILED");
  }

  if (!existingJob?.extracted_text) {
    return null;
  }

  return buildJobIngestionResult({
    didIngest: false,
    job: existingJob,
    userId,
  });
}

async function buildJobIngestionResult({
  didIngest,
  job,
  userId,
}: {
  didIngest: boolean;
  job: {
    company: string | null;
    extracted_text: string;
    id: string;
    ingestion_status: "pending" | "processing" | "succeeded" | "failed" | "deleted";
    job_url: string;
    resolved_url: string | null;
    title: string | null;
  };
  userId: string;
}): Promise<JobIngestionResult> {
  const fitContext = await readUserFitContext(userId);
  const fitAnalysis = analyzeJobFit({
    jobText: job.extracted_text,
    masterResume: fitContext.masterResume,
    profileFacts: fitContext.profileFacts,
  });

  return {
    didIngest,
    job: {
      id: job.id,
      jobUrl: job.job_url,
      resolvedUrl: job.resolved_url,
      title: job.title,
      company: job.company,
      extractedTextLength: job.extracted_text.length,
      fitAnalysis: enrichFitAnalysis(fitAnalysis),
      ingestionStatus: job.ingestion_status,
    },
  };
}

async function ingestManualJobText({
  jobText,
  sourceType,
  userId,
}: {
  jobText: string;
  sourceType: "manual_paste" | "screenshot" | "file";
  userId: string;
}): Promise<JobIngestionResult> {
  const supabase = await createClient();
  const normalizedText = normalizeManualJobText(jobText);

  if (normalizedText.length < 80) {
    throw new Error("JOB_TEXT_TOO_SHORT");
  }

  const metadata = await readBestJobMetadata({
    parsed: {
      company: null,
      rawCompany: null,
      rawTitle: null,
      text: normalizedText,
      title: null,
    },
    resolvedUrl: "manual-paste",
    userId,
  });
  const extractedText = prependJobMetadata(normalizedText, metadata);
  const fitContext = await readUserFitContext(userId);
  const fitAnalysis = analyzeJobFit({
    jobText: extractedText,
    masterResume: fitContext.masterResume,
    profileFacts: fitContext.profileFacts,
  });
  const evidenceBased = buildEvidenceBasedFitAnalysis(fitAnalysis);
  const enrichedFitAnalysis = enrichFitAnalysis(fitAnalysis);
  const { data: completedJob, error: insertError } = await supabase
    .from("job_ingestions")
    .insert({
      company: metadata.company,
      current_fit_analysis: evidenceBased,
      extracted_text: extractedText,
      fit_decision: evidenceBased.recommendation,
      fit_decision_reason: evidenceBased.nextBestAction,
      fit_snapshot_at_ingestion: enrichedFitAnalysis,
      ingestion_status: "succeeded",
      job_url: null,
      source_type: sourceType,
      title: metadata.title,
      user_id: userId,
    })
    .select("id, job_url, resolved_url, title, company, extracted_text, ingestion_status")
    .single();

  if (insertError || !completedJob) {
    throw new Error("JOB_INSERT_FAILED");
  }

  return {
    didIngest: true,
    job: {
      id: completedJob.id,
      jobUrl: completedJob.job_url ?? "",
      resolvedUrl: completedJob.resolved_url,
      title: completedJob.title,
      company: completedJob.company,
      extractedTextLength: completedJob.extracted_text?.length ?? 0,
      fitAnalysis: enrichedFitAnalysis,
      ingestionStatus: completedJob.ingestion_status,
    },
  };
}

function enrichFitAnalysis(fitAnalysis: JobFitAnalysis): JobFitAnalysis {
  const evidenceBased = buildEvidenceBasedFitAnalysis(fitAnalysis);

  return {
    ...fitAnalysis,
    evidenceBased,
    fitBand: mapFitBand(evidenceBased.recommendation),
  };
}

function mapFitBand(recommendation: ReturnType<typeof buildEvidenceBasedFitAnalysis>["recommendation"]) {
  if (recommendation === "apply") return "Strong fit";
  if (recommendation === "network_first") return "Plausible fit";
  if (recommendation === "stretch") return "Stretch";
  if (recommendation === "skip") return "Poor fit";
  return "Needs more profile evidence";
}

function normalizeManualJobText(text: string) {
  return text.replace(/\r/g, "\n").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_JOB_TEXT_CHARS);
}

async function fetchJobPage(jobUrl: string) {
  const { finalUrl, response } = await safeFetchExternalHtml(jobUrl, {
    blockedErrorCode: "JOB_URL_BLOCKED",
    dnsLookupErrorCode: "JOB_FETCH_FAILED",
    fetchErrorCode: "JOB_FETCH_FAILED",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "PramaniaJobIngestion/0.1",
    },
    maxRedirects: 3,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (isUnavailableJobPostingRedirect({ requestedUrl: jobUrl, resolvedUrl: finalUrl })) {
    throw new Error("JOB_POSTING_UNAVAILABLE");
  }

  if (!response.ok) {
    throw new Error("JOB_FETCH_FAILED");
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    throw new Error("JOB_UNSUPPORTED_CONTENT_TYPE");
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);

  if (contentLength > MAX_JOB_HTML_BYTES) {
    throw new Error("JOB_PAGE_TOO_LARGE");
  }

  const html = await response.text();

  if (html.length > MAX_JOB_HTML_BYTES) {
    throw new Error("JOB_PAGE_TOO_LARGE");
  }

  return {
    html,
    resolvedUrl: finalUrl,
  };
}

function extractJobPageText(html: string) {
  const $ = cheerio.load(html);

  $("script, style, noscript, svg, iframe, nav, footer").remove();

  const rawTitle =
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("h1").first().text().trim() ||
    $("title").first().text().trim() ||
    null;
  const rawCompany =
    $("meta[property='og:site_name']").attr("content")?.trim() ||
    $("[data-company]").first().text().trim() ||
    null;
  const titleMetadata = readJobMetadataFromTitle(rawTitle);
  const text = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_JOB_TEXT_CHARS);

  return {
    company: cleanJobCompany(rawCompany) ?? titleMetadata.company,
    rawCompany,
    rawTitle,
    text,
    title: cleanJobTitle(rawTitle) ?? titleMetadata.title,
  };
}

async function readBestJobMetadata({
  parsed,
  resolvedUrl,
  userId,
}: {
  parsed: ReturnType<typeof extractJobPageText>;
  resolvedUrl: string;
  userId: string;
}) {
  const aiMetadata = await extractJobMetadataWithAi({
    parsed,
    resolvedUrl,
    userId,
  });

  return {
    acceptingApplications: aiMetadata?.acceptingApplications ?? null,
    company: cleanJobCompany(aiMetadata?.company) ?? parsed.company,
    employmentType: cleanJobCompany(aiMetadata?.employmentType) ?? null,
    location: cleanJobCompany(aiMetadata?.location) ?? null,
    title: cleanJobTitle(aiMetadata?.title) ?? parsed.title,
    workplaceType: cleanJobCompany(aiMetadata?.workplaceType) ?? null,
  };
}

async function extractJobMetadataWithAi({
  parsed,
  resolvedUrl,
  userId,
}: {
  parsed: ReturnType<typeof extractJobPageText>;
  resolvedUrl: string;
  userId: string;
}) {
  try {
    const response = await createOpenAIResponse({
      model: getProfileIntakeModel(),
      instructions: [
        "Extract structured job-post metadata from public job-page text.",
        "Use the visible job role, not SEO titles such as 'Company hiring Role'.",
        "If the page says the posting is closed or no longer accepting applications, set acceptingApplications to false.",
        "Return null for fields that are not supported by the text. Do not infer unavailable facts.",
      ].join("\n"),
      input: [
        `URL: ${resolvedUrl}`,
        `Raw title: ${parsed.rawTitle ?? "unknown"}`,
        `Raw company: ${parsed.rawCompany ?? "unknown"}`,
        `Visible text:\n${parsed.text.slice(0, 12_000)}`,
      ].join("\n\n"),
      max_output_tokens: 500,
      metadata: {
        feature: "job_ingestion_metadata",
        prompt_version: JOB_METADATA_PROMPT_VERSION,
      },
      safety_identifier: hashUserId(userId),
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "job_post_metadata",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: [
              "acceptingApplications",
              "company",
              "confidence",
              "employmentType",
              "location",
              "title",
              "workplaceType",
            ],
            properties: {
              acceptingApplications: { anyOf: [{ type: "boolean" }, { type: "null" }] },
              company: { anyOf: [{ type: "string" }, { type: "null" }] },
              confidence: { type: "string", enum: ["low", "medium", "high"] },
              employmentType: { anyOf: [{ type: "string" }, { type: "null" }] },
              location: { anyOf: [{ type: "string" }, { type: "null" }] },
              title: { anyOf: [{ type: "string" }, { type: "null" }] },
              workplaceType: { anyOf: [{ type: "string" }, { type: "null" }] },
            },
          },
        },
      },
    });

    return aiJobMetadataSchema.parse(JSON.parse(response.output_text));
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "job_metadata_ai_fallback",
        code: error instanceof Error ? error.message : "UNKNOWN_JOB_METADATA_AI_ERROR",
      }),
    );

    return null;
  }
}

function prependJobMetadata(text: string, metadata: {
  acceptingApplications: boolean | null;
  company: string | null;
  employmentType: string | null;
  location: string | null;
  title: string | null;
  workplaceType: string | null;
}) {
  const metadataLines = [
    metadata.title ? `Role title: ${metadata.title}` : null,
    metadata.company ? `Company: ${metadata.company}` : null,
    metadata.location ? `Location: ${metadata.location}` : null,
    metadata.workplaceType ? `Workplace type: ${metadata.workplaceType}` : null,
    metadata.employmentType ? `Employment type: ${metadata.employmentType}` : null,
    metadata.acceptingApplications === false ? "Posting status: No longer accepting applications" : null,
  ].filter(Boolean);

  if (metadataLines.length === 0) {
    return text;
  }

  return [`Structured job metadata:`, ...metadataLines, "", text].join("\n").slice(0, MAX_JOB_TEXT_CHARS);
}

function assertSafeJobUrl(value: string) {
  assertExternalHttpUrl(value, {
    blockedErrorCode: "JOB_URL_BLOCKED",
    unsupportedProtocolErrorCode: "JOB_URL_BLOCKED",
  });
}

function hashUserId(userId: string) {
  return createHash("sha256").update(userId).digest("hex").slice(0, 64);
}
