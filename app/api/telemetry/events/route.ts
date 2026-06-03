import { NextResponse } from "next/server";
import { z } from "zod";

import { redactOperationalText } from "@/lib/security/redaction";
import { createClient } from "@/lib/supabase/server";

const telemetryEventSchema = z.discriminatedUnion("eventType", [
  z.object({
    durationSeconds: z.number().nonnegative().max(86_400).optional(),
    eventType: z.literal("page_view"),
    page: z.string().min(1).max(80),
    path: z.string().max(240).optional(),
  }),
  z.object({
    durationSeconds: z.number().nonnegative().max(86_400),
    eventType: z.literal("page_time"),
    page: z.string().min(1).max(80),
    path: z.string().max(240).optional(),
  }),
  z.object({
    area: z.string().min(1).max(80).default("client"),
    errorCode: z.string().min(1).max(120).default("CLIENT_RUNTIME_ERROR"),
    eventType: z.literal("client_error"),
    message: z.string().max(500).default("Client runtime error"),
    path: z.string().max(240).optional(),
    severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  }),
]);

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: "auth.required", message: "Sign in is required." } },
        { status: 401 },
      );
    }

    const payload = telemetryEventSchema.parse(await request.json());

    if (payload.eventType === "client_error") {
      const { error } = await supabase.from("error_events").insert({
        area: redactOperationalText(payload.area, 80),
        error_code: redactOperationalText(payload.errorCode, 120),
        fix_required: true,
        message: redactOperationalText(payload.message, 500),
        metadata: {
          path: payload.path ? redactOperationalText(payload.path, 240) : null,
        },
        rationale: "Captured from the browser runtime. Owner review is required if this repeats or affects a core workflow.",
        root_cause_category: "client_runtime",
        severity: payload.severity,
        user_id: user.id,
      });

      if (error) {
        throw new Error("ERROR_EVENT_INSERT_FAILED");
      }

      return NextResponse.json({ ok: true });
    }

    const { error } = await supabase.from("app_events").insert({
      duration_seconds:
        payload.eventType === "page_time" ? roundDuration(payload.durationSeconds) : null,
      event_type: payload.eventType,
      metadata: {
        path: payload.path ? redactOperationalText(payload.path, 240) : null,
      },
      page: redactOperationalText(payload.page, 80),
      user_id: user.id,
    });

    if (error) {
      throw new Error("APP_EVENT_INSERT_FAILED");
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: {
            code: "telemetry.invalid_payload",
            message: "Telemetry payload was invalid.",
          },
        },
        { status: 400 },
      );
    }

    console.warn(
      JSON.stringify({
        event: "telemetry_event_route_failed",
        code: error instanceof Error ? error.message : "UNKNOWN_TELEMETRY_ERROR",
      }),
    );

    return NextResponse.json(
      {
        error: {
          code: "telemetry.write_failed",
          message: "Telemetry event could not be recorded.",
        },
      },
      { status: 500 },
    );
  }
}

function roundDuration(value: number) {
  return Math.round(value * 100) / 100;
}
