import { NextResponse } from "next/server";

import {
  updateApplicationPlan,
  updateApplicationPlanSchema,
} from "@/lib/applications/application-commands";
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
    key: getClientRateLimitKey(request, "application_plan"),
    limit: 80,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Application plan updates are being submitted too quickly. Pause briefly before trying again.",
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

  const parsed = updateApplicationPlanSchema.safeParse({
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
          code: "application.invalid_plan",
          message: "Use a valid follow-up date, priority, contact, notes, and next action.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const result = await updateApplicationPlan(parsed.data);

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
        message: "Please sign in before updating an application plan.",
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

    if (error.message === "APPLICATION_PLAN_INVALID_DATE") {
      return {
        category: "validation",
        code: "application.invalid_follow_up_date",
        message: "Use a valid follow-up date.",
        status: 400,
      };
    }
  }

  return {
    category: "server",
    code: "application.plan_update_failed",
    message: "Unable to update that application plan right now.",
    status: 500,
  };
}
