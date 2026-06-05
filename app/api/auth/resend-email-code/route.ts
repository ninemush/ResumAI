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
    limit: 5,
    windowMs: 60_000,
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
    return NextResponse.json(
      { error: { code: "auth.email_code_failed", message: "We could not resend the code." } },
      { status: 502 },
    );
  }

  await setEmailMfaPendingCookie({
    email: pending.email,
    userId: pending.userId,
  });

  return NextResponse.json({ ok: true });
}
