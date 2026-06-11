import { NextResponse } from "next/server";
import { z } from "zod";

import { PRIVACY_POLICY_VERSION, TERMS_VERSION } from "@/lib/legal/terms";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

const signUpSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  fullName: z.string().trim().min(1).max(160),
  password: z.string().min(8).max(256),
  privacyPolicyVersion: z.string().trim().max(40).default(PRIVACY_POLICY_VERSION),
  termsAccepted: z.boolean(),
  termsVersion: z.string().trim().max(40).default(TERMS_VERSION),
}).refine((value) => value.termsAccepted, {
  message: "Terms must be accepted.",
  path: ["termsAccepted"],
});

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const parsed = signUpSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "auth.signup_invalid",
          message: "Enter a valid email, password, name, and terms acceptance.",
        },
      },
      { status: 400 },
    );
  }

  const [ipLimit, emailLimit] = await Promise.all([
    checkRateLimit({
      key: getClientRateLimitKey(request, "auth_signup_ip"),
      limit: 12,
      windowMs: 15 * 60_000,
    }),
    checkRateLimit({
      key: getClientRateLimitKey(request, "auth_signup_email", parsed.data.email),
      limit: 3,
      windowMs: 15 * 60_000,
    }),
  ]);

  if (!ipLimit.allowed || !emailLimit.allowed) {
    return rateLimitResponse({
      message: "Account creation is temporarily rate-limited. Please wait a few minutes before trying again.",
      requestId,
      result: !emailLimit.allowed ? emailLimit : ipLimit,
    });
  }

  const supabase = await createClient();
  const acceptedAt = new Date().toISOString();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        full_name: parsed.data.fullName,
        name: parsed.data.fullName,
        privacy_policy_version: parsed.data.privacyPolicyVersion,
        terms_accepted_at: acceptedAt,
        terms_version: parsed.data.termsVersion,
      },
    },
  });

  if (error) {
    console.warn(
      JSON.stringify({
        event: "auth.signup_failed",
        message: error.message,
        requestId,
        status: "status" in error ? error.status : null,
      }),
    );
    const mapped = mapSignupError(error.message);

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: mapped,
      },
      { status: mapped.code === "auth.email_rate_limited" ? 429 : 400 },
    );
  }

  if (data.user && data.session) {
    const { error: profileError } = await supabase
      .from("profiles")
      .upsert(
        {
          display_name: parsed.data.fullName,
          privacy_policy_accepted_at: acceptedAt,
          privacy_policy_version: parsed.data.privacyPolicyVersion,
          terms_accepted_at: acceptedAt,
          terms_version: parsed.data.termsVersion,
          user_id: data.user.id,
        },
        { onConflict: "user_id" },
      );

    if (profileError) {
      console.warn(
        JSON.stringify({
          event: "auth.signup_profile_seed_failed",
          message: profileError.message,
          requestId,
        }),
      );
    }

    return NextResponse.json({
      ok: true,
      requestId,
      signedIn: true,
    });
  }

  return NextResponse.json({
    ok: true,
    needsEmailConfirmation: true,
    requestId,
  });
}

function mapSignupError(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("rate") || normalized.includes("too many") || normalized.includes("limit")) {
    return {
      category: "rate_limit",
      code: "auth.email_rate_limited",
      message: "Email sign-up is temporarily rate-limited. Wait a few minutes before trying again.",
    };
  }

  if (normalized.includes("already") || normalized.includes("registered") || normalized.includes("exists")) {
    return {
      category: "auth",
      code: "auth.account_may_exist",
      message: "An account may already exist for that email. Try signing in or use password reset.",
    };
  }

  if (normalized.includes("password")) {
    return {
      category: "validation",
      code: "auth.weak_password",
      message: "Use a stronger password with at least 8 characters.",
    };
  }

  return {
    category: "server",
    code: "auth.signup_failed",
    message: "Account creation could not be completed. Please try again.",
  };
}
