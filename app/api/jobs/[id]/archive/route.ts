import { NextResponse } from "next/server";

import {
  updateJobArchiveState,
  updateJobArchiveStateSchema,
} from "@/lib/jobs/job-commands";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const rateLimit = checkRateLimit({
    key: getClientRateLimitKey(request, "job_archive"),
    limit: 120,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Job archive changes are being submitted too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }
  const params = await context.params;
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

  const parsed = updateJobArchiveStateSchema.safeParse({
    ...(typeof body === "object" && body ? body : {}),
    jobId: params.id,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "job.invalid_archive_state",
          message: "Choose whether this job should be active or archived.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const result = await updateJobArchiveState(parsed.data);

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
        error: { category, code, message },
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
        message: "Please sign in before changing a job archive state.",
        status: 401,
      };
    }

    if (error.message === "JOB_NOT_FOUND") {
      return {
        category: "not_found",
        code: "job.not_found",
        message: "That job could not be found.",
        status: 404,
      };
    }
  }

  return {
    category: "server",
    code: "job.archive_update_failed",
    message: "Unable to update that job right now.",
    status: 500,
  };
}
