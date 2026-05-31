import { NextResponse } from "next/server";

import { TERMS_VERSION } from "@/lib/legal/terms";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextPath = readSafeNextPath(requestUrl);

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
        terms: readTermsAcceptance(requestUrl, user.user_metadata),
        userId: user.id,
      });
    }
  }

  return NextResponse.redirect(new URL(nextPath, requestUrl.origin));
}

async function ensureProfileFromAuthMetadata({
  email,
  fullName,
  supabase,
  terms,
  userId,
}: {
  email: string | null;
  fullName: string | null;
  supabase: Awaited<ReturnType<typeof createClient>>;
  terms: { acceptedAt: string | null; version: string | null };
  userId: string;
}) {
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id, display_name, terms_accepted_at, terms_version")
    .eq("user_id", userId)
    .maybeSingle();

  if (!existingProfile) {
    await supabase.from("profiles").insert({
      user_id: userId,
      display_name: fullName ?? email,
      terms_accepted_at: terms.acceptedAt,
      terms_version: terms.version,
    });
    return;
  }

  const patch = {
    display_name: !existingProfile.display_name && (fullName || email) ? fullName ?? email : undefined,
    terms_accepted_at: !existingProfile.terms_accepted_at ? terms.acceptedAt : undefined,
    terms_version: !existingProfile.terms_version ? terms.version : undefined,
  };
  const compactPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );

  if (Object.keys(compactPatch).length > 0) {
    await supabase.from("profiles").update(compactPatch).eq("id", existingProfile.id).eq("user_id", userId);
  }
}

function readAuthFullName(metadata: Record<string, unknown>) {
  const candidates = [metadata.full_name, metadata.name, metadata.display_name];
  const name = candidates.find((value) => typeof value === "string" && value.trim().length > 0);

  return typeof name === "string" ? name.trim() : null;
}

function readTermsAcceptance(requestUrl: URL, metadata: Record<string, unknown>) {
  const queryAccepted = requestUrl.searchParams.get("terms") === "accepted";
  const queryAcceptedAt = requestUrl.searchParams.get("termsAcceptedAt");
  const queryVersion = requestUrl.searchParams.get("termsVersion");
  const metadataAcceptedAt =
    typeof metadata.terms_accepted_at === "string" ? metadata.terms_accepted_at : null;
  const metadataVersion = typeof metadata.terms_version === "string" ? metadata.terms_version : null;

  if (queryAccepted) {
    return {
      acceptedAt: isValidIsoDate(queryAcceptedAt) ? queryAcceptedAt : new Date().toISOString(),
      version: queryVersion || TERMS_VERSION,
    };
  }

  return {
    acceptedAt: isValidIsoDate(metadataAcceptedAt) ? metadataAcceptedAt : null,
    version: metadataVersion,
  };
}

function isValidIsoDate(value: string | null) {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}

function readSafeNextPath(requestUrl: URL) {
  const next = requestUrl.searchParams.get("next");

  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/";
  }

  return next;
}
