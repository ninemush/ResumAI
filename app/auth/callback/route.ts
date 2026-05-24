import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await ensureProfileFromAuthMetadata({
        email: user.email ?? null,
        fullName: readAuthFullName(user.user_metadata),
        supabase,
        userId: user.id,
      });
    }
  }

  return NextResponse.redirect(new URL("/", requestUrl.origin));
}

async function ensureProfileFromAuthMetadata({
  email,
  fullName,
  supabase,
  userId,
}: {
  email: string | null;
  fullName: string | null;
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}) {
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id, display_name")
    .eq("user_id", userId)
    .maybeSingle();

  if (!existingProfile) {
    await supabase.from("profiles").insert({
      user_id: userId,
      display_name: fullName ?? email,
    });
    return;
  }

  if (!existingProfile.display_name && (fullName || email)) {
    await supabase
      .from("profiles")
      .update({ display_name: fullName ?? email })
      .eq("id", existingProfile.id)
      .eq("user_id", userId);
  }
}

function readAuthFullName(metadata: Record<string, unknown>) {
  const candidates = [metadata.full_name, metadata.name, metadata.display_name];
  const name = candidates.find((value) => typeof value === "string" && value.trim().length > 0);

  return typeof name === "string" ? name.trim() : null;
}
