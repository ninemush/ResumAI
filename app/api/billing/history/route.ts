import { NextResponse } from "next/server";

import { requireProtectedApiSession } from "@/lib/api/auth";
import { buildCreditsApiError, getCreditHistory } from "@/lib/billing/credits";

export async function GET() {
  const requestId = crypto.randomUUID();

  try {
    await requireProtectedApiSession();
    const history = await getCreditHistory();

    return NextResponse.json({
      ok: true,
      requestId,
      history,
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
