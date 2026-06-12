import { NextResponse } from "next/server";

import { apiAuthErrorDetails, requireProtectedApiSession } from "@/lib/api/auth";
import {
  createApplicationFromJob,
  createApplicationFromJobSchema,
} from "@/lib/applications/application-commands";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "application_create"),
    limit: 30,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Applications are being logged too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }
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

  const parsed = createApplicationFromJobSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "application.invalid_input",
          message: "A ready job post is required before logging an application.",
        },
      },
      { status: 400 },
    );
  }

  try {
    await requireProtectedApiSession();
    const result = await createApplicationFromJob(parsed.data);

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
  const authError = apiAuthErrorDetails(error, "Please sign in before logging an application.");
  if (authError) return authError;

  if (error instanceof Error) {
    if (error.message === "JOB_NOT_FOUND") {
      return {
        category: "not_found",
        code: "application.job_not_found",
        message: "That job post could not be found.",
        status: 404,
      };
    }

    if (error.message === "JOB_NOT_READY") {
      return {
        category: "validation",
        code: "application.job_not_ready",
        message: "The job post needs to be ingested successfully before it can be logged.",
        status: 422,
      };
    }

    if (error.message === "APPLICATION_SKIP_REQUIRES_OVERRIDE") {
      return {
        category: "validation",
        code: "application.skip_requires_override",
        message: "This role is marked as a skip. Confirm an override before logging it as an application.",
        status: 422,
      };
    }

    if (error.message === "INVALID_APPLICATION_DECISION") {
      return {
        category: "validation",
        code: "application.invalid_decision",
        message: "Choose whether to apply, network first, save for later, skip, or add more profile evidence.",
        status: 400,
      };
    }

    if (
      error.message === "QUOTA_EVENT_RECORD_FAILED" ||
      error.message === "APPLICATION_QUOTA_LINK_FAILED"
    ) {
      return {
        category: "server",
        code: "application.quota_audit_failed",
        message: "The application was created, but usage tracking could not be finalized.",
        status: 500,
      };
    }
  }

  return {
    category: "server",
    code: "application.create_failed",
    message: "Unable to log that application right now.",
    status: 500,
  };
}
