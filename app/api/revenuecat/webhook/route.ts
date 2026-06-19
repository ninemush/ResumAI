import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

const revenueCatEventSchema = z.object({
  event: z.object({
    app_user_id: z.string().nullish(),
    id: z.string().min(1),
    original_transaction_id: z.string().nullish(),
    product_id: z.string().nullish(),
    transaction_id: z.string().nullish(),
    type: z.string().nullish(),
  }),
});

const productCreditMapSchema = z.record(z.string(), z.number().int().positive());
const revenueCatProcessResultSchema = z.object({
  creditsGranted: z.number().int().positive().optional(),
  duplicate: z.boolean(),
  eventId: z.string().uuid().nullable().optional(),
  ledgerId: z.string().uuid().nullable().optional(),
});
const CREDIT_GRANT_EVENT_TYPES = new Set(["NON_RENEWING_PURCHASE"]);
const REVERSAL_EVENT_TYPES = new Set(["CANCELLATION", "REFUND", "REVERSAL", "CHARGEBACK"]);

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const webhookSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
  const authorization = request.headers.get("authorization");

  if (!webhookSecret && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "configuration",
          code: "revenuecat.webhook_secret_required",
          message: "RevenueCat webhook secret is not configured.",
        },
      },
      { status: 503 },
    );
  }

  if (webhookSecret && authorization !== `Bearer ${webhookSecret}`) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "auth",
          code: "revenuecat.unauthorized",
          message: "Webhook authorization failed.",
        },
      },
      { status: 401 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "request.invalid_json",
          message: "Invalid JSON body.",
        },
      },
      { status: 400 },
    );
  }

  const parsed = revenueCatEventSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "revenuecat.invalid_payload",
          message: "RevenueCat webhook payload did not include the expected event details.",
        },
      },
      { status: 400 },
    );
  }

  const eventType = parsed.data.event.type ?? "";
  const productId = parsed.data.event.product_id ?? "";
  const appUserId = parsed.data.event.app_user_id ?? "";
  const transactionId = parsed.data.event.transaction_id ?? "";
  const originalTransactionId = parsed.data.event.original_transaction_id ?? "";

  if (isReversalEventType(eventType)) {
    try {
      await persistIgnoredRevenueCatEvent({
        appUserId,
        body,
        eventId: parsed.data.event.id,
        eventType,
        processedStatus: appUserId && isUuid(appUserId) ? "recorded_reversal" : "ignored_reversal_unlinked",
        productId,
      });
      if (appUserId && isUuid(appUserId)) {
        await persistRevenueCatReversalEvent({
          appUserId,
          body,
          eventId: parsed.data.event.id,
          eventType,
          originalTransactionId,
          productId,
          transactionId,
        });
      }
    } catch {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: {
            category: "server",
            code: "revenuecat.reversal_event_persist_failed",
            message: "RevenueCat reversal event could not be recorded for reconciliation.",
          },
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: appUserId && isUuid(appUserId) ? "recorded_reversal_metadata" : "recorded_unlinked_reversal_event",
      requestId,
    });
  }

  if (!CREDIT_GRANT_EVENT_TYPES.has(eventType)) {
    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: "event_type_not_credit_grant",
      requestId,
    });
  }

  const productMap = readProductCreditMap();
  const creditAmount = productMap[productId] ?? 0;

  if (!productId || !appUserId) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "revenuecat.purchase_missing_required_fields",
          message: "Credit purchase payload did not include a product id and app user id.",
        },
      },
      { status: 400 },
    );
  }

  if (!creditAmount) {
    try {
      await persistIgnoredRevenueCatEvent({
        appUserId,
        body,
        eventId: parsed.data.event.id,
        eventType,
        productId,
        processedStatus: "ignored_unknown_product",
      });
    } catch {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: {
            category: "server",
            code: "revenuecat.ignored_event_persist_failed",
            message: "RevenueCat event could not be recorded for reconciliation.",
          },
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: "ignored_unknown_product",
      requestId,
    });
  }

  if (!isUuid(appUserId)) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "revenuecat.app_user_id_not_supabase_uuid",
          message: "Purchase redemption app user id is not a Supabase user id.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase.rpc("process_revenuecat_credit_event", {
      p_app_user_id: appUserId,
      p_credit_amount: creditAmount,
      p_event_id: parsed.data.event.id,
      p_event_type: eventType,
      p_product_id: productId,
      p_raw_event: body,
      p_user_id: appUserId,
    });

    if (error || !data) {
      throw new Error(error?.message ?? "REVENUECAT_EVENT_PROCESSING_FAILED");
    }

    const result = revenueCatProcessResultSchema.parse(data);

    if (result.duplicate) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        requestId,
      });
    }

    return NextResponse.json({
      ok: true,
      creditsGranted: result.creditsGranted ?? creditAmount,
      requestId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "server",
          code:
            error instanceof Error && error.message === "SUPABASE_SERVICE_ROLE_KEY_REQUIRED"
              ? "revenuecat.service_role_missing"
              : "revenuecat.processing_failed",
          message: "RevenueCat purchase could not be processed.",
        },
      },
      { status: 500 },
    );
  }
}

function readProductCreditMap() {
  const raw =
    process.env.REVENUECAT_CREDIT_PRODUCT_MAP ??
    JSON.stringify({
      pramania_credits_25: 25,
      pramania_credits_75: 75,
    });

  try {
    return productCreditMapSchema.parse(JSON.parse(raw));
  } catch {
    return {
      pramania_credits_25: 25,
      pramania_credits_75: 75,
    };
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isReversalEventType(eventType: string) {
  return REVERSAL_EVENT_TYPES.has(eventType.trim().toUpperCase());
}

async function persistIgnoredRevenueCatEvent({
  appUserId,
  body,
  eventId,
  eventType,
  processedStatus,
  productId,
}: {
  appUserId: string;
  body: unknown;
  eventId: string;
  eventType: string;
  processedStatus: string;
  productId: string;
}) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("revenuecat_events").upsert(
    {
      app_user_id: appUserId,
      credit_amount: 0,
      event_id: eventId,
      product_id: productId,
      processed_status: processedStatus,
      raw_event: {
        eventType,
        payload: body,
      },
      user_id: isUuid(appUserId) ? appUserId : null,
    },
    {
      ignoreDuplicates: true,
      onConflict: "event_id",
    },
  );

  if (error) {
    throw error;
  }
}

async function persistRevenueCatReversalEvent({
  appUserId,
  body,
  eventId,
  eventType,
  originalTransactionId,
  productId,
  transactionId,
}: {
  appUserId: string;
  body: unknown;
  eventId: string;
  eventType: string;
  originalTransactionId: string;
  productId: string;
  transactionId: string;
}) {
  const supabase = createAdminClient();
  const transactionIds = new Set([transactionId, originalTransactionId].filter(Boolean));
  const { data: priorEvents, error: priorEventError } = await supabase
    .from("revenuecat_events")
    .select("credit_ledger_id, raw_event")
    .eq("app_user_id", appUserId)
    .eq("product_id", productId)
    .not("credit_ledger_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(25);

  if (priorEventError) {
    throw priorEventError;
  }

  const matchingPriorEvent =
    transactionIds.size > 0
      ? (priorEvents ?? []).find((event) =>
          revenueCatEventHasTransactionId(event.raw_event, transactionIds),
        )
      : (priorEvents ?? [])[0];

  const { error } = await supabase.from("credit_reversals").upsert(
    {
      metadata: {
        event_id: eventId,
        event_type: eventType,
        matched_by_transaction_id: Boolean(matchingPriorEvent && transactionIds.size > 0),
        original_transaction_id: originalTransactionId || null,
        product_id: productId,
        transaction_id: transactionId || null,
        raw_event: body,
      },
      original_ledger_event_id: matchingPriorEvent?.credit_ledger_id ?? null,
      provider_reference: eventId,
      reason: eventType || "revenuecat_reversal",
      user_id: appUserId,
    },
    {
      ignoreDuplicates: true,
      onConflict: "provider_reference",
    },
  );

  if (error) {
    throw error;
  }
}

function revenueCatEventHasTransactionId(rawEvent: unknown, transactionIds: Set<string>) {
  const eventPayload = readRevenueCatEventPayload(rawEvent);

  if (!eventPayload) {
    return false;
  }

  const candidateTransactionId = readStringField(eventPayload, "transaction_id");
  const candidateOriginalTransactionId = readStringField(eventPayload, "original_transaction_id");

  return [candidateTransactionId, candidateOriginalTransactionId].some(
    (candidate) => candidate && transactionIds.has(candidate),
  );
}

function readRevenueCatEventPayload(rawEvent: unknown) {
  if (!isRecord(rawEvent)) {
    return null;
  }

  if (isRecord(rawEvent.event)) {
    return rawEvent.event;
  }

  if (isRecord(rawEvent.payload) && isRecord(rawEvent.payload.event)) {
    return rawEvent.payload.event;
  }

  return null;
}

function readStringField(value: Record<string, unknown>, field: string) {
  const raw = value[field];

  return typeof raw === "string" ? raw : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
