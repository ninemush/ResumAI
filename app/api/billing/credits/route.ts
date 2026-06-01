import { NextResponse } from "next/server";

import { buildCreditsApiError, getCreditSummary } from "@/lib/billing/credits";

export async function GET() {
  const requestId = crypto.randomUUID();

  try {
    const summary = await getCreditSummary();

    return NextResponse.json({
      ok: true,
      requestId,
      summary,
    });
  } catch (error) {
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
}
