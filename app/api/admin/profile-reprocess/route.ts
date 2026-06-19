import { apiError, apiSuccess, createRequestId, readOptionalJsonBody } from "@/lib/api/responses";
import {
  adminProfileReprocessSchema,
  reprocessProfileEvidenceForUsers,
} from "@/lib/admin/profile-reprocess";
import { checkRateLimit, getClientRateLimitKey, rateLimitResponse } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "admin_profile_reprocess"),
    limit: 6,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Profile reprocessing is being requested too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  const parsed = adminProfileReprocessSchema.safeParse(await readOptionalJsonBody(request));

  if (!parsed.success) {
    return apiError(requestId, {
      category: "validation",
      code: "admin.profile_reprocess_invalid",
      message: "Use a valid dry-run flag, user id, limit, and resume repair setting.",
      status: 400,
    });
  }

  try {
    const result = await reprocessProfileEvidenceForUsers(parsed.data);

    return apiSuccess({
      requestId,
      ...result,
    });
  } catch (error) {
    return apiError(requestId, toApiError(error));
  }
}

function toApiError(error: unknown) {
  if (error instanceof Error && error.message === "ADMIN_REQUIRED") {
    return {
      category: "auth",
      code: "admin.required",
      message: "Owner or admin access is required.",
      status: 403,
    };
  }

  if (error instanceof Error && error.message === "SUPABASE_SERVICE_ROLE_KEY_REQUIRED") {
    return {
      category: "configuration",
      code: "admin.service_role_required",
      message: "Service-role access is required before profile evidence can be reprocessed.",
      status: 500,
    };
  }

  return {
    category: "server",
    code: "admin.profile_reprocess_failed",
    message: "Profile evidence reprocessing could not be completed right now.",
    status: 500,
  };
}
