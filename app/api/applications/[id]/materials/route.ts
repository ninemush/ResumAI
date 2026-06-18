import { apiAuthErrorDetails, requireProtectedApiSession } from "@/lib/api/auth";
import { apiError, apiSuccess, createRequestId, readJsonBody, readOptionalJsonBody } from "@/lib/api/responses";
import {
  buildCreditsApiError,
  getCreditOperationKey,
  isCreditOperationError,
} from "@/lib/billing/credits";
import { runPaidCreditOperation } from "@/lib/billing/credit-operations";
import {
  getReusableApplicationMaterials,
  generateApplicationMaterials,
  generateApplicationMaterialsSchema,
} from "@/lib/applications/material-generation";
import {
  getMaterialReview,
  updateMaterialReview,
  updateMaterialReviewSchema,
} from "@/lib/applications/material-review";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { buildOperationFingerprint } from "@/lib/security/operation-fingerprint";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const requestId = createRequestId();
  const params = await context.params;

  try {
    await requireProtectedApiSession();
    const review = await getMaterialReview({ applicationId: params.id });

    return apiSuccess({
      requestId,
      review,
    });
  } catch (error) {
    return apiError(requestId, toApiError(error));
  }
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  const params = await context.params;
  const body = await readOptionalJsonBody(request);
  const parsed = generateApplicationMaterialsSchema.safeParse({
    ...(typeof body === "object" && body ? body : {}),
    applicationId: params.id,
  });

  if (!parsed.success) {
    return apiError(requestId, {
      category: "validation",
      code: "application.invalid_id",
      message: "Choose a valid application.",
      status: 400,
    });
  }

  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "application_materials_generate"),
    limit: 8,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message:
        "Application packet generation is being requested too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    const session = await requireProtectedApiSession();
    const reusableMaterials =
      parsed.data.mode === "reuse"
        ? await getReusableApplicationMaterials(parsed.data)
        : null;

    if (reusableMaterials) {
      return apiSuccess({
        requestId,
        ...reusableMaterials,
        reused: true,
      });
    }

    const operationKey = getCreditOperationKey(
      request,
      parsed.data.idempotencyKey ??
        `applicationMaterialsGenerate:${params.id}:${parsed.data.mode}:${hashOperationInput(parsed.data.reason ?? "default")}`,
    );
    const paidOperation = await runPaidCreditOperation({
      buildOutput: (result) => ({
        finalize: result.didGenerate,
        ledgerMetadata: {
          cover_letter_id: result.coverLetterId,
          resume_id: result.resumeId,
        },
        outputIds: {
          coverLetterId: result.coverLetterId,
          resumeId: result.resumeId,
        },
        recordMetadata: {
          model: result.model,
          promptVersion: result.promptVersion,
        },
      }),
      buildReusedResult: (output) => ({
        coverLetterId: readStringOutput(output.output_ids.coverLetterId) ?? "stored",
        didGenerate: false,
        model: readStringOutput(output.metadata.model) ?? "stored",
        promptVersion: readStringOutput(output.metadata.promptVersion) ?? "stored",
        resumeId: readStringOutput(output.output_ids.resumeId) ?? "stored",
        summary: "Returned the existing application materials for this retry-safe operation.",
      }),
      feature: "applicationMaterialsGenerate",
      metadata: {
        mode: parsed.data.mode,
        reason: parsed.data.reason ?? null,
      },
      operationFingerprint: buildOperationFingerprint({
        basis: {
          applicationId: params.id,
          mode: parsed.data.mode,
          reason: parsed.data.reason ?? null,
        },
        feature: "applicationMaterialsGenerate",
        mode: parsed.data.mode,
        operationKey,
        resourceId: params.id,
        resourceType: "application_materials",
        userId: session.user.id,
      }),
      operationKey,
      resourceId: params.id,
      resourceType: "application_materials",
      run: () =>
        generateApplicationMaterials(parsed.data, {
          quotaOperationKey: operationKey,
        }),
    });

    return apiSuccess({
      requestId,
      ...paidOperation.result,
      reused: paidOperation.reused || !paidOperation.result.didGenerate,
    });
  } catch (error) {
    if (isCreditOperationError(error)) {
      const billingError = buildCreditsApiError(error);

      return apiError(requestId, billingError);
    }

    return apiError(requestId, toApiError(error));
  }
}

function hashOperationInput(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16);
}

function readStringOutput(value: unknown) {
  return typeof value === "string" ? value : null;
}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "application_materials_update"),
    limit: 60,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message:
        "Material edits are being saved too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }
  const params = await context.params;
  let body: unknown;

  try {
    body = await readJsonBody(request);
  } catch {
    return apiError(requestId, {
      category: "validation",
      code: "request.invalid_json",
      message: "Invalid JSON body.",
      status: 400,
    });
  }

  const parsed = updateMaterialReviewSchema.safeParse({
    ...(typeof body === "object" && body ? body : {}),
    applicationId: params.id,
  });

  if (!parsed.success) {
    return apiError(requestId, {
      category: "validation",
      code: "application.invalid_material_update",
      message:
        "Use valid resume sections or cover-letter text before saving.",
      status: 400,
    });
  }

  try {
    await requireProtectedApiSession();
    const review = await updateMaterialReview(parsed.data);

    return apiSuccess({
      requestId,
      review,
    });
  } catch (error) {
    return apiError(requestId, toApiError(error));
  }
}

function toApiError(error: unknown) {
  const authError = apiAuthErrorDetails(error, "Please sign in before generating materials.");
  if (authError) return authError;

  if (error instanceof Error) {
    if (error.message === "APPLICATION_NOT_FOUND") {
      return {
        category: "not_found",
        code: "application.not_found",
        message: "That application could not be found.",
        status: 404,
      };
    }

    if (error.message === "QUOTA_TIER_REQUIRED") {
      return {
        category: "permission",
        code: "quota.tier_required",
        message: "Choose an active tier before generating more application materials.",
        status: 402,
      };
    }

    if (error.message === "QUOTA_LIMIT_REACHED") {
      return {
        category: "quota",
        code: "quota.limit_reached",
        message: "This tier has reached its generation limit for the current period.",
        status: 429,
      };
    }

    if (error.message === "QUOTA_IDEMPOTENCY_MISMATCH") {
      return {
        category: "validation",
        code: "quota.idempotency_mismatch",
        message:
          "This retry key was already used for a different generation. Start the action again before using quota.",
        status: 409,
      };
    }

    if (error.message === "MATERIAL_UPDATE_REQUIRED") {
      return {
        category: "validation",
        code: "application.material_update_required",
        message: "Change resume or cover-letter content before saving.",
        status: 400,
      };
    }

    if (error.message === "JOB_TEXT_REQUIRED") {
      return {
        category: "validation",
        code: "application.job_text_required",
        message:
          "The job post needs enough detail before I can draft credible job-specific materials.",
        status: 422,
      };
    }

    if (
      error.message === "RESUME_NOT_FOUND" ||
      error.message === "COVER_LETTER_NOT_FOUND"
    ) {
      return {
        category: "not_found",
        code: "application.materials_not_found",
        message:
          "Draft the job-specific materials before reviewing or editing them.",
        status: 404,
      };
    }

    if (error.message === "PROFILE_CONTEXT_TOO_THIN") {
      return {
        category: "validation",
        code: "profile.context_too_thin",
        message:
          "I need a little more profile evidence before creating credible application materials.",
        status: 422,
      };
    }

    if (error.message === "APPLICATION_DECISION_SKIP") {
      return {
        category: "validation",
        code: "application.decision_skip",
        message: "This application is currently marked as a skip. Change the decision before generating materials.",
        status: 422,
      };
    }

    if (error.message === "APPLICATION_DECISION_NEEDS_PROFILE") {
      return {
        category: "validation",
        code: "application.needs_profile",
        message: "Add more profile evidence before generating credible job-specific materials.",
        status: 422,
      };
    }

    if (error.message === "MASTER_RESUME_READ_FAILED") {
      return {
        category: "server",
        code: "resume.master_read_failed",
        message:
          "I could not read the master resume context for this generation.",
        status: 500,
      };
    }

    if (error.message === "QUOTA_EVENT_RECORD_FAILED") {
      return {
        category: "server",
        code: "application.material_quota_audit_failed",
        message:
          "The materials were generated, but usage tracking could not be finalized.",
        status: 500,
      };
    }
  }

  return {
    category: "server",
    code: "application.material_generation_failed",
    message: "Unable to generate application materials right now.",
    status: 500,
  };
}
