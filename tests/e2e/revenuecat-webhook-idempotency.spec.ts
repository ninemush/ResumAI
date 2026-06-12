import { expect, test } from "@playwright/test";

import { hasLaunchReadinessEnv, loadLocalEnv } from "./helpers/demo-auth";
import {
  cleanRowsByIds,
  createServiceRoleClient,
  readUserIdByEmail,
} from "./helpers/launch-fixtures";

test.describe("RevenueCat webhook maturity", () => {
  test.skip(
    !hasLaunchReadinessEnv(),
    "Launch readiness env, service role, admin, and two-user QA credentials are required for webhook idempotency evidence.",
  );

  test("grants mapped credits exactly once for duplicate provider delivery", async ({ request }) => {
    loadLocalEnv();

    const admin = createServiceRoleClient();
    const userId = await readUserIdByEmail(process.env.QA_DEMO_USER_A_EMAIL ?? "");
    const eventId = `launch-maturity-${crypto.randomUUID()}`;
    const authorization = process.env.REVENUECAT_WEBHOOK_SECRET
      ? { authorization: `Bearer ${process.env.REVENUECAT_WEBHOOK_SECRET}` }
      : {};

    try {
      const payload = {
        event: {
          app_user_id: userId,
          id: eventId,
          product_id: "pramania_credits_25",
          type: "PURCHASE_REDEEMED",
        },
      };
      const responses = await Promise.all([
        request.post("/api/revenuecat/webhook", {
          data: payload,
          headers: authorization,
        }),
        request.post("/api/revenuecat/webhook", {
          data: payload,
          headers: authorization,
        }),
      ]);
      const responsePayloads = await Promise.all(responses.map((response) => response.json()));

      expect(responses.every((response) => response.ok())).toBe(true);
      expect(responsePayloads.filter((payload) => payload.creditsGranted === 25)).toHaveLength(1);
      expect(responsePayloads.filter((payload) => payload.duplicate === true)).toHaveLength(1);

      const { data: events, error: eventError } = await admin
        .from("revenuecat_events")
        .select("id, credit_ledger_id")
        .eq("event_id", eventId);

      expect(eventError).toBeNull();
      expect(events).toHaveLength(1);

      const ledgerId = events?.[0]?.credit_ledger_id as string | null;
      expect(ledgerId).toMatch(/[0-9a-f-]{36}/i);

      const { data: ledgerRows, error: ledgerError } = await admin
        .from("credit_ledger")
        .select("id, credit_delta, event_type, metadata")
        .eq("id", ledgerId);

      expect(ledgerError).toBeNull();
      expect(ledgerRows).toHaveLength(1);
      expect(ledgerRows?.[0]?.credit_delta).toBe(25);
      expect(ledgerRows?.[0]?.event_type).toBe("revenuecat_purchase");
      expect((ledgerRows?.[0]?.metadata as { event_id?: string } | null)?.event_id).toBe(eventId);
    } finally {
      const { data: events } = await admin
        .from("revenuecat_events")
        .select("id, credit_ledger_id")
        .eq("event_id", eventId);
      const eventIds = (events ?? []).map((event) => event.id as string);
      const ledgerIds = (events ?? [])
        .map((event) => event.credit_ledger_id as string | null)
        .filter((id): id is string => Boolean(id));

      await cleanRowsByIds(admin, "revenuecat_events", eventIds);
      await cleanRowsByIds(admin, "credit_ledger", ledgerIds);
    }
  });
});
