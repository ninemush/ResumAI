import { NextResponse } from "next/server";

import { listAdminPrivacyRequests } from "@/lib/privacy/requests";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "admin_privacy_requests_read"),
    limit: 80,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({ requestId, result: rateLimit });
  }

  try {
    const requests = await listAdminPrivacyRequests();

    return NextResponse.json({ ok: true, requestId, requests });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") {
      return NextResponse.json(
        { ok: false, requestId, error: { code: "auth.required", message: "Sign in is required." } },
        { status: 401 },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "auth",
          code: "admin.required",
          message: "Owner or admin access is required.",
        },
      },
      { status: 403 },
    );
  }
}
