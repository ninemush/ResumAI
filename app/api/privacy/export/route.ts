import { NextResponse } from "next/server";

import { createUserDataExport } from "@/lib/privacy/data-export";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const rateLimit = checkRateLimit({
    key: getClientRateLimitKey(request, "privacy_export"),
    limit: 4,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Data exports are being requested too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    const exportResult = await createUserDataExport();

    return NextResponse.json({
      ok: true,
      export: exportResult.exportJson,
      privacyRequestId: exportResult.requestId,
      requestId,
      storagePath: exportResult.storagePath,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: { category: "auth", code: "auth.required", message: "Sign in is required." },
        },
        { status: 401 },
      );
    }

    console.warn(
      JSON.stringify({
        code: error instanceof Error ? error.message : "UNKNOWN_PRIVACY_EXPORT_ERROR",
        event: "privacy_export_route_failed",
        requestId,
      }),
    );

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "server",
          code: "privacy.export_failed",
          message: "Your data export could not be generated right now.",
        },
      },
      { status: 500 },
    );
  }
}
