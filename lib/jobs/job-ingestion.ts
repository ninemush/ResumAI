import "server-only";

import { isIP } from "node:net";
import * as cheerio from "cheerio";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const MAX_JOB_HTML_BYTES = 1_500_000;
const MAX_JOB_TEXT_CHARS = 20_000;
const FETCH_TIMEOUT_MS = 8000;

const blockedHostnames = new Set(["localhost", "localhost.localdomain"]);

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

  assertSafeUrl(jobUrl);

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
    assertSafeUrl(fetched.resolvedUrl);

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

    return {
      job: {
        id: completedJob.id,
        jobUrl: completedJob.job_url,
        resolvedUrl: completedJob.resolved_url,
        title: completedJob.title,
        company: completedJob.company,
        extractedTextLength: completedJob.extracted_text?.length ?? 0,
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
  const response = await fetch(jobUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "PramaniaJobIngestion/0.1",
    },
    redirect: "follow",
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
    resolvedUrl: response.url,
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

function assertSafeUrl(value: string) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();

  if (blockedHostnames.has(hostname) || hostname.endsWith(".localhost")) {
    throw new Error("JOB_URL_BLOCKED");
  }

  if (isPrivateIp(hostname)) {
    throw new Error("JOB_URL_BLOCKED");
  }
}

function isPrivateIp(hostname: string) {
  if (!isIP(hostname)) {
    return false;
  }

  if (hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0") {
    return true;
  }

  if (hostname.startsWith("10.") || hostname.startsWith("192.168.")) {
    return true;
  }

  const parts = hostname.split(".").map(Number);

  if (parts.length === 4) {
    const [first, second] = parts;

    if (first === 172 && second >= 16 && second <= 31) {
      return true;
    }

    if (first === 169 && second === 254) {
      return true;
    }
  }

  return hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80:");
}

function isHttpUrl(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
