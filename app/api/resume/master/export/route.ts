import { apiAuthErrorDetails, requireProtectedApiSession } from "@/lib/api/auth";
import { apiError, apiSuccess, createRequestId, readOptionalJsonBody } from "@/lib/api/responses";
import { ClaimReviewRequiredError } from "@/lib/applications/export-gates";
import {
  buildCreditsApiError,
  getCreditOperationKey,
} from "@/lib/billing/credits";
import { runPaidCreditOperation } from "@/lib/billing/credit-operations";
import {
  exportMasterResumeArtifacts,
  getMasterResumeOverview,
  getReusableMasterResumeExport,
} from "@/lib/resumes/master-resume";
import {
  isDefaultResumeExportSectionVisibility,
  normalizeResumeExportSectionVisibility,
} from "@/lib/resumes/export-readiness";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "master_resume_export"),
    limit: 8,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Resume exports are being requested too quickly. Pause briefly before preparing files again.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    const session = await requireProtectedApiSession();
    const body = await readOptionalJsonBody(request);
    const acknowledgeClaimReview =
      typeof body === "object" &&
      body !== null &&
      (body as { acknowledgeClaimReview?: unknown }).acknowledgeClaimReview === true;
    const sectionVisibility = normalizeResumeExportSectionVisibility(
      typeof body === "object" && body !== null
        ? (body as { sectionVisibility?: unknown }).sectionVisibility
        : null,
    );
    const operationKey = getCreditOperationKey(
      request,
      `masterResumeExport:latest:${JSON.stringify(sectionVisibility)}`,
    );
    const reusableOverview = isDefaultResumeExportSectionVisibility(sectionVisibility)
      ? await getReusableMasterResumeExport()
      : null;

    if (reusableOverview) {
      return apiSuccess({
        requestId,
        overview: reusableOverview,
        reused: true,
      });
    }

    const paidOperation = await runPaidCreditOperation({
      buildOutput: (result) => ({
        finalize: result.didExport,
        outputIds: { resumeId: result.overview.latestResume?.id ?? null },
        resourceId: result.overview.latestResume?.id ?? null,
      }),
      buildReusedResult: async (output) => ({
        didExport: false,
        overview: await getMasterResumeOverview(session.user.id),
        operationOutput: output.output_ids,
      } as Awaited<ReturnType<typeof exportMasterResumeArtifacts>> & {
        operationOutput: Record<string, unknown>;
      }),
      feature: "masterResumeExport",
      operationKey,
      resourceId: null,
      resourceType: "master_resume_export",
      run: () => exportMasterResumeArtifacts({ acknowledgeClaimReview, sectionVisibility }),
    });

    return apiSuccess({
      requestId,
      operationOutput: "operationOutput" in paidOperation.result ? paidOperation.result.operationOutput : undefined,
      overview: paidOperation.result.overview,
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
  const authError = apiAuthErrorDetails(
    error,
    "Please sign in before downloading your master resume files.",
  );
  if (authError) return authError;

  if (error instanceof ClaimReviewRequiredError) {
    return {
      category: "validation",
      claimReviewRequired: true,
      code: "resume.claim_review_required",
      message:
        "Review and acknowledge the highlighted high-impact claims before preparing the master resume files.",
      reviewItems: error.risks,
      status: 422,
    };
  }

  if (error instanceof Error) {
    if (error.message === "PROFILE_NOT_FOUND" || error.message === "MASTER_RESUME_NOT_FOUND") {
      return {
        category: "not_found",
        code: "resume.not_found",
        message: "Create a master resume before downloading files.",
        status: 404,
      };
    }

    if (error.message === "PDF_VALIDATION_FAILED" || error.message === "ARTIFACT_VALIDATION_FAILED") {
      return {
        category: "validation",
        code: "resume.artifact_validation_failed",
        message:
          "The master resume PDF or DOCX did not pass content validation. Review the draft, save it, and try preparing the files again.",
        status: 422,
      };
    }

    if (error.message === "MASTER_RESUME_CLAIM_REVIEW_REQUIRED") {
      return {
        category: "validation",
        code: "resume.claim_review_required",
        message:
          "Resolve unsupported high-impact claim notes before exporting the master resume files.",
        status: 422,
      };
    }

    if (error.message === "PDF_UPLOAD_FAILED" || error.message === "PDF_METADATA_UPDATE_FAILED") {
      return buildStorageError();
    }

    if (error.message === "ARTIFACT_UPLOAD_FAILED" || error.message === "ARTIFACT_METADATA_UPDATE_FAILED") {
      return buildStorageError();
    }
  }

  return {
    category: "server",
    code: "resume.artifact_export_failed",
    message: "Unable to export the master resume files right now.",
    status: 500,
  };
}

function buildStorageError() {
  return {
    category: "server",
    code: "resume.artifact_storage_failed",
    message: "The files were built but could not be stored securely. Try preparing them again.",
    status: 500,
  };
}
