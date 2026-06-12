import { NextResponse } from "next/server";
import { z } from "zod";

import { apiAuthErrorResponse, requireProtectedApiSession } from "@/lib/api/auth";
import {
  createPrivacyRequest,
  listUserPrivacyRequests,
} from "@/lib/privacy/requests";
import { privacyRequestCreateSchema } from "@/lib/privacy/schemas";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "privacy_requests_read"),
    limit: 120,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({ requestId, result: rateLimit });
  }

  try {
    await requireProtectedApiSession();
    const requests = await listUserPrivacyRequests();

    return NextResponse.json({ ok: true, requestId, requests });
  } catch (error) {
    return privacyApiError(error, requestId, "privacy.requests_failed");
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "privacy_request_create"),
    limit: 10,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Privacy requests are being submitted too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    await requireProtectedApiSession();
    const input = privacyRequestCreateSchema.parse(await request.json());
    const privacyRequest = await createPrivacyRequest(input);

    return NextResponse.json({
      ok: true,
      request: privacyRequest,
      requestId,
    });
  } catch (error) {
    return privacyApiError(error, requestId, "privacy.request_create_failed");
  }
}

function privacyApiError(error: unknown, requestId: string, code: string) {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "privacy.invalid_request",
          message: "Use a valid privacy request type and concise details.",
        },
      },
      { status: 400 },
    );
  }

  const authResponse = apiAuthErrorResponse({
    error,
    fallbackMessage: "Sign in is required.",
    requestId,
  });
  if (authResponse) return authResponse;

  console.warn(
    JSON.stringify({
      code: error instanceof Error ? error.message : "UNKNOWN_PRIVACY_ERROR",
      event: "privacy_request_route_failed",
      requestId,
    }),
  );

  return NextResponse.json(
    {
      ok: false,
      requestId,
      error: {
        category: "server",
        code,
        message: "Privacy requests could not be processed right now.",
      },
    },
    { status: 500 },
  );
}
