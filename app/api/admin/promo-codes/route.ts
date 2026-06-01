import { NextResponse } from "next/server";

import {
  buildCreditsApiError,
  createPromoCode,
  createPromoCodeSchema,
  listPromoCodes,
} from "@/lib/billing/credits";

export async function GET() {
  const requestId = crypto.randomUUID();

  try {
    const promoCodes = await listPromoCodes();

    return NextResponse.json({
      ok: true,
      promoCodes,
      requestId,
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

  const parsed = createPromoCodeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "billing.invalid_promo",
          message: "Use a valid promo code, credit amount, redemption limit, and optional user email.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const promoCode = await createPromoCode(parsed.data);

    return NextResponse.json({
      ok: true,
      promoCode,
      requestId,
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
