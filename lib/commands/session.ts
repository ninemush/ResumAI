import { createClient } from "@/lib/supabase/server";

export type WorkspaceSession = {
  user: {
    id: string;
    email: string | null;
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

  return {
    user: {
      id: user.id,
      email: user.email ?? null,
    },
    admin: {
      isOwner: roles.includes("owner"),
      roles,
    },
  };
}
