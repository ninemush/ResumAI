import { apiError, apiSuccess, createRequestId } from "@/lib/api/responses";
import {
  buildCreditsApiError,
  finalizeCreditReservation,
  getCreditOperationKey,
  requireCredits,
  releaseCreditReservation,
  reserveCredits,
} from "@/lib/billing/credits";
import {
  exportMaterialArtifacts,
  getReusableMaterialExport,
  materialReviewSchema,
} from "@/lib/applications/material-review";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

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
    await requireSignedInUser();
    const reusableReview = await getReusableMaterialExport(parsed.data);

    if (reusableReview) {
      return apiSuccess({
        requestId,
        review: reusableReview,
        reused: true,
      });
    }

    await requireCredits("applicationMaterialsExport");
    const reservation = await reserveCredits({
      feature: "applicationMaterialsExport",
      operationKey: getCreditOperationKey(
        request,
        `applicationMaterialsExport:${params.id}`,
      ),
      resourceId: params.id,
      resourceType: "application_materials_export",
    });
    let result: Awaited<ReturnType<typeof exportMaterialArtifacts>>;

    try {
      result = await exportMaterialArtifacts(parsed.data);
    } catch (error) {
      await releaseCreditReservation({
        reason: error instanceof Error ? error.message : "APPLICATION_MATERIAL_EXPORT_FAILED",
        reservationId: reservation.reservationId,
      }).catch(() => undefined);
      throw error;
    }

    if (result.didExport) {
      await finalizeCreditReservation({
        metadata: { application_id: params.id },
        reservationId: reservation.reservationId,
        resourceId: params.id,
      });
    } else {
      await releaseCreditReservation({
        reason: "APPLICATION_MATERIAL_EXPORT_REUSED",
        reservationId: reservation.reservationId,
      }).catch(() => undefined);
    }

    return apiSuccess({
      requestId,
      review: result.review,
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

async function requireSignedInUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }
}

function toApiError(error: unknown) {
  if (error instanceof Error) {
    if (error.message === "AUTH_REQUIRED") {
      return {
        category: "auth",
        code: "auth.required",
        message: "Please sign in before downloading application files.",
        status: 401,
      };
    }

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

    if (error.message === "PDF_VALIDATION_FAILED") {
      return {
        category: "validation",
        code: "application.pdf_validation_failed",
        message: "The PDF did not pass layout/content validation. Keep the editable materials and try again after reviewing the content.",
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
