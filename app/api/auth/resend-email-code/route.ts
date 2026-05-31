import { NextResponse } from "next/server";

import { readPendingEmailMfa, setEmailMfaPendingCookie } from "@/lib/auth/session-security";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
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
