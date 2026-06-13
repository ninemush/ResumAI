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
    const authorization: Record<string, string> | undefined = process.env.REVENUECAT_WEBHOOK_SECRET
      ? { authorization: `Bearer ${process.env.REVENUECAT_WEBHOOK_SECRET}` }
      : undefined;

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

      const eventRows = (events ?? []) as Array<{ credit_ledger_id: string | null; id: string }>;
      const ledgerId = eventRows[0]?.credit_ledger_id ?? null;
      expect(ledgerId).toMatch(/[0-9a-f-]{36}/i);

      const { data: ledgerRows, error: ledgerError } = await admin
        .from("credit_ledger")
        .select("id, credit_delta, event_type, metadata")
        .eq("id", ledgerId as string);

      expect(ledgerError).toBeNull();
      const ledgerRowList = (ledgerRows ?? []) as Array<{
        credit_delta: number;
        event_type: string;
        id: string;
        metadata: { event_id?: string } | null;
      }>;
      expect(ledgerRowList).toHaveLength(1);
      expect(ledgerRowList[0]?.credit_delta).toBe(25);
      expect(ledgerRowList[0]?.event_type).toBe("revenuecat_purchase");
      expect(ledgerRowList[0]?.metadata?.event_id).toBe(eventId);
    } finally {
      const { data: events } = await admin
        .from("revenuecat_events")
        .select("id, credit_ledger_id")
        .eq("event_id", eventId);
      const eventRows = (events ?? []) as Array<{ credit_ledger_id: string | null; id: string }>;
      const eventIds = eventRows.map((event) => event.id);
      const ledgerIds = eventRows
        .map((event) => event.credit_ledger_id)
        .filter((id): id is string => Boolean(id));

      await cleanRowsByIds(admin, "revenuecat_events", eventIds);
      await cleanRowsByIds(admin, "credit_ledger", ledgerIds);
    }
  });

  test("persists unknown products as ignored without granting credits", async ({ request }) => {
    loadLocalEnv();

    const admin = createServiceRoleClient();
    const userId = await readUserIdByEmail(process.env.QA_DEMO_USER_A_EMAIL ?? "");
    const eventId = `launch-unknown-product-${crypto.randomUUID()}`;
    const authorization: Record<string, string> | undefined = process.env.REVENUECAT_WEBHOOK_SECRET
      ? { authorization: `Bearer ${process.env.REVENUECAT_WEBHOOK_SECRET}` }
      : undefined;

    try {
      const response = await request.post("/api/revenuecat/webhook", {
        data: {
          event: {
            app_user_id: userId,
            id: eventId,
            product_id: "unknown_credit_pack",
            type: "PURCHASE_REDEEMED",
          },
        },
        headers: authorization,
      });
      const payload = await response.json();

      expect(response.ok()).toBe(true);
      expect(payload).toMatchObject({
        ignored: true,
        reason: "ignored_unknown_product",
      });
      expect(payload.creditsGranted).toBeUndefined();

      const { data: events, error: eventError } = await admin
        .from("revenuecat_events")
        .select("id, credit_amount, credit_ledger_id, processed_status")
        .eq("event_id", eventId);
      const eventRows = (events ?? []) as Array<{
        credit_amount: number;
        credit_ledger_id: string | null;
        id: string;
        processed_status: string;
      }>;

      expect(eventError).toBeNull();
      expect(eventRows).toHaveLength(1);
      expect(eventRows[0]?.credit_amount).toBe(0);
      expect(eventRows[0]?.credit_ledger_id).toBeNull();
      expect(eventRows[0]?.processed_status).toBe("ignored_unknown_product");
    } finally {
      const { data: events } = await admin
        .from("revenuecat_events")
        .select("id")
        .eq("event_id", eventId);
      const eventRows = (events ?? []) as Array<{ id: string }>;

      await cleanRowsByIds(admin, "revenuecat_events", eventRows.map((event) => event.id));
    }
  });

  test("records refund and reversal metadata without granting credits", async ({ request }) => {
    loadLocalEnv();

    const admin = createServiceRoleClient();
    const userId = await readUserIdByEmail(process.env.QA_DEMO_USER_A_EMAIL ?? "");
    const eventId = `launch-refund-${crypto.randomUUID()}`;
    const authorization: Record<string, string> | undefined = process.env.REVENUECAT_WEBHOOK_SECRET
      ? { authorization: `Bearer ${process.env.REVENUECAT_WEBHOOK_SECRET}` }
      : undefined;

    try {
      const response = await request.post("/api/revenuecat/webhook", {
        data: {
          event: {
            app_user_id: userId,
            id: eventId,
            product_id: "pramania_credits_25",
            type: "REFUND",
          },
        },
        headers: authorization,
      });
      const payload = await response.json();

      expect(response.ok()).toBe(true);
      expect(payload).toMatchObject({
        ignored: true,
        reason: "recorded_reversal_metadata",
      });
      expect(payload.creditsGranted).toBeUndefined();

      const { data: reversals, error: reversalError } = await admin
        .from("credit_reversals")
        .select("id, provider_reference, reason, metadata")
        .eq("provider_reference", eventId)
        .returns<Array<{ id: string; metadata: Record<string, unknown>; provider_reference: string; reason: string }>>();

      expect(reversalError).toBeNull();
      expect(reversals).toHaveLength(1);
      expect(reversals?.[0]?.reason).toBe("REFUND");
      expect((reversals?.[0]?.metadata as { product_id?: string } | null)?.product_id).toBe(
        "pramania_credits_25",
      );
    } finally {
      const { data: reversals } = await admin
        .from("credit_reversals")
        .select("id")
        .eq("provider_reference", eventId);
      const reversalRows = (reversals ?? []) as Array<{ id: string }>;

      await cleanRowsByIds(admin, "credit_reversals", reversalRows.map((event) => event.id));
    }
  });
});
