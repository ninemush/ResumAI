import { apiAuthErrorDetails, requireProtectedApiSession } from "@/lib/api/auth";
import { apiError, apiSuccess, createRequestId } from "@/lib/api/responses";
import {
  buildCreditsApiError,
  finalizeCreditReservation,
  getCreditOperationKey,
  recordCreditOperationOutput,
  requireCredits,
  releaseCreditReservation,
  reserveCredits,
} from "@/lib/billing/credits";
import {
  exportMasterResumeArtifacts,
  getReusableMasterResumeExport,
} from "@/lib/resumes/master-resume";
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
    await requireProtectedApiSession();
    const reusableOverview = await getReusableMasterResumeExport();

    if (reusableOverview) {
      return apiSuccess({
        requestId,
        overview: reusableOverview,
        reused: true,
      });
    }

    await requireCredits("masterResumeExport");
    const operationKey = getCreditOperationKey(
      request,
      "masterResumeExport:latest",
    );
    const reservation = await reserveCredits({
      feature: "masterResumeExport",
      operationKey,
      resourceId: null,
      resourceType: "master_resume_export",
    });
    let result: Awaited<ReturnType<typeof exportMasterResumeArtifacts>>;

    try {
      result = await exportMasterResumeArtifacts();
    } catch (error) {
      await releaseCreditReservation({
        reason: error instanceof Error ? error.message : "MASTER_RESUME_EXPORT_FAILED",
        reservationId: reservation.reservationId,
      }).catch(() => undefined);
      throw error;
    }

    if (result.didExport) {
      const finalizedReservation = await finalizeCreditReservation({
        metadata: { resume_id: result.overview.latestResume?.id ?? null },
        reservationId: reservation.reservationId,
        resourceId: result.overview.latestResume?.id,
      });
      await recordCreditOperationOutput({
        feature: "masterResumeExport",
        ledgerEventId: finalizedReservation.ledgerEventId,
        operationKey,
        outputIds: { resumeId: result.overview.latestResume?.id ?? null },
        reservationId: reservation.reservationId,
        resourceId: result.overview.latestResume?.id,
        resourceType: "master_resume_export",
      });
    } else {
      await releaseCreditReservation({
        reason: "MASTER_RESUME_EXPORT_REUSED",
        reservationId: reservation.reservationId,
      }).catch(() => undefined);
    }

    return apiSuccess({
      requestId,
      overview: result.overview,
      reused: !result.didExport,
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

  if (error instanceof Error) {
    if (error.message === "PROFILE_NOT_FOUND" || error.message === "MASTER_RESUME_NOT_FOUND") {
      return {
        category: "not_found",
        code: "resume.not_found",
        message: "Create a master resume before downloading files.",
        status: 404,
      };
    }

    if (error.message === "PDF_VALIDATION_FAILED") {
      return {
        category: "validation",
        code: "resume.pdf_validation_failed",
        message:
          "The master resume PDF did not pass content validation. Review the draft, save it, and try preparing the files again.",
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
