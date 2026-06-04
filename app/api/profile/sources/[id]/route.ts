import { NextResponse } from "next/server";

import { removeProfileSource } from "@/lib/profile/profile-source-ingestion";
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

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const params = await context.params;

  if (!isUuid(params.id)) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "source.invalid_id",
          message: "The profile source id is invalid.",
        },
      },
      { status: 400 },
    );
  }

  const rateLimit = checkRateLimit({
    key: getClientRateLimitKey(request, "profile_source_delete"),
    limit: 12,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Sources are being removed too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    const removed = await removeProfileSource(params.id);

    return NextResponse.json({
      ok: true,
      removed,
      requestId,
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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function toApiError(error: unknown) {
  if (error instanceof Error) {
    if (error.message === "AUTH_REQUIRED") {
      return {
        category: "auth",
        code: "auth.required",
        message: "Please sign in before removing profile sources.",
        status: 401,
      };
    }

    if (error.message === "SOURCE_NOT_FOUND") {
      return {
        category: "not_found",
        code: "source.not_found",
        message: "That profile source could not be found.",
        status: 404,
      };
    }

    if (error.message === "INVALID_STORAGE_PATH") {
      return {
        category: "auth",
        code: "source.invalid_storage_path",
        message: "That source file is outside your private source folder.",
        status: 403,
      };
    }
  }

  return {
    category: "server",
    code: "source.delete_failed",
    message: "Unable to remove that source right now.",
    status: 500,
  };
}
