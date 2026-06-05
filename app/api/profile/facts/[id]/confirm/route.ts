import { NextResponse } from "next/server";

import {
  confirmProfileFact,
  confirmProfileFactSchema,
  deleteProfileFact,
  updateProfileFact,
  updateProfileFactSchema,
} from "@/lib/profile/profile-commands";
import { checkRateLimit, getClientRateLimitKey, rateLimitResponse } from "@/lib/security/rate-limit";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "profile_fact_confirm"),
    limit: 120,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Profile details are being confirmed too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  const params = await context.params;
  const parsed = confirmProfileFactSchema.safeParse({ factId: params.id });

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "profile_fact.invalid_id",
          message: "Choose a valid profile detail.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const fact = await confirmProfileFact(parsed.data);

    return NextResponse.json({
      ok: true,
      requestId,
      fact,
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

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "profile_fact_update"),
    limit: 120,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Profile details are being updated too quickly. Pause briefly before trying again.",
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

  const parsed = updateProfileFactSchema.safeParse({
    ...(typeof body === "object" && body ? body : {}),
    factId: params.id,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "profile_fact.invalid_update",
          message: "Use a valid profile detail before saving.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const fact = await updateProfileFact(parsed.data);

    return NextResponse.json({
      ok: true,
      requestId,
      fact,
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

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "profile_fact_delete"),
    limit: 60,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Profile details are being removed too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  const params = await context.params;
  const parsed = confirmProfileFactSchema.safeParse({ factId: params.id });

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "profile_fact.invalid_id",
          message: "Choose a valid profile detail.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const fact = await deleteProfileFact(parsed.data);

    return NextResponse.json({
      ok: true,
      requestId,
      fact,
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
  if (error instanceof Error && error.message === "AUTH_REQUIRED") {
    return {
      category: "auth",
      code: "auth.required",
      message: "Please sign in before confirming profile details.",
      status: 401,
    };
  }

  if (error instanceof Error && error.message === "PROFILE_FACT_NOT_FOUND") {
    return {
      category: "not_found",
      code: "profile_fact.not_found",
      message: "That profile detail could not be found.",
      status: 404,
    };
  }

  return {
    category: "server",
    code: "profile_fact.confirm_failed",
    message: "Unable to confirm that detail right now.",
    status: 500,
  };
}
