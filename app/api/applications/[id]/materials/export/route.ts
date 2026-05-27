import { NextResponse } from "next/server";

import { exportMaterialPdfs, materialReviewSchema } from "@/lib/applications/material-review";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const params = await context.params;
  const parsed = materialReviewSchema.safeParse({ applicationId: params.id });

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "application.invalid_id",
          message: "Choose a valid application.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const review = await exportMaterialPdfs(parsed.data);

    return NextResponse.json({
      ok: true,
      requestId,
      review,
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
        message: "Please sign in before exporting materials.",
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
        message: "Generate resume and cover-letter materials before exporting PDFs.",
        status: 404,
      };
    }

    if (error.message === "PDF_VALIDATION_FAILED") {
      return {
        category: "validation",
        code: "application.pdf_validation_failed",
        message: "The PDF export did not pass layout/content validation. Keep the editable materials and try again after reviewing the content.",
        status: 422,
      };
    }

    if (error.message === "PDF_UPLOAD_FAILED" || error.message === "PDF_METADATA_UPDATE_FAILED") {
      return {
        category: "server",
        code: "application.pdf_storage_failed",
        message: "The PDFs were built but could not be stored securely. Try exporting again.",
        status: 500,
      };
    }
  }

  return {
    category: "server",
    code: "application.pdf_export_failed",
    message: "Unable to export PDFs right now.",
    status: 500,
  };
}
