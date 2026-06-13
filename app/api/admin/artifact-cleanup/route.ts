import { apiError, apiSuccess, createRequestId, readOptionalJsonBody } from "@/lib/api/responses";
import {
  adminArtifactCleanupSchema,
  cleanupStaleResumeArtifacts,
} from "@/lib/admin/artifact-cleanup";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "admin_artifact_cleanup"),
    limit: 12,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Artifact cleanup is being requested too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  const parsed = adminArtifactCleanupSchema.safeParse(await readOptionalJsonBody(request));

  if (!parsed.success) {
    return apiError(requestId, {
      category: "validation",
      code: "admin.artifact_cleanup_invalid",
      message: "Use a dry-run flag and valid resume ids for artifact cleanup.",
      status: 400,
    });
  }

  try {
    const result = await cleanupStaleResumeArtifacts(parsed.data);

    return apiSuccess({
      requestId,
      result,
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

  if (error instanceof Error && error.message === "ARTIFACT_CLEANUP_READ_FAILED") {
    return {
      category: "server",
      code: "admin.artifact_cleanup_read_failed",
      message: "Stale artifact records could not be read.",
      status: 500,
    };
  }

  if (error instanceof Error && error.message === "ARTIFACT_CLEANUP_UPDATE_FAILED") {
    return {
      category: "server",
      code: "admin.artifact_cleanup_update_failed",
      message: "Stale artifact records could not be reset.",
      status: 500,
    };
  }

  if (error instanceof Error && error.message === "ARTIFACT_CLEANUP_AUDIT_FAILED") {
    return {
      category: "server",
      code: "admin.artifact_cleanup_audit_failed",
      message: "Artifact cleanup was applied, but the audit event could not be written.",
      status: 500,
    };
  }

  return {
    category: "server",
    code: "admin.artifact_cleanup_failed",
    message: "Artifact cleanup could not be completed right now.",
    status: 500,
  };
}
