import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { hasLaunchReadinessEnv, loadLocalEnv } from "./helpers/demo-auth";
import {
  cleanRowsByIds,
  createServiceRoleClient,
  insertRow,
  readUserIdByEmail,
} from "./helpers/launch-fixtures";

test.describe("operation fingerprint RPC guards", () => {
  test.skip(
    !hasLaunchReadinessEnv(),
    "Launch readiness env, service role, and QA user credentials are required for fingerprint RPC evidence.",
  );

  test("credit reservations require fingerprints for new work and reject same-key changed input", async () => {
    loadLocalEnv();

    const admin = createServiceRoleClient();
    const userClient = await createAuthenticatedUserClient();
    const marker = `qa-credit-fingerprint-${crypto.randomUUID()}`;
    const fingerprintA = "a".repeat(64);
    const fingerprintB = "b".repeat(64);
    const reservationIds: string[] = [];

    try {
      const first = await userClient.rpc("reserve_credits", {
        p_amount: 1,
        p_expires_in_seconds: 600,
        p_feature: "qa_fingerprint",
        p_idempotency_key: `${marker}:new`,
        p_metadata: { marker },
        p_operation_fingerprint: fingerprintA,
        p_resource_id: null,
        p_resource_type: "qa_rpc",
      });
      expect(first.error).toBeNull();
      reservationIds.push(String(first.data.reservationId));

      const sameInput = await userClient.rpc("reserve_credits", {
        p_amount: 1,
        p_expires_in_seconds: 600,
        p_feature: "qa_fingerprint",
        p_idempotency_key: `${marker}:new`,
        p_metadata: { marker },
        p_operation_fingerprint: fingerprintA,
        p_resource_id: null,
        p_resource_type: "qa_rpc",
      });
      expect(sameInput.error).toBeNull();
      expect(sameInput.data.reservationId).toBe(first.data.reservationId);

      const changedInput = await userClient.rpc("reserve_credits", {
        p_amount: 1,
        p_expires_in_seconds: 600,
        p_feature: "qa_fingerprint",
        p_idempotency_key: `${marker}:new`,
        p_metadata: { marker },
        p_operation_fingerprint: fingerprintB,
        p_resource_id: null,
        p_resource_type: "qa_rpc",
      });
      expect(changedInput.error?.message).toContain("CREDIT_IDEMPOTENCY_MISMATCH");

      const missingFingerprint = await userClient.rpc("reserve_credits", {
        p_amount: 1,
        p_expires_in_seconds: 600,
        p_feature: "qa_fingerprint",
        p_idempotency_key: `${marker}:missing`,
        p_metadata: { marker },
        p_operation_fingerprint: null,
        p_resource_id: null,
        p_resource_type: "qa_rpc",
      });
      expect(missingFingerprint.error?.message).toContain("CREDIT_OPERATION_FINGERPRINT_REQUIRED");

    } finally {
      await cleanRowsByIds(admin, "credit_reservations", reservationIds);
    }
  });

  test("quota reservations require fingerprints for new work and reject same-key changed intent", async () => {
    loadLocalEnv();

    const admin = createServiceRoleClient();
    const userClient = await createAuthenticatedUserClient();
    const userId = await readUserIdByEmail(process.env.QA_DEMO_USER_A_EMAIL ?? "");
    const marker = `qa-quota-fingerprint-${crypto.randomUUID()}`;
    const resourceId = crypto.randomUUID();
    const fingerprintA = "c".repeat(64);
    const fingerprintB = "d".repeat(64);
    const cleanup = {
      quotaReservations: [] as string[],
      tiers: [] as string[],
      userTiers: [] as string[],
    };

    try {
      const tierId = await insertRow(admin, "tiers", {
        application_limit: 20,
        description: "QA operation fingerprint RPC coverage",
        generation_limit: 20,
        is_active: true,
        key: marker,
        name: "QA fingerprint guard",
        period_days: 30,
      });
      cleanup.tiers.push(tierId);

      cleanup.userTiers.push(
        await insertRow(admin, "user_tiers", {
          status: "active",
          tier_id: tierId,
          user_id: userId,
        }),
      );

      const first = await userClient.rpc("reserve_quota_event", {
        p_amount: 1,
        p_event_type: "generation_created",
        p_metadata: { marker },
        p_operation_fingerprint: fingerprintA,
        p_operation_key: `${marker}:new`,
        p_resource_id: resourceId,
        p_resource_type: "qa_rpc",
      });
      expect(first.error).toBeNull();
      cleanup.quotaReservations.push(String(first.data.reservationId));

      const sameInput = await userClient.rpc("reserve_quota_event", {
        p_amount: 1,
        p_event_type: "generation_created",
        p_metadata: { marker },
        p_operation_fingerprint: fingerprintA,
        p_operation_key: `${marker}:new`,
        p_resource_id: resourceId,
        p_resource_type: "qa_rpc",
      });
      expect(sameInput.error).toBeNull();
      expect(sameInput.data.reservationId).toBe(first.data.reservationId);

      const changedInput = await userClient.rpc("reserve_quota_event", {
        p_amount: 1,
        p_event_type: "generation_created",
        p_metadata: { marker },
        p_operation_fingerprint: fingerprintB,
        p_operation_key: `${marker}:new`,
        p_resource_id: resourceId,
        p_resource_type: "qa_rpc",
      });
      expect(changedInput.error?.message).toContain("QUOTA_IDEMPOTENCY_MISMATCH");

      const missingFingerprint = await userClient.rpc("reserve_quota_event", {
        p_amount: 1,
        p_event_type: "generation_created",
        p_metadata: { marker },
        p_operation_fingerprint: null,
        p_operation_key: `${marker}:missing`,
        p_resource_id: resourceId,
        p_resource_type: "qa_rpc",
      });
      expect(missingFingerprint.error?.message).toContain("QUOTA_OPERATION_FINGERPRINT_REQUIRED");

    } finally {
      await cleanRowsByIds(admin, "quota_reservations", cleanup.quotaReservations);
      await cleanRowsByIds(admin, "user_tiers", cleanup.userTiers);
      await cleanRowsByIds(admin, "tiers", cleanup.tiers);
    }
  });
});

async function createAuthenticatedUserClient() {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const client = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { error } = await client.auth.signInWithPassword({
    email: requireEnv("QA_DEMO_USER_A_EMAIL"),
    password: requireEnv("QA_DEMO_USER_A_PASSWORD"),
  });

  if (error) {
    throw new Error(`Unable to authenticate QA user for RPC guard tests: ${error.message}`);
  }

  return client;
}

function requireEnv(key: string) {
  const value = process.env[key];

  if (!value) {
    throw new Error(`Missing ${key}`);
  }

  return value;
}
