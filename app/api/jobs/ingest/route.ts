import { NextResponse } from "next/server";

import {
  buildCreditsApiError,
  consumeCredits,
  requireCredits,
} from "@/lib/billing/credits";
import { ingestJobUrl, jobIngestionRequestSchema } from "@/lib/jobs/job-ingestion";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "request.invalid_json",
          message: "Invalid JSON body.",
        },
      },
      { status: 400 },
    );
  }

  const parsed = jobIngestionRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "job.invalid_url",
          message: "Enter a valid http or https job posting URL.",
        },
      },
      { status: 400 },
    );
  }

  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "job_ingest"),
    limit: 12,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Job links are being read too quickly. Pause briefly before adding another role.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    await requireCredits("jobIngest");
    const result = await ingestJobUrl(parsed.data);
    await consumeCredits({
      feature: "jobIngest",
      metadata: { job_url: parsed.data.jobUrl },
      resourceId: result.job.id,
      resourceType: "job_ingestion",
    });

    return NextResponse.json({
      ok: true,
      requestId,
      ...result,
    });
  } catch (error) {
    if (isBillingError(error)) {
      const apiError = buildCreditsApiError(error);

      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: apiError,
        },
        { status: apiError.status },
      );
    }

    const { category, code, message, status } = toApiError(error);

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category,
          code,
          message,
        },
      },
      { status },
    );
  }
}

function isBillingError(error: unknown) {
  return error instanceof Error && error.message.startsWith("CREDITS_");
}

function toApiError(error: unknown) {
  if (error instanceof Error) {
    if (error.message === "AUTH_REQUIRED") {
      return {
        category: "auth",
        code: "auth.required",
        message: "Please sign in before ingesting a job post.",
        status: 401,
      };
    }

    if (error.message === "JOB_URL_BLOCKED") {
      return {
        category: "validation",
        code: "job.url_blocked",
        message: "That URL is not allowed for job ingestion.",
        status: 400,
      };
    }

    if (error.message === "JOB_PAGE_TOO_LARGE") {
      return {
        category: "validation",
        code: "job.page_too_large",
        message: "That job page is too large to ingest right now.",
        status: 413,
      };
    }

    if (error.message === "JOB_UNSUPPORTED_CONTENT_TYPE") {
      return {
        category: "validation",
        code: "job.unsupported_content_type",
        message: "That link did not return enough job-post detail.",
        status: 422,
      };
    }

    if (error.message === "JOB_TEXT_TOO_SHORT") {
      return {
        category: "validation",
        code: "job.text_too_short",
        message: "I could not find enough job-post text on that page.",
        status: 422,
      };
    }
  }

  return {
    category: "server",
    code: "job.ingestion_failed",
    message: "Unable to ingest that job post right now.",
    status: 500,
  };
}
