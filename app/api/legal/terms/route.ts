import { NextResponse } from "next/server";

import { acceptTerms, acceptTermsSchema } from "@/lib/legal/terms-commands";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "legal_terms_accept"),
    limit: 20,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Terms acceptance requests are being submitted too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
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

  const parsed = acceptTermsSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "terms.invalid_input",
          message: "Use a valid Terms and Conditions acceptance record.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const legal = await acceptTerms(parsed.data);

    return NextResponse.json({
      ok: true,
      requestId,
      legal,
    });
  } catch (error) {
    const { category, code, message, status } = toApiError(error);

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: { category, code, message },
      },
      { status },
    );
  }
}

function toApiError(error: unknown) {
  if (error instanceof Error && error.message === "AUTH_REQUIRED") {
    return {
      category: "auth",
      code: "auth.required",
      message: "Please sign in before accepting the Terms and Conditions.",
      status: 401,
    };
  }

  return {
    category: "server",
    code: "terms.acceptance_failed",
    message: "Unable to save your Terms and Conditions acceptance right now.",
    status: 500,
  };
}
