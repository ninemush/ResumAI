import { NextResponse } from "next/server";

import {
  getRecentProfileSources,
  ingestProfileSource,
  profileSourceRequestSchema,
} from "@/lib/profile/profile-source-ingestion";

export async function GET() {
  const requestId = crypto.randomUUID();

  try {
    const sources = await getRecentProfileSources();

    return NextResponse.json({
      ok: true,
      requestId,
      sources,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: {
            category: "auth",
            code: "auth.required",
            message: "Please sign in before reading profile sources.",
          },
        },
        { status: 401 },
      );
    }

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

  try {
    const source = await ingestProfileSource(parsed.data);

    return NextResponse.json({
      ok: true,
      requestId,
      source,
    });
  } catch (error) {
    const { code, message, status } = toApiError(error);

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: status === 401 ? "auth" : "validation",
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
        code: "auth.required",
        message: "Please sign in before adding profile sources.",
        status: 401,
      };
    }

    if (error.message === "INVALID_STORAGE_PATH") {
      return {
        code: "source.invalid_storage_path",
        message: "Uploaded files must stay inside your private user folder.",
        status: 400,
      };
    }

    if (error.message === "LINKEDIN_URL_REQUIRED") {
      return {
        code: "source.linkedin_url_required",
        message: "LinkedIn sources must use a linkedin.com URL.",
        status: 400,
      };
    }

    if (error.message.endsWith("_REQUIRED")) {
      return {
        code: `source.${error.message.toLowerCase()}`,
        message: "The source type and provided source details do not match.",
        status: 400,
      };
    }
  }

  return {
    code: "source.create_failed",
    message: "Unable to save that profile source yet.",
    status: 400,
  };
}
