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
        message: "TXT extraction is available now. PDF, Word, image, and link extraction are next.",
        status: 422,
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
  }

  return {
    category: "server",
    code: "source.extraction_failed",
    message: "Unable to extract that source right now.",
    status: 500,
  };
}
