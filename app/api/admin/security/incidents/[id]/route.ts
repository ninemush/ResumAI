import { NextResponse } from "next/server";
import { z } from "zod";

import { updateSecurityIncident } from "@/lib/privacy/incidents";
import { securityIncidentUpdateSchema } from "@/lib/privacy/schemas";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const rateLimit = checkRateLimit({
    key: getClientRateLimitKey(request, "admin_incident_update"),
    limit: 40,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Incident updates are being submitted too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    const { id } = await context.params;
    const input = securityIncidentUpdateSchema.parse(await request.json());
    const incident = await updateSecurityIncident({ id, input });

    return NextResponse.json({ ok: true, incident, requestId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: {
            category: "validation",
            code: "security_incident.invalid_update",
            message: "Use valid incident status, notification flags, dates, and notes.",
          },
        },
        { status: 400 },
      );
    }

    if (error instanceof Error && error.message === "AUTH_REQUIRED") {
      return NextResponse.json(
        { ok: false, requestId, error: { code: "auth.required", message: "Sign in is required." } },
        { status: 401 },
      );
    }

    if (error instanceof Error && error.message === "ADMIN_REQUIRED") {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: { category: "auth", code: "admin.required", message: "Owner or admin access is required." },
        },
        { status: 403 },
      );
    }

    console.warn(
      JSON.stringify({
        code: error instanceof Error ? error.message : "UNKNOWN_SECURITY_INCIDENT_UPDATE_ERROR",
        event: "security_incident_update_route_failed",
        requestId,
      }),
    );

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "server",
          code: "admin.security_incident_update_failed",
          message: "Security incident record could not be updated.",
        },
      },
      { status: 500 },
    );
  }
}
