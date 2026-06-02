import { NextResponse } from "next/server";

import {
  buildCreditsApiError,
  consumeCredits,
  requireCredits,
} from "@/lib/billing/credits";
import { exportMasterResumeArtifacts } from "@/lib/resumes/master-resume";

export async function POST() {
  const requestId = crypto.randomUUID();

  try {
    await requireCredits("masterResumeExport");
    const overview = await exportMasterResumeArtifacts();
    await consumeCredits({
      feature: "masterResumeExport",
      resourceId: overview.latestResume?.id,
      resourceType: "master_resume_export",
    });

    return NextResponse.json({
      ok: true,
      requestId,
      overview,
    });
  } catch (error) {
    if (isBillingError(error)) {
      const apiError = buildCreditsApiError(error);

      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: apiError,
        },
        { status: apiError.status },
      );
    }

    const { category, code, message, status } = toApiError(error);

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: { category, code, message },
      },
      { status },
    );
  }
}

function isBillingError(error: unknown) {
  return error instanceof Error && error.message.startsWith("CREDITS_");
}

function toApiError(error: unknown) {
  if (error instanceof Error) {
    if (error.message === "AUTH_REQUIRED") {
      return {
        category: "auth",
        code: "auth.required",
        message: "Please sign in before downloading your master resume files.",
        status: 401,
      };
    }

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
