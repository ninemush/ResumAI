import { NextResponse } from "next/server";
import { z } from "zod";

import { buildCreditsApiError, redeemPromoCode } from "@/lib/billing/credits";

const redeemPromoSchema = z.object({
  code: z.string().trim().min(1).max(80),
});

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

  const parsed = redeemPromoSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "billing.promo_required",
          message: "Enter a promo code.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const summary = await redeemPromoCode(parsed.data.code);

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
