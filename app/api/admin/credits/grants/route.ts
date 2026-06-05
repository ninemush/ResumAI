import { NextResponse } from "next/server";

import {
  buildCreditsApiError,
  grantCreditsSchema,
  grantCreditsToUser,
} from "@/lib/billing/credits";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "admin-credit-grant"),
    limit: 30,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({ requestId, result: rateLimit });
  }

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

  const parsed = grantCreditsSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "billing.invalid_credit_grant",
          message: "Choose a user and a credit amount between 1 and 500.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const grant = await grantCreditsToUser(parsed.data);

    return NextResponse.json({
      grant,
      ok: true,
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
