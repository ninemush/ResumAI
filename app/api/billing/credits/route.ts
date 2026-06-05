import { NextResponse } from "next/server";

import { buildCreditsApiError, getCreditSummary } from "@/lib/billing/credits";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const requestId = crypto.randomUUID();

  try {
    await requireSignedInUser();
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

async function requireSignedInUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }
}
