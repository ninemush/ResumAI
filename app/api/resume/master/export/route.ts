import { NextResponse } from "next/server";

import { exportMasterResumeArtifacts } from "@/lib/resumes/master-resume";

export async function POST() {
  const requestId = crypto.randomUUID();

  try {
    const overview = await exportMasterResumeArtifacts();

    return NextResponse.json({
      ok: true,
      requestId,
      overview,
    });
  } catch (error) {
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

function toApiError(error: unknown) {
  if (error instanceof Error) {
    if (error.message === "AUTH_REQUIRED") {
      return {
        category: "auth",
        code: "auth.required",
        message: "Please sign in before exporting your master resume.",
        status: 401,
      };
    }

    if (error.message === "PROFILE_NOT_FOUND" || error.message === "MASTER_RESUME_NOT_FOUND") {
      return {
        category: "not_found",
        code: "resume.not_found",
        message: "Generate a master resume before exporting files.",
        status: 404,
      };
    }

    if (error.message === "PDF_VALIDATION_FAILED") {
      return {
        category: "validation",
        code: "resume.pdf_validation_failed",
        message:
          "The master resume PDF did not pass content validation. Review the draft, save it, and try exporting again.",
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
    message: "The files were built but could not be stored securely. Try exporting again.",
    status: 500,
  };
}
