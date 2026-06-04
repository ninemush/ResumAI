import "server-only";

import * as cheerio from "cheerio";
import { z } from "zod";

import { analyzeJobFit, readUserFitContext, type JobFitAnalysis } from "@/lib/jobs/job-fit";
import { safeFetchExternalHtml } from "@/lib/security/safe-fetch";
import { assertExternalHttpUrl, isHttpUrl } from "@/lib/security/url-safety";
import { createClient } from "@/lib/supabase/server";

const MAX_JOB_HTML_BYTES = 1_500_000;
const MAX_JOB_TEXT_CHARS = 20_000;
const FETCH_TIMEOUT_MS = 8000;

export const jobIngestionRequestSchema = z.object({
  jobUrl: z
    .string()
    .trim()
    .url()
    .refine((value) => isHttpUrl(value), {
      message: "Only http and https job links are supported.",
    }),
});

export type JobIngestionResult = {
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

export async function ingestJobUrl({
  jobUrl,
}: z.infer<typeof jobIngestionRequestSchema>): Promise<JobIngestionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  assertSafeJobUrl(jobUrl);

  const { data: startedJob, error: insertError } = await supabase
    .from("job_ingestions")
    .insert({
      user_id: user.id,
      job_url: jobUrl,
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

    const { data: completedJob, error: updateError } = await supabase
      .from("job_ingestions")
      .update({
        resolved_url: fetched.resolvedUrl,
        title: parsed.title,
        company: parsed.company,
        extracted_text: parsed.text,
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

    return {
      job: {
        id: completedJob.id,
        jobUrl: completedJob.job_url,
        resolvedUrl: completedJob.resolved_url,
        title: completedJob.title,
        company: completedJob.company,
        extractedTextLength: completedJob.extracted_text?.length ?? 0,
        fitAnalysis,
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

  const title =
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("h1").first().text().trim() ||
    $("title").first().text().trim() ||
    null;
  const company =
    $("meta[property='og:site_name']").attr("content")?.trim() ||
    $("[data-company]").first().text().trim() ||
    null;
  const text = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_JOB_TEXT_CHARS);

  return {
    company: company || null,
    text,
    title: title ? title.slice(0, 240) : null,
  };
}

function assertSafeJobUrl(value: string) {
  assertExternalHttpUrl(value, {
    blockedErrorCode: "JOB_URL_BLOCKED",
    unsupportedProtocolErrorCode: "JOB_URL_BLOCKED",
  });
}
