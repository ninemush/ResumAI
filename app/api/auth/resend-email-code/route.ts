import { NextResponse } from "next/server";

import { readPendingEmailMfa, setEmailMfaPendingCookie } from "@/lib/auth/session-security";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "auth_email_code_resend"),
    limit: 3,
    windowMs: 5 * 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Email code requests are happening too quickly. Please wait a moment.",
      requestId,
      result: rateLimit,
    });
  }
  const pending = await readPendingEmailMfa();

  if (!pending || pending.exp < Math.floor(Date.now() / 1000)) {
    return NextResponse.json(
      {
        error: {
          code: "auth.code_expired",
          message: "Sign in again to request a fresh code.",
        },
      },
      { status: 401 },
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: pending.email,
    options: {
      shouldCreateUser: false,
    },
  });

  if (error) {
    console.warn(
      JSON.stringify({
        event: "auth.email_code_resend_failed",
        message: error.message,
        requestId,
        status: "status" in error ? error.status : null,
      }),
    );
    const mapped = mapEmailDeliveryError(error.message);

    return NextResponse.json(
      { error: mapped },
      { status: mapped.code === "auth.email_rate_limited" ? 429 : 502 },
    );
  }

  await setEmailMfaPendingCookie({
    email: pending.email,
    userId: pending.userId,
  });

  return NextResponse.json({ ok: true });
}

function mapEmailDeliveryError(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("rate") || normalized.includes("limit") || normalized.includes("too many")) {
    return {
      code: "auth.email_rate_limited",
      message: "Email delivery is temporarily rate-limited. Wait a few minutes before requesting another code.",
    };
  }

  return {
    code: "auth.email_code_failed",
    message: "We could not resend the code.",
  };
}
