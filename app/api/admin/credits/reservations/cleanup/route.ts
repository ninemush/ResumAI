import { apiAuthErrorDetails, requireProtectedApiSession } from "@/lib/api/auth";
import { apiError, apiSuccess, createRequestId } from "@/lib/api/responses";
import { cleanupStaleCreditReservations } from "@/lib/billing/credits";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "admin_credit_reservation_cleanup"),
    limit: 10,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Credit reservation cleanup is being requested too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    await requireProtectedApiSession({ requireAdmin: true });
    const cleanup = await cleanupStaleCreditReservations();

    return apiSuccess({
      cleanup,
      requestId,
    });
  } catch (error) {
    return apiError(requestId, toApiError(error));
  }
}

function toApiError(error: unknown) {
  const authError = apiAuthErrorDetails(error, "Owner or admin access is required.");
  if (authError) return authError;

  return {
    category: "server",
    code: "credits.reservation_cleanup_failed",
    message: "Unable to clean up stale credit reservations right now.",
    status: 500,
  };
}
