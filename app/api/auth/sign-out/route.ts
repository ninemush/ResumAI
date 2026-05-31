import { NextResponse } from "next/server";

import { clearEmailMfaCookies } from "@/lib/auth/session-security";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();

  await supabase.auth.signOut();
  await clearEmailMfaCookies();

  return NextResponse.json({ ok: true });
}
