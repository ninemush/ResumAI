import { NextResponse } from "next/server";
import { z } from "zod";

import { readPendingEmailMfa, setEmailMfaVerifiedCookie } from "@/lib/auth/session-security";
import { createClient } from "@/lib/supabase/server";

const verifySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(request: Request) {
  const parsed = verifySchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "auth.invalid_code", message: "Enter the 6-digit code from your email." } },
      { status: 400 },
    );
  }

  const pending = await readPendingEmailMfa();

  if (!pending || pending.exp < Math.floor(Date.now() / 1000)) {
    return NextResponse.json(
      {
        error: {
          code: "auth.code_expired",
          message: "That code session expired. Sign in again to request a fresh code.",
        },
      },
      { status: 401 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    email: pending.email,
    token: parsed.data.code,
    type: "email",
  });

  if (error || !data.user || data.user.id !== pending.userId) {
    return NextResponse.json(
      { error: { code: "auth.invalid_code", message: "That code did not match. Try again." } },
      { status: 401 },
    );
  }

  await setEmailMfaVerifiedCookie({
    email: pending.email,
    userId: pending.userId,
  });

  return NextResponse.json({ ok: true });
}
