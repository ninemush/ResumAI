import { apiAuthErrorDetails, requireProtectedApiSession } from "@/lib/api/auth";
import { apiError, apiSuccess, createRequestId } from "@/lib/api/responses";
import { completeProfileSourceUpload } from "@/lib/profile/profile-source-ingestion";
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

export async function POST(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "profile_source_complete_upload"),
    limit: 30,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Uploads are being completed too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  const params = await context.params;

  try {
    await requireProtectedApiSession();
    const source = await completeProfileSourceUpload({ sourceId: params.id });

    return apiSuccess({
      requestId,
      source,
    });
  } catch (error) {
    return apiError(requestId, toApiError(error));
  }
}

function toApiError(error: unknown) {
  const authError = apiAuthErrorDetails(error, "Please sign in before completing profile uploads.");
  if (authError) return authError;

  if (error instanceof Error && error.message === "SOURCE_NOT_FOUND") {
    return {
      category: "not_found",
      code: "source.not_found",
      message: "That upload intent could not be found.",
      status: 404,
    };
  }

  if (error instanceof Error && error.message === "SOURCE_UPLOAD_NOT_FOUND") {
    return {
      category: "validation",
      code: "source.upload_not_found",
      message: "The uploaded file was not found. Try uploading it again.",
      status: 422,
    };
  }

  return {
    category: "server",
    code: "source.complete_upload_failed",
    message: "Unable to finalize that upload right now.",
    status: 500,
  };
}
