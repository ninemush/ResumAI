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

    if (error.message === "LINKEDIN_SOURCE_REQUIRED") {
      return {
        category: "validation",
        code: "source.linkedin_source_required",
        message: "LinkedIn sources need a profile URL or an uploaded LinkedIn export.",
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
        message: "I tried text extraction and PDF vision extraction, but could not find readable career text in that PDF.",
        status: 422,
      };
    }

    if (
      [
        "PDF_TEXT_EXTRACTION_FAILED",
        "PDF_AI_EXTRACT_FAILED",
        "PDF_AI_PROVIDER_ERROR",
        "PDF_AI_INCOMPLETE_RESPONSE",
        "PDF_AI_PROVIDER_REJECTED_FILE",
        "PDF_AI_PROVIDER_TEMPORARY_FAILURE",
        "PDF_AI_PROVIDER_UNAVAILABLE",
        "PDF_AI_PROVIDER_AUTH_FAILED",
      ].includes(error.message)
    ) {
      const errorDetails = getPdfExtractionApiError(error.message);

      return {
        ...errorDetails,
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

    if (
      [
        "IMAGE_OCR_TEXT_EMPTY",
        "IMAGE_OCR_PROVIDER_ERROR",
        "IMAGE_OCR_INCOMPLETE_RESPONSE",
        "IMAGE_OCR_PROVIDER_REJECTED_IMAGE",
        "IMAGE_OCR_PROVIDER_TEMPORARY_FAILURE",
        "IMAGE_OCR_PROVIDER_UNAVAILABLE",
        "IMAGE_OCR_PROVIDER_AUTH_FAILED",
      ].includes(error.message)
    ) {
      const errorDetails = getImageOcrApiError(error.message);

      return {
        ...errorDetails,
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

    if (error.message === "LINKEDIN_PUBLIC_PROFILE_BLOCKED") {
      return {
        category: "validation",
        code: "source.linkedin_public_profile_blocked",
        message:
          "LinkedIn did not return readable profile content to the server. Use a LinkedIn PDF export, screenshot, or pasted profile text for reliable enrichment.",
        status: 422,
      };
    }

    if (error.message.startsWith("LINKEDIN_ARCHIVE_")) {
      const errorDetails = getLinkedInArchiveApiError(error.message);

      return {
        ...errorDetails,
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

function getPdfExtractionApiError(code: string) {
  const errors: Record<
    string,
    {
      category: string;
      code: string;
      message: string;
      status: number;
    }
  > = {
    PDF_TEXT_EXTRACTION_FAILED: {
      category: "server",
      code: "source.pdf_text_extraction_failed",
      message: "The PDF parser could not read this file, and fallback extraction did not complete.",
      status: 502,
    },
    PDF_AI_EXTRACT_FAILED: {
      category: "server",
      code: "source.pdf_ai_extract_failed",
      message: "PDF vision extraction failed after retrying. The PDF is saved.",
      status: 502,
    },
    PDF_AI_PROVIDER_ERROR: {
      category: "server",
      code: "source.pdf_ai_provider_error",
      message: "PDF vision extraction returned a provider error after retrying. The PDF is saved.",
      status: 502,
    },
    PDF_AI_INCOMPLETE_RESPONSE: {
      category: "server",
      code: "source.pdf_ai_incomplete_response",
      message: "PDF vision extraction returned an incomplete response after retrying. The PDF is saved.",
      status: 502,
    },
    PDF_AI_PROVIDER_REJECTED_FILE: {
      category: "validation",
      code: "source.pdf_ai_provider_rejected_file",
      message: "PDF vision extraction could not process this file. The PDF is saved.",
      status: 422,
    },
    PDF_AI_PROVIDER_TEMPORARY_FAILURE: {
      category: "server",
      code: "source.pdf_ai_provider_temporary_failure",
      message: "PDF vision extraction is temporarily unavailable after retrying. The PDF is saved.",
      status: 502,
    },
    PDF_AI_PROVIDER_UNAVAILABLE: {
      category: "server",
      code: "source.pdf_ai_provider_unavailable",
      message: "PDF vision extraction could not be reached after retrying. The PDF is saved.",
      status: 502,
    },
    PDF_AI_PROVIDER_AUTH_FAILED: {
      category: "server",
      code: "source.pdf_ai_provider_auth_failed",
      message: "PDF vision extraction is not configured correctly. The PDF is saved.",
      status: 500,
    },
  };

  return errors[code] ?? {
    category: "server",
    code: "source.pdf_extraction_failed",
    message: "Unable to extract that PDF right now. The PDF is saved.",
    status: 500,
  };
}

function getLinkedInArchiveApiError(code: string) {
  const errors: Record<
    string,
    {
      category: string;
      code: string;
      message: string;
      status: number;
    }
  > = {
    LINKEDIN_ARCHIVE_FILE_TOO_LARGE: {
      category: "validation",
      code: "source.linkedin_archive_file_too_large",
      message: "LinkedIn archive extraction currently supports files up to 25 MB.",
      status: 413,
    },
    LINKEDIN_ARCHIVE_INVALID_ZIP: {
      category: "validation",
      code: "source.linkedin_archive_invalid_zip",
      message: "That file does not look like a valid LinkedIn archive ZIP.",
      status: 422,
    },
    LINKEDIN_ARCHIVE_NO_PROFILE_FILES: {
      category: "validation",
      code: "source.linkedin_archive_no_profile_files",
      message:
        "I could not find LinkedIn profile CSV files in that archive. Try the profile PDF export or upload Positions.csv, Profile.csv, Skills.csv, or Education.csv.",
      status: 422,
    },
    LINKEDIN_ARCHIVE_TEXT_EMPTY: {
      category: "validation",
      code: "source.linkedin_archive_text_empty",
      message: "I could not find readable profile rows in that LinkedIn export.",
      status: 422,
    },
    LINKEDIN_ARCHIVE_UNSUPPORTED_FILE: {
      category: "validation",
      code: "source.linkedin_archive_unsupported_file",
      message: "LinkedIn archive import supports ZIP and CSV files.",
      status: 422,
    },
  };

  return errors[code] ?? {
    category: "server",
    code: "source.linkedin_archive_failed",
    message: "Unable to extract that LinkedIn archive right now.",
    status: 500,
  };
}

function getImageOcrApiError(code: string) {
  const errors: Record<
    string,
    {
      category: string;
      code: string;
      message: string;
      status: number;
    }
  > = {
    IMAGE_OCR_TEXT_EMPTY: {
      category: "validation",
      code: "source.image_ocr_text_empty",
      message:
        "I retried OCR but could not find readable career text in that image. The image is saved.",
      status: 422,
    },
    IMAGE_OCR_PROVIDER_ERROR: {
      category: "server",
      code: "source.image_ocr_provider_error",
      message: "OCR returned a provider error after retrying. The image is saved.",
      status: 502,
    },
    IMAGE_OCR_INCOMPLETE_RESPONSE: {
      category: "server",
      code: "source.image_ocr_incomplete_response",
      message: "OCR returned an incomplete response after retrying. The image is saved.",
      status: 502,
    },
    IMAGE_OCR_PROVIDER_REJECTED_IMAGE: {
      category: "validation",
      code: "source.image_ocr_provider_rejected_image",
      message:
        "OCR could not process this image format/content after retrying. The image is saved.",
      status: 422,
    },
    IMAGE_OCR_PROVIDER_TEMPORARY_FAILURE: {
      category: "server",
      code: "source.image_ocr_provider_temporary_failure",
      message: "OCR is temporarily unavailable after retrying. The image is saved.",
      status: 502,
    },
    IMAGE_OCR_PROVIDER_UNAVAILABLE: {
      category: "server",
      code: "source.image_ocr_provider_unavailable",
      message: "OCR could not be reached after retrying. The image is saved.",
      status: 502,
    },
    IMAGE_OCR_PROVIDER_AUTH_FAILED: {
      category: "server",
      code: "source.image_ocr_provider_auth_failed",
      message: "OCR is not configured correctly. The image is saved.",
      status: 500,
    },
  };

  return errors[code] ?? {
    category: "server",
    code: "source.image_ocr_failed",
    message: "Image OCR is unavailable right now. The image is saved.",
    status: 502,
  };
}
