import { createClient } from "@supabase/supabase-js";

import { loadLocalEnv } from "./demo-auth";

type ServiceRoleClient = ReturnType<typeof createClient>;
type DynamicInsertTable = {
  insert: (row: Record<string, unknown>) => {
    select: (columns: string) => {
      single: () => Promise<{
        data: { id?: string } | null;
        error: { message: string } | null;
      }>;
    };
  };
};

export function hasServiceRoleFixtureEnv() {
  loadLocalEnv();

  return Boolean(
    process.env.RUN_LAUNCH_READINESS_GATES === "1" &&
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function createServiceRoleClient(): ServiceRoleClient {
  loadLocalEnv();

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function readUserIdByEmail(email: string) {
  const admin = createServiceRoleClient();
  const { data, error } = await admin.auth.admin.listUsers();

  if (error) {
    throw new Error(`Unable to list QA users: ${error.message}`);
  }

  const user = data.users.find(
    (item) => item.email?.trim().toLowerCase() === email.trim().toLowerCase(),
  );

  if (!user) {
    throw new Error(`QA user not found for ${email}`);
  }

  return user.id;
}

export async function cleanRowsByIds(
  admin: ServiceRoleClient,
  table: string,
  ids: string[],
) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));

  if (uniqueIds.length === 0) return;

  const { error } = await admin.from(table).delete().in("id", uniqueIds);

  if (error) {
    throw new Error(`Unable to clean ${table}: ${error.message}`);
  }
}

export async function insertRow<T extends Record<string, unknown>>(
  admin: ServiceRoleClient,
  table: string,
  row: T,
) {
  const tableRef = admin.from(table) as unknown as DynamicInsertTable;
  const { data, error } = await tableRef.insert(row).select("id").single();

  if (error || !data) {
    throw new Error(`Unable to seed ${table}: ${error?.message ?? "missing inserted row"}`);
  }

  return data.id as string;
}

function requireEnv(key: string) {
  const value = process.env[key];

  if (!value) {
    throw new Error(`Missing ${key}`);
  }

  return value;
}
