import { createClient } from "@/lib/supabase/server";

export type WorkspaceSession = {
  user: {
    authProvider: string | null;
    id: string;
    email: string | null;
    fullName: string | null;
  };
  admin: {
    isOwner: boolean;
    roles: string[];
  };
  legal: {
    requiresTermsAcceptance: boolean;
    termsAcceptedAt: string | null;
    termsVersion: string | null;
  };
};

export async function getWorkspaceSession(): Promise<WorkspaceSession | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: adminRoles } = await supabase
    .from("admin_roles")
    .select("role")
    .eq("user_id", user.id);

  const roles = adminRoles?.map(({ role }) => role) ?? [];
  const fullName = readFullName(user.user_metadata);
  const terms = readTermsAcceptance(user.user_metadata);
  const profileLegal = await seedProfileIdentityIfMissing({
    fullName,
    terms,
    userId: user.id,
  });

  return {
    user: {
      authProvider: readAuthProvider(user.app_metadata),
      id: user.id,
      email: user.email ?? null,
      fullName,
    },
    admin: {
      isOwner: roles.includes("owner"),
      roles,
    },
    legal: {
      requiresTermsAcceptance: !profileLegal.termsAcceptedAt,
      termsAcceptedAt: profileLegal.termsAcceptedAt,
      termsVersion: profileLegal.termsVersion,
    },
  };
}

async function seedProfileIdentityIfMissing({
  fullName,
  terms,
  userId,
}: {
  fullName: string | null;
  terms: { acceptedAt: string | null; version: string | null };
  userId: string;
}) {
  const supabase = await createClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, terms_accepted_at, terms_version")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError) {
    return {
      termsAcceptedAt: null,
      termsVersion: null,
    };
  }

  if (profile) {
    const patch = {
      display_name: !profile.display_name && fullName ? fullName : undefined,
      terms_accepted_at: !profile.terms_accepted_at ? terms.acceptedAt : undefined,
      terms_version: !profile.terms_version ? terms.version : undefined,
    };
    const compactPatch = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );

    if (Object.keys(compactPatch).length > 0) {
      await supabase
        .from("profiles")
        .update(compactPatch)
        .eq("id", profile.id)
        .eq("user_id", userId);
    }

    return {
      termsAcceptedAt: profile.terms_accepted_at ?? terms.acceptedAt,
      termsVersion: profile.terms_version ?? terms.version,
    };
  }

  const { data: insertedProfile } = await supabase
    .from("profiles")
    .insert({
      user_id: userId,
      display_name: fullName,
      terms_accepted_at: terms.acceptedAt,
      terms_version: terms.version,
    })
    .select("terms_accepted_at, terms_version")
    .maybeSingle();

  return {
    termsAcceptedAt: insertedProfile?.terms_accepted_at ?? terms.acceptedAt,
    termsVersion: insertedProfile?.terms_version ?? terms.version,
  };
}

function readFullName(metadata: Record<string, unknown> | null | undefined) {
  const candidates = [
    metadata?.full_name,
    metadata?.name,
    metadata?.user_name,
    metadata?.preferred_username,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const normalized = candidate.trim().replace(/\s+/g, " ");

    if (normalized.length >= 2 && !normalized.includes("@")) {
      return normalized.slice(0, 120);
    }
  }

  return null;
}

function readTermsAcceptance(metadata: Record<string, unknown> | null | undefined) {
  const acceptedAt =
    typeof metadata?.terms_accepted_at === "string" ? metadata.terms_accepted_at : null;
  const version = typeof metadata?.terms_version === "string" ? metadata.terms_version : null;

  return {
    acceptedAt: acceptedAt && !Number.isNaN(Date.parse(acceptedAt)) ? acceptedAt : null,
    version,
  };
}

function readAuthProvider(metadata: Record<string, unknown> | null | undefined) {
  const provider = metadata?.provider;

  return typeof provider === "string" ? provider : null;
}
