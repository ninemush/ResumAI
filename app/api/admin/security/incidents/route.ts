import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createSecurityIncident,
  listSecurityIncidents,
} from "@/lib/privacy/incidents";
import { securityIncidentCreateSchema } from "@/lib/privacy/schemas";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  const rateLimit = checkRateLimit({
    key: getClientRateLimitKey(request, "admin_incidents_read"),
    limit: 80,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({ requestId, result: rateLimit });
  }

  try {
    const incidents = await listSecurityIncidents();

    return NextResponse.json({ ok: true, incidents, requestId });
  } catch (error) {
    return incidentApiError(error, requestId, "admin.security_incidents_failed");
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const rateLimit = checkRateLimit({
    key: getClientRateLimitKey(request, "admin_incident_create"),
    limit: 20,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Incident records are being created too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    const input = securityIncidentCreateSchema.parse(await request.json());
    const incident = await createSecurityIncident(input);

    return NextResponse.json({ ok: true, incident, requestId });
  } catch (error) {
    return incidentApiError(error, requestId, "admin.security_incident_create_failed");
  }
}

function incidentApiError(error: unknown, requestId: string, code: string) {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "security_incident.invalid_input",
          message: "Use valid incident severity, status, title, and notification flags.",
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
      code: error instanceof Error ? error.message : "UNKNOWN_SECURITY_INCIDENT_ERROR",
      event: "security_incident_route_failed",
      requestId,
    }),
  );

  return NextResponse.json(
    {
      ok: false,
      requestId,
      error: {
        category: "server",
        code,
        message: "Security incident records could not be processed.",
      },
    },
    { status: 500 },
  );
}
