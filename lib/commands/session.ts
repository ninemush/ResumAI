import { createClient } from "@/lib/supabase/server";

export type WorkspaceSession = {
  user: {
    id: string;
    email: string | null;
    fullName: string | null;
  };
  admin: {
    isOwner: boolean;
    roles: string[];
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

  if (fullName) {
    await seedProfileNameIfMissing({
      fullName,
      userId: user.id,
    });
  }

  return {
    user: {
      id: user.id,
      email: user.email ?? null,
      fullName,
    },
    admin: {
      isOwner: roles.includes("owner"),
      roles,
    },
  };
}

async function seedProfileNameIfMissing({
  fullName,
  userId,
}: {
  fullName: string;
  userId: string;
}) {
  const supabase = await createClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError || profile?.display_name) {
    return;
  }

  if (profile) {
    await supabase
      .from("profiles")
      .update({ display_name: fullName })
      .eq("id", profile.id)
      .eq("user_id", userId);
    return;
  }

  await supabase.from("profiles").insert({
    user_id: userId,
    display_name: fullName,
  });
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
