import { createClient } from "@/lib/supabase/server";
import { PRIVACY_POLICY_VERSION } from "@/lib/legal/terms";

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
    privacyPolicyAcceptedAt: string | null;
    privacyPolicyVersion: string | null;
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
      privacyPolicyAcceptedAt: profileLegal.privacyPolicyAcceptedAt,
      privacyPolicyVersion: profileLegal.privacyPolicyVersion,
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
  terms: { acceptedAt: string | null; privacyPolicyVersion: string | null; version: string | null };
  userId: string;
}) {
  const supabase = await createClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, terms_accepted_at, terms_version, privacy_policy_accepted_at, privacy_policy_version")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError) {
    return {
      termsAcceptedAt: null,
      termsVersion: null,
      privacyPolicyAcceptedAt: null,
      privacyPolicyVersion: null,
    };
  }

  if (profile) {
    const patch = {
      display_name: !profile.display_name && fullName ? fullName : undefined,
      terms_accepted_at: !profile.terms_accepted_at ? terms.acceptedAt : undefined,
      terms_version: !profile.terms_version ? terms.version : undefined,
      privacy_policy_accepted_at: !profile.privacy_policy_accepted_at ? terms.acceptedAt : undefined,
      privacy_policy_version: !profile.privacy_policy_version ? terms.privacyPolicyVersion : undefined,
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
      privacyPolicyAcceptedAt: profile.privacy_policy_accepted_at ?? terms.acceptedAt,
      privacyPolicyVersion: profile.privacy_policy_version ?? terms.privacyPolicyVersion,
    };
  }

  const { data: insertedProfile } = await supabase
    .from("profiles")
    .insert({
      user_id: userId,
      display_name: fullName,
      privacy_policy_accepted_at: terms.acceptedAt,
      privacy_policy_version: terms.privacyPolicyVersion,
      terms_accepted_at: terms.acceptedAt,
      terms_version: terms.version,
    })
    .select("terms_accepted_at, terms_version, privacy_policy_accepted_at, privacy_policy_version")
    .maybeSingle();

  return {
    termsAcceptedAt: insertedProfile?.terms_accepted_at ?? terms.acceptedAt,
    termsVersion: insertedProfile?.terms_version ?? terms.version,
    privacyPolicyAcceptedAt: insertedProfile?.privacy_policy_accepted_at ?? terms.acceptedAt,
    privacyPolicyVersion: insertedProfile?.privacy_policy_version ?? terms.privacyPolicyVersion,
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
  const privacyPolicyVersion =
    typeof metadata?.privacy_policy_version === "string"
      ? metadata.privacy_policy_version
      : PRIVACY_POLICY_VERSION;

  return {
    acceptedAt: acceptedAt && !Number.isNaN(Date.parse(acceptedAt)) ? acceptedAt : null,
    privacyPolicyVersion,
    version,
  };
}

function readAuthProvider(metadata: Record<string, unknown> | null | undefined) {
  const provider = metadata?.provider;

  return typeof provider === "string" ? provider : null;
}
