import { NextResponse } from "next/server";

import { apiAuthErrorDetails, requireProtectedApiSession } from "@/lib/api/auth";
import { brand } from "@/lib/brand";
import {
  buildCreditsApiError,
  getCreditOperationKey,
  isCreditOperationError,
} from "@/lib/billing/credits";
import { runPaidCreditOperation } from "@/lib/billing/credit-operations";
import {
  extractProfileSourceText,
  profileSourceExtractionRequestSchema,
} from "@/lib/parsing/profile-source-extraction";
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

export async function POST(request: Request, context: RouteContext) {
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

  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "profile_source_extract"),
    limit: 10,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Sources are being processed too quickly. Pause briefly before retrying another extraction.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    const session = await requireProtectedApiSession();
    const operationKey = getCreditOperationKey(
      request,
      `profileSourceExtract:${params.id}`,
    );
    const paidOperation = await runPaidCreditOperation({
      buildOutput: (result) => ({
        ledgerMetadata: {
          career_profile_id: result.careerProfile?.id ?? null,
          source_analysis_id: result.sourceAnalysis?.id ?? null,
        },
        outputIds: {
          careerProfileId: result.careerProfile?.id ?? null,
          sourceAnalysisId: result.sourceAnalysis?.id ?? null,
          sourceId: result.source.id,
        },
        recordMetadata: {
          career_profile_id: result.careerProfile?.id ?? null,
          source_analysis_id: result.sourceAnalysis?.id ?? null,
          source_id: result.source.id,
        },
        resourceId: params.id,
      }),
      buildReusedResult: (output) => ({
        careerProfile:
          typeof output.output_ids.careerProfileId === "string"
            ? {
                id: output.output_ids.careerProfileId,
                status: "ready",
                versionNumber: 0,
              }
            : null,
        intake: {
          assistantMessage: "This source was already read for the same retry-safe operation.",
          facts: [],
          followUpQuestions: [],
          inScope: true,
          model: "stored",
          profileDraft: {
            displayName: null,
            headline: null,
            summary: null,
            targetDirection: null,
            targetLevel: null,
          },
          promptVersion: "stored",
          roleRecommendations: [],
          savedFactCount: 0,
          suggestedDirection: null,
        },
        source: {
          extractedTextLength: 0,
          extractionStatus: "analyzed" as const,
          id:
            typeof output.output_ids.sourceId === "string"
              ? output.output_ids.sourceId
              : params.id,
        },
        sourceAnalysis:
          typeof output.output_ids.sourceAnalysisId === "string"
            ? { id: output.output_ids.sourceAnalysisId }
            : null,
      }),
      feature: "profileSourceExtract",
      operationFingerprint: buildOperationFingerprint({
        basis: {
          operation: "extract_profile_source",
          sourceId: params.id,
        },
        feature: "profileSourceExtract",
        operationKey,
        resourceId: params.id,
        resourceType: "profile_source",
        userId: session.user.id,
      }),
      operationKey,
      resourceId: params.id,
      resourceType: "profile_source",
      run: () => extractProfileSourceText(parsed.data),
    });

    return NextResponse.json({
      ok: true,
      requestId,
      ...paidOperation.result,
      reused: paidOperation.reused,
    });
  } catch (error) {
    if (isCreditOperationError(error)) {
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
  const authError = apiAuthErrorDetails(error, "Please sign in before extracting profile sources.");
  if (authError) return authError;

  if (error instanceof Error) {
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
        message: "TXT, PDF, Word, supported images, and public profile links are available now.",
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

    if (error.message === "LINKEDIN_URL_REQUIRED") {
      return {
        category: "validation",
        code: "source.linkedin_url_required",
        message: "That LinkedIn source needs a valid LinkedIn profile URL.",
        status: 400,
      };
    }

    if (error.message === "SOURCE_ALREADY_PROCESSING") {
      return {
        category: "conflict",
        code: "source.already_processing",
        message: "That source is already being read.",
        status: 409,
      };
    }

    if (error.message === "TEXT_FILE_TOO_LARGE") {
      return {
        category: "validation",
        code: "source.text_file_too_large",
        message: "TXT reading currently supports files up to 1 MB.",
        status: 413,
      };
    }

    if (error.message === "PDF_FILE_TOO_LARGE") {
      return {
        category: "validation",
        code: "source.pdf_file_too_large",
        message: "PDF reading currently supports files up to 15 MB.",
        status: 413,
      };
    }

    if (error.message === "PDF_PAGE_LIMIT_EXCEEDED") {
      return {
        category: "validation",
        code: "source.pdf_page_limit_exceeded",
        message: "PDF reading currently supports documents up to 15 pages.",
        status: 413,
      };
    }

    if (error.message === "PDF_TEXT_EMPTY") {
      return {
        category: "validation",
        code: "source.pdf_text_empty",
        message: "I tried reading the PDF in two ways, but could not find usable career text in it.",
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
        message: "Word document reading currently supports files up to 15 MB.",
        status: 413,
      };
    }

    if (error.message === "DOC_UNSUPPORTED") {
      return {
        category: "validation",
        code: "source.doc_unsupported",
        message: `Older .doc files are not reliable for profile intake. Save or export the file as PDF or DOCX and drop it into ${brand.name}.`,
        status: 422,
      };
    }

    if (error.message === "DOCX_TEXT_EMPTY") {
      return {
        category: "validation",
        code: "source.docx_text_empty",
        message: "I could not find enough career text in that Word document.",
        status: 422,
      };
    }

    if (error.message === "IMAGE_OCR_UNSUPPORTED_MIME_TYPE") {
      return {
        category: "validation",
        code: "source.image_ocr_unsupported_mime_type",
        message: "Image reading currently supports JPG, PNG, and WebP files.",
        status: 422,
      };
    }

    if (error.message === "IMAGE_OCR_FILE_TOO_LARGE") {
      return {
        category: "validation",
        code: "source.image_ocr_file_too_large",
        message: "Image reading currently supports files up to 10 MB.",
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
        message: "That link did not return a web page I can use for profile intake.",
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
        message: "I could not find enough career profile detail on that page.",
        status: 422,
      };
    }

    if (error.message === "LINKEDIN_PUBLIC_PROFILE_BLOCKED") {
      return {
        category: "validation",
        code: "source.linkedin_public_profile_blocked",
        message:
          "I could not read enough public information from that LinkedIn profile. Some profiles are private, not indexed, or only visible when signed in. I can only use public information; upload a LinkedIn PDF/export or paste visible profile text for reliable enrichment.",
        status: 422,
      };
    }

    if (
      [
        "LINKEDIN_PUBLIC_PROFILE_NOT_READABLE",
        "LINKEDIN_PUBLIC_PROFILE_SEARCH_FAILED",
        "LINKEDIN_PUBLIC_PROFILE_SEARCH_PROVIDER_ERROR",
        "LINKEDIN_PUBLIC_PROFILE_SEARCH_INCOMPLETE",
        "LINKEDIN_PUBLIC_PROFILE_TEXT_TOO_SHORT",
        "LINKEDIN_PUBLIC_PROFILE_SEARCH_AUTH_FAILED",
        "LINKEDIN_PUBLIC_PROFILE_SEARCH_REJECTED",
        "LINKEDIN_PUBLIC_PROFILE_SEARCH_TEMPORARY_FAILURE",
        "LINKEDIN_PUBLIC_PROFILE_SEARCH_UNAVAILABLE",
      ].includes(error.message)
    ) {
      const errorDetails = getLinkedInPublicProfileSearchApiError(error.message);

      return {
        ...errorDetails,
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
    code: "source.reading_failed",
    message: "Unable to extract that source right now.",
    status: 500,
  };
}

function getLinkedInPublicProfileSearchApiError(code: string) {
  const retryMessage =
    "I could not complete the public LinkedIn profile read right now. The link is saved, and you can retry from Library. I can only use information visible on the public web; if the profile is private or not indexed, upload a LinkedIn PDF/export or paste the visible profile text.";

  const errors: Record<
    string,
    {
      category: string;
      code: string;
      message: string;
      status: number;
    }
  > = {
    LINKEDIN_PUBLIC_PROFILE_NOT_READABLE: {
      category: "validation",
      code: "source.linkedin_public_profile_not_readable",
      message:
        "I could not read enough public information from that LinkedIn profile. Some profiles are private, not indexed, or only visible when signed in. I can only use public information; upload a LinkedIn PDF/export or paste visible profile text for reliable enrichment.",
      status: 422,
    },
    LINKEDIN_PUBLIC_PROFILE_TEXT_TOO_SHORT: {
      category: "validation",
      code: "source.linkedin_public_profile_text_too_short",
      message:
        "The public LinkedIn results did not include enough career detail to build a trustworthy profile. I can only use public information; upload a LinkedIn PDF/export or paste visible profile text for reliable enrichment.",
      status: 422,
    },
    LINKEDIN_PUBLIC_PROFILE_SEARCH_REJECTED: {
      category: "validation",
      code: "source.linkedin_public_profile_search_rejected",
      message: retryMessage,
      status: 422,
    },
    LINKEDIN_PUBLIC_PROFILE_SEARCH_AUTH_FAILED: {
      category: "server",
      code: "source.linkedin_public_profile_search_auth_failed",
      message: "Public web profile search is not configured correctly. The LinkedIn link is saved.",
      status: 502,
    },
    LINKEDIN_PUBLIC_PROFILE_SEARCH_TEMPORARY_FAILURE: {
      category: "server",
      code: "source.linkedin_public_profile_search_temporary_failure",
      message: retryMessage,
      status: 502,
    },
    LINKEDIN_PUBLIC_PROFILE_SEARCH_UNAVAILABLE: {
      category: "server",
      code: "source.linkedin_public_profile_search_unavailable",
      message: retryMessage,
      status: 502,
    },
    LINKEDIN_PUBLIC_PROFILE_SEARCH_FAILED: {
      category: "server",
      code: "source.linkedin_public_profile_search_failed",
      message: retryMessage,
      status: 502,
    },
    LINKEDIN_PUBLIC_PROFILE_SEARCH_PROVIDER_ERROR: {
      category: "server",
      code: "source.linkedin_public_profile_search_provider_error",
      message: retryMessage,
      status: 502,
    },
    LINKEDIN_PUBLIC_PROFILE_SEARCH_INCOMPLETE: {
      category: "server",
      code: "source.linkedin_public_profile_search_incomplete",
      message: retryMessage,
      status: 502,
    },
  };

  return (
    errors[code] ?? {
      category: "server",
      code: "source.linkedin_public_profile_search_failed",
      message: retryMessage,
      status: 502,
    }
  );
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
      code: "source.pdf_text_reading_failed",
      message: "I could not read this PDF cleanly, and the backup read did not complete.",
      status: 502,
    },
    PDF_AI_EXTRACT_FAILED: {
      category: "server",
      code: "source.pdf_ai_extract_failed",
      message: "I could not read this PDF after retrying. The PDF is saved.",
      status: 502,
    },
    PDF_AI_PROVIDER_ERROR: {
      category: "server",
      code: "source.pdf_ai_provider_error",
      message: "Reading this PDF hit a service error after retrying. The PDF is saved.",
      status: 502,
    },
    PDF_AI_INCOMPLETE_RESPONSE: {
      category: "server",
      code: "source.pdf_ai_incomplete_response",
      message: "Reading this PDF returned incomplete text after retrying. The PDF is saved.",
      status: 502,
    },
    PDF_AI_PROVIDER_REJECTED_FILE: {
      category: "validation",
      code: "source.pdf_ai_provider_rejected_file",
      message: "I could not process this PDF. The PDF is saved.",
      status: 422,
    },
    PDF_AI_PROVIDER_TEMPORARY_FAILURE: {
      category: "server",
      code: "source.pdf_ai_provider_temporary_failure",
      message: "PDF reading is temporarily unavailable after retrying. The PDF is saved.",
      status: 502,
    },
    PDF_AI_PROVIDER_UNAVAILABLE: {
      category: "server",
      code: "source.pdf_ai_provider_unavailable",
      message: "PDF reading could not be reached after retrying. The PDF is saved.",
      status: 502,
    },
    PDF_AI_PROVIDER_AUTH_FAILED: {
      category: "server",
      code: "source.pdf_ai_provider_auth_failed",
      message: "PDF reading needs an owner-side configuration check. The PDF is saved.",
      status: 500,
    },
  };

  return errors[code] ?? {
    category: "server",
    code: "source.pdf_reading_failed",
    message: "Unable to read that PDF right now. The PDF is saved.",
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
      message: "LinkedIn archive reading currently supports files up to 25 MB.",
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
      message: "I could not find enough profile detail in that LinkedIn export.",
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
        "I retried reading the image but could not find usable career text. The image is saved.",
      status: 422,
    },
    IMAGE_OCR_PROVIDER_ERROR: {
      category: "server",
      code: "source.image_ocr_provider_error",
      message: "Image reading hit a service error after retrying. The image is saved.",
      status: 502,
    },
    IMAGE_OCR_INCOMPLETE_RESPONSE: {
      category: "server",
      code: "source.image_ocr_incomplete_response",
      message: "Image reading returned incomplete text after retrying. The image is saved.",
      status: 502,
    },
    IMAGE_OCR_PROVIDER_REJECTED_IMAGE: {
      category: "validation",
      code: "source.image_ocr_provider_rejected_image",
      message:
        "I could not process this image after retrying. The image is saved.",
      status: 422,
    },
    IMAGE_OCR_PROVIDER_TEMPORARY_FAILURE: {
      category: "server",
      code: "source.image_ocr_provider_temporary_failure",
      message: "Image reading is temporarily unavailable after retrying. The image is saved.",
      status: 502,
    },
    IMAGE_OCR_PROVIDER_UNAVAILABLE: {
      category: "server",
      code: "source.image_ocr_provider_unavailable",
      message: "Image reading could not be reached after retrying. The image is saved.",
      status: 502,
    },
    IMAGE_OCR_PROVIDER_AUTH_FAILED: {
      category: "server",
      code: "source.image_ocr_provider_auth_failed",
      message: "Image reading needs an owner-side configuration check. The image is saved.",
      status: 500,
    },
  };

  return errors[code] ?? {
    category: "server",
    code: "source.image_ocr_failed",
    message: "Image reading is unavailable right now. The image is saved.",
    status: 502,
  };
}
