import { NextResponse } from "next/server";

import { clearEmailMfaCookies } from "@/lib/auth/session-security";
import { checkRateLimit, getClientRateLimitKey, rateLimitResponse } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "auth_sign_out"),
    limit: 30,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Sign-out requests are happening too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  const supabase = await createClient();

  await supabase.auth.signOut();
  await clearEmailMfaCookies();

  return NextResponse.json({ ok: true, requestId });
}
