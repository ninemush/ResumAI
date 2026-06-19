import { NextResponse } from "next/server";

import {
  apiAuthErrorDetails,
  apiAuthErrorResponse,
  requireProtectedApiSession,
} from "@/lib/api/auth";
import { brand } from "@/lib/brand";
import {
  getRecentProfileSources,
  ingestProfileSource,
  profileSourceRequestSchema,
} from "@/lib/profile/profile-source-ingestion";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

export async function GET() {
  const requestId = crypto.randomUUID();

  try {
    await requireProtectedApiSession();
    const sources = await getRecentProfileSources();

    return NextResponse.json({
      ok: true,
      requestId,
      sources,
    });
  } catch (error) {
    const authResponse = apiAuthErrorResponse({
      error,
      fallbackMessage: "Please sign in before reading profile sources.",
      requestId,
    });
    if (authResponse) return authResponse;

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "server",
          code: "source.read_failed",
          message: "Unable to read profile sources right now.",
        },
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "request.invalid_json",
          message: "Invalid JSON body.",
        },
      },
      { status: 400 },
    );
  }

  const parsed = profileSourceRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "source.invalid_input",
          message: "The source type and provided source details do not match.",
        },
      },
      { status: 400 },
    );
  }

  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "profile_source_create"),
    limit: 20,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Sources are being added too quickly. Pause for a moment before adding more.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    await requireProtectedApiSession();
    const source = await ingestProfileSource(parsed.data);

    return NextResponse.json({
      ok: true,
      requestId,
      source,
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
  const authError = apiAuthErrorDetails(error, "Please sign in before adding profile sources.");
  if (authError) return authError;

  if (error instanceof Error) {
    if (error.message === "AUTH_REQUIRED") {
      return {
        category: "auth",
        code: "auth.required",
        message: "Please sign in before adding profile sources.",
        status: 401,
      };
    }

    if (error.message === "INVALID_STORAGE_PATH") {
      return {
        category: "validation",
        code: "source.invalid_storage_path",
        message: "Uploaded files must stay inside your private user folder.",
        status: 400,
      };
    }

    if (error.message === "LINKEDIN_URL_REQUIRED") {
      return {
        category: "validation",
        code: "source.linkedin_url_required",
        message: "LinkedIn sources must use a linkedin.com URL.",
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

    if (error.message === "PROFILE_LINK_BLOCKED") {
      return {
        category: "validation",
        code: "source.profile_link_blocked",
        message: "For security, I can only save public internet profile links.",
        status: 422,
      };
    }

    if (error.message === "PROFILE_LINK_UNSUPPORTED_PROTOCOL") {
      return {
        category: "validation",
        code: "source.profile_link_unsupported_protocol",
        message: "Profile links must use http or https.",
        status: 400,
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

    if (error.message.endsWith("_REQUIRED")) {
      return {
        category: "validation",
        code: `source.${error.message.toLowerCase()}`,
        message: "The source type and provided source details do not match.",
        status: 400,
      };
    }
  }

  return {
    category: "validation",
    code: "source.create_failed",
    message: "Unable to save that profile source yet.",
    status: 400,
  };
}
