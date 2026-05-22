import { NextResponse } from "next/server";

import { ingestJobUrl, jobIngestionRequestSchema } from "@/lib/jobs/job-ingestion";

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

  try {
    const result = await ingestJobUrl(parsed.data);

    return NextResponse.json({
      ok: true,
      requestId,
      ...result,
    });
  } catch (error) {
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
        message: "That link did not return a readable job page.",
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
