import { NextResponse } from "next/server";

import {
  createApplicationFromJob,
  createApplicationFromJobSchema,
} from "@/lib/applications/application-commands";

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
  if (error instanceof Error) {
    if (error.message === "AUTH_REQUIRED") {
      return {
        category: "auth",
        code: "auth.required",
        message: "Please sign in before logging an application.",
        status: 401,
      };
    }

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
  }

  return {
    category: "server",
    code: "application.create_failed",
    message: "Unable to log that application right now.",
    status: 500,
  };
}
