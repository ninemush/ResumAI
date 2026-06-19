import { NextResponse } from "next/server";

import { apiAuthErrorResponse, requireProtectedApiSession } from "@/lib/api/auth";
import { withPrivateNoStore } from "@/lib/api/responses";
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
    return withPrivateNoStore(rateLimitResponse({ requestId, result: rateLimit }));
  }

  try {
    await requireProtectedApiSession({ requireAdmin: true });
    const requests = await listAdminPrivacyRequests();

    return withPrivateNoStore(NextResponse.json({ ok: true, requestId, requests }));
  } catch (error) {
    const authResponse = apiAuthErrorResponse({
      error,
      fallbackMessage: "Sign in is required.",
      requestId,
    });
    if (authResponse) return withPrivateNoStore(authResponse);

    return withPrivateNoStore(
      NextResponse.json(
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
      ),
    );
  }
}
