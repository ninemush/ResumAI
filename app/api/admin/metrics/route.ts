import { NextResponse } from "next/server";

import { apiAuthErrorDetails, requireProtectedApiSession } from "@/lib/api/auth";
import { getOwnerMetrics } from "@/lib/admin/owner-metrics";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  const periodDays = parsePeriodDays(url.searchParams.get("periodDays"));
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "admin_metrics_read"),
    limit: 30,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Owner metrics are being requested too quickly. Pause briefly before refreshing.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    await requireProtectedApiSession({ requireAdmin: true });
    const metrics = await getOwnerMetrics(periodDays);

    return NextResponse.json({
      ok: true,
      requestId,
      metrics,
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
  const authError = apiAuthErrorDetails(error, "Sign in is required.");
  if (authError) return authError;

  return {
    category: "server",
    code: "admin.metrics_failed",
    message: "Unable to load owner metrics right now.",
    status: 500,
  };
}

function parsePeriodDays(value: string | null) {
  if (value === "all" || value === "0") {
    return 0;
  }

  const parsed = Number(value ?? 30);

  if (!Number.isFinite(parsed)) {
    return 30;
  }

  return Math.max(0, Math.min(Math.trunc(parsed), 365));
}
