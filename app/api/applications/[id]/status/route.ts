import { NextResponse } from "next/server";

import { updateApplicationStatus, updateApplicationStatusSchema } from "@/lib/applications/application-commands";
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
    key: getClientRateLimitKey(request, "application_status"),
    limit: 120,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Application status changes are being submitted too quickly. Pause briefly before trying again.",
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

  const parsed = updateApplicationStatusSchema.safeParse({
    ...(typeof body === "object" && body ? body : {}),
    applicationId: params.id,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "application.invalid_status",
          message: "Choose a valid application status.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const result = await updateApplicationStatus(parsed.data);

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
        message: "Please sign in before updating an application.",
        status: 401,
      };
    }

    if (error.message === "APPLICATION_NOT_FOUND") {
      return {
        category: "not_found",
        code: "application.not_found",
        message: "That application could not be found.",
        status: 404,
      };
    }

    if (error.message === "FINAL_MATERIALS_REQUIRED") {
      return {
        category: "validation",
        code: "application.final_materials_required",
        message: "Export final resume and cover-letter PDFs before marking this application applied.",
        status: 422,
      };
    }

    if (error.message === "APPLICATION_STATUS_EVENT_FAILED") {
      return {
        category: "server",
        code: "application.status_audit_failed",
        message: "Status could not be finalized because the audit event was not recorded.",
        status: 500,
      };
    }
  }

  return {
    category: "server",
    code: "application.status_update_failed",
    message: "Unable to update that application right now.",
    status: 500,
  };
}
