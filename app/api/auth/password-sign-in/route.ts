import { NextResponse } from "next/server";
import { z } from "zod";

import {
  setEmailMfaPendingCookie,
  setEmailMfaVerifiedCookie,
} from "@/lib/auth/session-security";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const LOCKED_MESSAGE =
  "This account is temporarily locked after three incorrect password attempts. Try again in 15 minutes or reset your password.";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const parsed = signInSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "auth.invalid_request", message: "Enter a valid email and password." } },
      { status: 400 },
    );
  }

  const email = parsed.data.email.trim().toLowerCase();
  const rateLimit = checkRateLimit({
    key: getClientRateLimitKey(request, "password_sign_in", email),
    limit: 8,
    windowMs: 15 * 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Too many sign-in attempts. Please wait before trying again or use password reset.",
      requestId,
      result: rateLimit,
    });
  }

  const supabase = await createClient();
  const { data: allowedState } = await supabase.rpc("check_password_login_allowed", {
    email_input: email,
  });

  if (allowedState && typeof allowedState === "object" && "allowed" in allowedState) {
    const allowed = Boolean(allowedState.allowed);

    if (!allowed) {
      return NextResponse.json(
        { error: { code: "auth.account_locked", message: LOCKED_MESSAGE } },
        { status: 423 },
      );
    }
  }

  const signInResult = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.password,
  });

  if (signInResult.error || !signInResult.data.user) {
    const { data: failedState } = await supabase.rpc("record_password_login_attempt", {
      email_input: email,
      was_successful: false,
    });
    const failedAttempts =
      failedState && typeof failedState === "object" && "failedAttempts" in failedState
        ? Number(failedState.failedAttempts)
        : null;
    const locked =
      failedState && typeof failedState === "object" && "lockedUntil" in failedState
        ? Boolean(failedState.lockedUntil)
        : false;

    return NextResponse.json(
      {
        error: {
          code: locked ? "auth.account_locked" : "auth.invalid_credentials",
          message: locked
            ? LOCKED_MESSAGE
            : failedAttempts
              ? `Email or password is incorrect. ${Math.max(3 - failedAttempts, 0)} attempt(s) remaining before temporary lock.`
              : "Email or password is incorrect.",
        },
      },
      { status: locked ? 423 : 401 },
    );
  }

  await supabase.rpc("record_password_login_attempt", {
    email_input: email,
    was_successful: true,
  });

  const userId = signInResult.data.user.id;

  if (process.env.AUTH_REQUIRE_EMAIL_CODE === "false") {
    await setEmailMfaVerifiedCookie({ email, userId });

    return NextResponse.json({ ok: true, requiresEmailCode: false });
  }

  const { error: otpError } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
    },
  });

  if (otpError) {
    await supabase.auth.signOut();

    return NextResponse.json(
      {
        error: {
          code: "auth.email_code_failed",
          message: "We could not send the email code. Please try again.",
        },
      },
      { status: 502 },
    );
  }

  await setEmailMfaPendingCookie({ email, userId });

  return NextResponse.json({
    email,
    ok: true,
    requiresEmailCode: true,
  });
}
