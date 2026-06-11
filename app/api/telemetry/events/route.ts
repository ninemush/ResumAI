import { NextResponse } from "next/server";
import { z } from "zod";

import { checkRateLimit, getClientRateLimitKey, rateLimitResponse } from "@/lib/security/rate-limit";
import { redactOperationalText } from "@/lib/security/redaction";
import { decideErrorEventAutopilot } from "@/lib/support/autopilot-policy";
import { classifyClientRuntimeError } from "@/lib/support/root-cause-groups";
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
  const requestId = crypto.randomUUID();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "telemetry_event"),
    limit: 240,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Telemetry events are being recorded too quickly. Pause briefly before trying again.",
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
        { ok: false, requestId, error: { code: "auth.required", message: "Sign in is required." } },
        { status: 401 },
      );
    }

    const payload = telemetryEventSchema.parse(await request.json());

    if (payload.eventType === "client_error") {
      const classification = classifyClientRuntimeError({
        code: payload.errorCode,
        message: payload.message,
      });
      const autopilotDecision = decideErrorEventAutopilot(
        {
          area: payload.area,
          code: payload.errorCode,
          id: "pending",
          message: payload.message,
          rootCauseCategory: classification.rootCauseCategory,
          severity: payload.severity,
        },
        { mode: "intake" },
      );
      const { error } = await supabase.from("error_events").insert({
        area: redactOperationalText(payload.area, 80),
        error_code: redactOperationalText(payload.errorCode, 120),
        fix_required: true,
        message: redactOperationalText(payload.message, 500),
        metadata: {
          autopilot: {
            action: autopilotDecision.action,
            message: autopilotDecision.auditMessage,
            reviewedAt: new Date().toISOString(),
            version: "support_autopilot_v1",
          },
          fingerprint: classification.fingerprint,
          path: payload.path ? redactOperationalText(payload.path, 240) : null,
          requestId,
        },
        rationale: classification.rationale,
        root_cause_category: classification.rootCauseCategory,
        severity: payload.severity,
        user_id: user.id,
      });

      if (error) {
        throw new Error("ERROR_EVENT_INSERT_FAILED");
      }

      return NextResponse.json({ ok: true, requestId });
    }

    const { error } = await supabase.from("app_events").insert({
      duration_seconds:
        payload.eventType === "page_time" ? roundDuration(payload.durationSeconds) : null,
      event_type: payload.eventType,
      metadata: {
        path: payload.path ? redactOperationalText(payload.path, 240) : null,
        requestId,
      },
      page: redactOperationalText(payload.page, 80),
      user_id: user.id,
    });

    if (error) {
      throw new Error("APP_EVENT_INSERT_FAILED");
    }

    return NextResponse.json({ ok: true, requestId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
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
        requestId,
      }),
    );

    return NextResponse.json(
      {
        ok: false,
        requestId,
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
