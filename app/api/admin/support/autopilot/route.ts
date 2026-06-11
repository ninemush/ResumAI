import { NextResponse } from "next/server";
import { z } from "zod";

import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { runSupportAutopilot } from "@/lib/support/autopilot";
import { supportAutopilotRunSchema } from "@/lib/support/autopilot-policy";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "admin_support_autopilot"),
    limit: 12,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Support autopilot is being run too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: { code: "auth.required", message: "Sign in is required." },
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
          error: { code: "admin.required", message: "Owner or admin access is required." },
        },
        { status: 403 },
      );
    }

    const input = supportAutopilotRunSchema.parse(await readOptionalJson(request));
    const result = await runSupportAutopilot(supabase, input);

    return NextResponse.json({
      ok: true,
      requestId,
      result,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: {
            code: "support.autopilot_invalid",
            message: "Support autopilot options were invalid.",
          },
        },
        { status: 400 },
      );
    }

    console.warn(
      JSON.stringify({
        event: "admin_support_autopilot_failed",
        code: error instanceof Error ? error.message : "UNKNOWN_SUPPORT_AUTOPILOT_ERROR",
        requestId,
      }),
    );

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          code: "admin.support_autopilot_failed",
          message: "Support autopilot could not review the queue.",
        },
      },
      { status: 500 },
    );
  }
}

async function readOptionalJson(request: Request) {
  const text = await request.text();

  if (!text.trim()) {
    return {};
  }

  return JSON.parse(text) as unknown;
}
