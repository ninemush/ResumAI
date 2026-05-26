import { NextResponse } from "next/server";

import {
  extractProfileSourceText,
  profileSourceExtractionRequestSchema,
} from "@/lib/parsing/profile-source-extraction";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const params = await context.params;
  const parsed = profileSourceExtractionRequestSchema.safeParse({
    sourceId: params.id,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "source.invalid_id",
          message: "The profile source id is invalid.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const result = await extractProfileSourceText(parsed.data);

    return NextResponse.json({
      ok: true,
      requestId,
      ...result,
    });
  } catch (error) {
    const { category, code, message, status } = toApiError(error);

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category,
          code,
          message,
        },
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
        message: "Please sign in before extracting profile sources.",
        status: 401,
      };
    }

    if (error.message === "SOURCE_NOT_FOUND") {
      return {
        category: "not_found",
        code: "source.not_found",
        message: "That profile source could not be found.",
        status: 404,
      };
    }

    if (error.message === "UNSUPPORTED_SOURCE_TYPE") {
      return {
        category: "validation",
        code: "source.unsupported_type",
        message: "TXT, PDF, Word, supported images, and public profile link extraction are available now.",
        status: 422,
      };
    }

    if (error.message === "URL_REQUIRED") {
      return {
        category: "validation",
        code: "source.url_required",
        message: "That profile source needs a URL before I can read it.",
        status: 400,
      };
    }

    if (error.message === "SOURCE_ALREADY_PROCESSING") {
      return {
        category: "conflict",
        code: "source.already_processing",
        message: "That source is already being processed.",
        status: 409,
      };
    }

    if (error.message === "TEXT_FILE_TOO_LARGE") {
      return {
        category: "validation",
        code: "source.text_file_too_large",
        message: "TXT extraction currently supports files up to 1 MB.",
        status: 413,
      };
    }

    if (error.message === "PDF_FILE_TOO_LARGE") {
      return {
        category: "validation",
        code: "source.pdf_file_too_large",
        message: "PDF extraction currently supports files up to 15 MB.",
        status: 413,
      };
    }

    if (error.message === "PDF_PAGE_LIMIT_EXCEEDED") {
      return {
        category: "validation",
        code: "source.pdf_page_limit_exceeded",
        message: "PDF extraction currently supports documents up to 15 pages.",
        status: 413,
      };
    }

    if (error.message === "PDF_TEXT_EMPTY") {
      return {
        category: "validation",
        code: "source.pdf_text_empty",
        message: "I could not find selectable text in that PDF. It may need OCR, which is coming next.",
        status: 422,
      };
    }

    if (error.message === "DOCX_FILE_TOO_LARGE") {
      return {
        category: "validation",
        code: "source.docx_file_too_large",
        message: "Word document extraction currently supports files up to 15 MB.",
        status: 413,
      };
    }

    if (error.message === "DOCX_TEXT_EMPTY") {
      return {
        category: "validation",
        code: "source.docx_text_empty",
        message: "I could not find readable text in that Word document.",
        status: 422,
      };
    }

    if (error.message === "IMAGE_OCR_UNSUPPORTED_MIME_TYPE") {
      return {
        category: "validation",
        code: "source.image_ocr_unsupported_mime_type",
        message: "Image OCR currently supports JPG, PNG, and WebP files.",
        status: 422,
      };
    }

    if (error.message === "IMAGE_OCR_FILE_TOO_LARGE") {
      return {
        category: "validation",
        code: "source.image_ocr_file_too_large",
        message: "Image OCR currently supports files up to 10 MB.",
        status: 413,
      };
    }

    if (error.message === "IMAGE_OCR_TEXT_EMPTY") {
      return {
        category: "validation",
        code: "source.image_ocr_text_empty",
        message: "I could not find readable text in that image.",
        status: 422,
      };
    }

    if (error.message === "IMAGE_OCR_FAILED") {
      return {
        category: "server",
        code: "source.image_ocr_failed",
        message: "Image OCR is unavailable right now. The image is saved, and you can try again later.",
        status: 502,
      };
    }

    if (error.message === "PROFILE_LINK_BLOCKED") {
      return {
        category: "validation",
        code: "source.profile_link_blocked",
        message: "For security, I can only read public internet profile links.",
        status: 422,
      };
    }

    if (error.message === "PROFILE_LINK_FETCH_FAILED") {
      return {
        category: "validation",
        code: "source.profile_link_fetch_failed",
        message: "I could not open that public profile link.",
        status: 422,
      };
    }

    if (error.message === "PROFILE_LINK_UNSUPPORTED_CONTENT_TYPE") {
      return {
        category: "validation",
        code: "source.profile_link_unsupported_content_type",
        message: "That link did not return a readable web page.",
        status: 422,
      };
    }

    if (error.message === "PROFILE_LINK_TOO_LARGE") {
      return {
        category: "validation",
        code: "source.profile_link_too_large",
        message: "That profile page is larger than the current extraction limit.",
        status: 413,
      };
    }

    if (error.message === "PROFILE_LINK_TEXT_TOO_SHORT") {
      return {
        category: "validation",
        code: "source.profile_link_text_too_short",
        message: "I could not find enough readable profile text on that page.",
        status: 422,
      };
    }
  }

  return {
    category: "server",
    code: "source.extraction_failed",
    message: "Unable to extract that source right now.",
    status: 500,
  };
}
