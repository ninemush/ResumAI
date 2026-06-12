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
const revenueCatProcessResultSchema = z.object({
  creditsGranted: z.number().int().positive().optional(),
  duplicate: z.boolean(),
  eventId: z.string().uuid().nullable().optional(),
  ledgerId: z.string().uuid().nullable().optional(),
});
const PURCHASE_REDEEMED_EVENT_TYPES = new Set(["PURCHASE_REDEEMED"]);

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
  if (!PURCHASE_REDEEMED_EVENT_TYPES.has(eventType)) {
    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: "event_type_not_purchase_redeemed",
      requestId,
    });
  }

  const productId = parsed.data.event.product_id ?? "";
  const appUserId = parsed.data.event.app_user_id ?? "";
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
          message: "Purchase redemption payload did not include a product id and app user id.",
        },
      },
      { status: 400 },
    );
  }

  if (!creditAmount) {
    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: "product_not_mapped",
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
