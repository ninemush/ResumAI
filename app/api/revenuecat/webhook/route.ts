import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

const revenueCatEventSchema = z.object({
  event: z.object({
    app_user_id: z.string().optional(),
    id: z.string().min(1),
    product_id: z.string().optional(),
    type: z.string().optional(),
  }),
});

const productCreditMapSchema = z.record(z.string(), z.number().int().positive());

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const webhookSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
  const authorization = request.headers.get("authorization");

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

  const productId = parsed.data.event.product_id ?? "";
  const appUserId = parsed.data.event.app_user_id ?? "";
  const productMap = readProductCreditMap();
  const creditAmount = productMap[productId] ?? 0;

  if (!creditAmount || !isUuid(appUserId)) {
    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: !creditAmount ? "product_not_mapped" : "app_user_id_not_supabase_uuid",
      requestId,
    });
  }

  try {
    const supabase = createAdminClient();

    const { data: existing } = await supabase
      .from("revenuecat_events")
      .select("id")
      .eq("event_id", parsed.data.event.id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        requestId,
      });
    }

    const { data: ledger, error: ledgerError } = await supabase
      .from("credit_ledger")
      .insert({
        credit_delta: creditAmount,
        event_type: "revenuecat_purchase",
        metadata: {
          event_id: parsed.data.event.id,
          product_id: productId,
          revenuecat_type: parsed.data.event.type ?? null,
        },
        resource_type: "revenuecat_purchase",
        user_id: appUserId,
      })
      .select("id")
      .single();

    if (ledgerError || !ledger) {
      throw new Error("CREDIT_LEDGER_INSERT_FAILED");
    }

    const { error: eventError } = await supabase.from("revenuecat_events").insert({
      app_user_id: appUserId,
      credit_amount: creditAmount,
      credit_ledger_id: ledger.id,
      event_id: parsed.data.event.id,
      product_id: productId,
      raw_event: body,
      user_id: appUserId,
    });

    if (eventError) {
      throw new Error("REVENUECAT_EVENT_INSERT_FAILED");
    }

    return NextResponse.json({
      ok: true,
      creditsGranted: creditAmount,
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
