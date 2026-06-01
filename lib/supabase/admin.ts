import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getPublicEnv } from "@/lib/env";

export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY_REQUIRED");
  }

  const env = getPublicEnv();

  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
