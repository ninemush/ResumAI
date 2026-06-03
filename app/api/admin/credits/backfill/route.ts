import { NextResponse } from "next/server";
import { z } from "zod";

import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

const backfillRequestSchema = z.object({
  dryRun: z.boolean().default(true),
  userId: z.string().uuid().optional().nullable(),
});

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const rateLimit = checkRateLimit({
    key: getClientRateLimitKey(request, "admin_credit_backfill"),
    limit: 10,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Credit backfill is being requested too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: { category: "auth", code: "auth.required", message: "Sign in is required." },
        },
        { status: 401 },
      );
    }

    const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");

    if (adminError || !isAdmin) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: {
            category: "auth",
            code: "admin.required",
            message: "Owner/admin access is required.",
          },
        },
        { status: 403 },
      );
    }

    const payload = await request.json().catch(() => ({}));
    const parsed = backfillRequestSchema.parse(payload);

    const { data, error } = await supabase.rpc("backfill_historical_credit_usage", {
      p_dry_run: parsed.dryRun,
      p_user_id: parsed.userId ?? null,
    });

    if (error || !data) {
      throw new Error(error?.message ?? "BACKFILL_FAILED");
    }

    return NextResponse.json({
      ok: true,
      requestId,
      result: data,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: {
            category: "validation",
            code: "credits.backfill_invalid_request",
            message: "Backfill request is invalid.",
          },
        },
        { status: 400 },
      );
    }

    const message = error instanceof Error ? error.message : "UNKNOWN_BACKFILL_ERROR";

    console.warn(
      JSON.stringify({
        event: "historical_credit_backfill_failed",
        requestId,
        message,
      }),
    );

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "server",
          code: "credits.backfill_failed",
          message:
            "Unable to backfill historical credit usage right now. Check the migration and try again.",
        },
      },
      { status: 500 },
    );
  }
}
