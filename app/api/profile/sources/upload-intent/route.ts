import { apiError, apiSuccess, createRequestId, readJsonBody } from "@/lib/api/responses";
import {
  createProfileSourceUploadIntent,
  profileSourceUploadIntentSchema,
} from "@/lib/profile/profile-source-ingestion";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "profile_source_upload_intent"),
    limit: 20,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Uploads are being started too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  const parsed = profileSourceUploadIntentSchema.safeParse(await readJsonBody(request).catch(() => null));

  if (!parsed.success) {
    return apiError(requestId, {
      category: "validation",
      code: "source.invalid_upload_intent",
      message: "Choose a supported PDF, DOCX, TXT, JPG, PNG, or WebP source.",
      status: 400,
    });
  }

  try {
    const intent = await createProfileSourceUploadIntent(parsed.data);

    return apiSuccess({
      intent,
      requestId,
    });
  } catch (error) {
    return apiError(requestId, toApiError(error));
  }
}

function toApiError(error: unknown) {
  if (error instanceof Error && error.message === "AUTH_REQUIRED") {
    return {
      category: "auth",
      code: "auth.required",
      message: "Please sign in before uploading profile sources.",
      status: 401,
    };
  }

  if (error instanceof Error && error.message === "UNSUPPORTED_UPLOAD_TYPE") {
    return {
      category: "validation",
      code: "source.unsupported_upload_type",
      message: "Use PDF, DOCX, TXT, JPG, PNG, or WebP. HEIC and HEIF are not supported yet.",
      status: 422,
    };
  }

  return {
    category: "server",
    code: "source.upload_intent_failed",
    message: "Unable to prepare that upload right now.",
    status: 500,
  };
}
