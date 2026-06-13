import { apiAuthErrorDetails, requireProtectedApiSession } from "@/lib/api/auth";
import { apiError, apiSuccess, createRequestId, readOptionalJsonBody } from "@/lib/api/responses";
import { ClaimReviewRequiredError } from "@/lib/applications/export-gates";
import {
  buildCreditsApiError,
  getCreditOperationKey,
} from "@/lib/billing/credits";
import { runPaidCreditOperation } from "@/lib/billing/credit-operations";
import {
  exportMaterialArtifacts,
  getMaterialReview,
  getReusableMaterialExport,
  materialReviewSchema,
} from "@/lib/applications/material-review";
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
  const params = await context.params;
  const parsed = materialReviewSchema.safeParse({ applicationId: params.id });

  if (!parsed.success) {
    return apiError(requestId, {
      category: "validation",
      code: "application.invalid_id",
      message: "Choose a valid application.",
      status: 400,
    });
  }

  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "application_materials_export"),
    limit: 8,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Application exports are being requested too quickly. Pause briefly before preparing files again.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    await requireProtectedApiSession();
    const body = await readOptionalJsonBody(request);
    const acknowledgeClaimReview =
      typeof body === "object" &&
      body !== null &&
      (body as { acknowledgeClaimReview?: unknown }).acknowledgeClaimReview === true;
    const operationKey = getCreditOperationKey(
      request,
      `applicationMaterialsExport:${params.id}`,
    );
    const reusableReview = await getReusableMaterialExport(parsed.data);

    if (reusableReview) {
      return apiSuccess({
        requestId,
        review: reusableReview,
        reused: true,
      });
    }

    const paidOperation = await runPaidCreditOperation({
      buildOutput: (result) => ({
        finalize: result.didExport,
        ledgerMetadata: {
          application_id: params.id,
        },
        outputIds: {
          applicationId: params.id,
          coverLetterId: result.review.coverLetter?.id ?? null,
          resumeId: result.review.resume?.id ?? null,
        },
      }),
      buildReusedResult: async (output) => ({
        didExport: false,
        operationOutput: output.output_ids,
        review: await getMaterialReview(parsed.data),
      } as Awaited<ReturnType<typeof exportMaterialArtifacts>> & {
        operationOutput: Record<string, unknown>;
      }),
      feature: "applicationMaterialsExport",
      operationKey,
      resourceId: params.id,
      resourceType: "application_materials_export",
      run: () => exportMaterialArtifacts(parsed.data, { acknowledgeClaimReview }),
    });

    return apiSuccess({
      requestId,
      operationOutput: "operationOutput" in paidOperation.result ? paidOperation.result.operationOutput : undefined,
      review: paidOperation.result.review,
      reused: paidOperation.reused || !paidOperation.result.didExport,
    });
  } catch (error) {
    if (isBillingError(error)) {
      const billingError = buildCreditsApiError(error);

      return apiError(requestId, billingError);
    }

    return apiError(requestId, toApiError(error));
  }
}

function isBillingError(error: unknown) {
  return error instanceof Error && error.message.startsWith("CREDITS_");
}

function toApiError(error: unknown) {
  const authError = apiAuthErrorDetails(error, "Please sign in before downloading application files.");
  if (authError) return authError;

  if (error instanceof ClaimReviewRequiredError) {
    return {
      category: "validation",
      claimReviewRequired: true,
      code: "application.claim_review_required",
      message:
        "Review and acknowledge the highlighted high-impact claims before preparing final application files.",
      reviewItems: error.risks,
      status: 422,
    };
  }

  if (error instanceof Error) {
    if (error.message === "APPLICATION_NOT_FOUND") {
      return {
        category: "not_found",
        code: "application.not_found",
        message: "That application could not be found.",
        status: 404,
      };
    }

    if (error.message === "MATERIALS_NOT_FOUND") {
      return {
        category: "not_found",
        code: "application.materials_not_found",
        message: "Create resume and cover-letter drafts before downloading files.",
        status: 404,
      };
    }

    if (error.message === "PDF_VALIDATION_FAILED" || error.message === "ARTIFACT_VALIDATION_FAILED") {
      return {
        category: "validation",
        code: "application.artifact_validation_failed",
        message:
          "The PDF or DOCX did not pass content validation. Keep the editable materials and try again after reviewing the content.",
        status: 422,
      };
    }

    if (error.message === "MATERIAL_CLAIM_ACK_REQUIRED") {
      return {
        category: "validation",
        code: "application.claim_review_required",
        message:
          "Resolve unsupported high-impact claim notes before exporting final application files.",
        status: 422,
      };
    }

    if (
      error.message === "PDF_UPLOAD_FAILED" ||
      error.message === "PDF_METADATA_UPDATE_FAILED" ||
      error.message === "ARTIFACT_UPLOAD_FAILED" ||
      error.message === "ARTIFACT_METADATA_UPDATE_FAILED"
    ) {
      return {
        category: "server",
        code: "application.artifact_storage_failed",
        message: "The files were built but could not be stored securely. Try preparing them again.",
        status: 500,
      };
    }
  }

  return {
    category: "server",
    code: "application.artifact_export_failed",
    message: "Unable to export files right now.",
    status: 500,
  };
}
