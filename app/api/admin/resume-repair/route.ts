import { apiError, apiSuccess, createRequestId, readOptionalJsonBody } from "@/lib/api/responses";
import { adminResumeRepairSchema, repairMasterResumes } from "@/lib/admin/resume-repair";
import { checkRateLimit, getClientRateLimitKey, rateLimitResponse } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "admin_resume_repair"),
    limit: 12,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Resume repair is being requested too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  const parsed = adminResumeRepairSchema.safeParse(await readOptionalJsonBody(request));

  if (!parsed.success) {
    return apiError(requestId, {
      category: "validation",
      code: "admin.resume_repair_invalid",
      message: "Use a valid email, user id, and dry-run flag for resume repair.",
      status: 400,
    });
  }

  try {
    const result = await repairMasterResumes(parsed.data);

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

  if (error instanceof Error && error.message === "RESUME_REPAIR_TARGET_MISMATCH") {
    return {
      category: "validation",
      code: "admin.resume_repair_target_mismatch",
      message: "The supplied email and user id do not refer to the same account.",
      status: 400,
    };
  }

  if (error instanceof Error && error.message === "RESUME_REPAIR_TARGET_NOT_FOUND") {
    return {
      category: "not_found",
      code: "admin.resume_repair_target_not_found",
      message: "No user was found for that repair target.",
      status: 404,
    };
  }

  return {
    category: "server",
    code: "admin.resume_repair_failed",
    message: "Resume repair could not be completed right now.",
    status: 500,
  };
}
