import { NextResponse } from "next/server";

import { apiError, createRequestId } from "@/lib/api/responses";
import { getPlatformStatus } from "@/lib/admin/platform-status";
import { checkRateLimit, getClientRateLimitKey, rateLimitResponse } from "@/lib/security/rate-limit";

export async function GET(request: Request) {
  const requestId = createRequestId();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "admin_platform_status"),
    limit: 30,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Platform status is being refreshed too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    const status = await getPlatformStatus();

    return NextResponse.json({
      ok: true,
      requestId,
      status,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_REQUIRED") {
      return apiError(requestId, {
        category: "auth",
        code: "admin.required",
        message: "Owner or admin access is required.",
        status: 403,
      });
    }

    return apiError(requestId, {
      category: "server",
      code: "admin.platform_status_failed",
      message: "Unable to load platform status right now.",
      status: 500,
    });
  }
}
