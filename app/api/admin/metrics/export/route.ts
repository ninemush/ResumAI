import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { apiAuthErrorDetails, requireProtectedApiSession } from "@/lib/api/auth";
import { getOwnerMetrics, type OwnerMetrics } from "@/lib/admin/owner-metrics";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  const periodDays = parsePeriodDays(url.searchParams.get("periodDays"));
  const includeSensitive = url.searchParams.get("includeSensitive") === "true";
  const sensitiveReason = url.searchParams.get("reason")?.trim() ?? "";
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "admin_metrics_export"),
    limit: 10,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Owner metrics exports are being requested too quickly. Pause briefly before exporting again.",
      requestId,
      result: rateLimit,
    });
  }

  if (includeSensitive && sensitiveReason.length < 10) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "admin.metrics_export_reason_required",
          message: "Add a reason of at least 10 characters before exporting sensitive owner metrics.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const session = await requireProtectedApiSession({ requireAdmin: true });
    const metrics = await getOwnerMetrics(periodDays);
    await logOwnerMetricsExport({
      actorUserId: session.user.id,
      includeSensitive,
      periodDays,
      reason: includeSensitive ? sensitiveReason : null,
      requestId,
      userCount: metrics.usersList.length,
    });
    const csv = buildOwnerMetricsCsv(metrics, { includeSensitive });
    const filePeriod = periodDays === 0 ? "all-time" : `${periodDays}d`;
    const sensitivity = includeSensitive ? "sensitive" : "sanitized";

    return new NextResponse(csv, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="pramania-owner-metrics-${filePeriod}-${sensitivity}.csv"`,
        "Content-Type": "text/csv; charset=utf-8",
        "X-Request-Id": requestId,
      },
      status: 200,
    });
  } catch (error) {
    const { category, code, message, status } = toApiError(error);

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: { category, code, message },
      },
      { status },
    );
  }
}

function buildOwnerMetricsCsv(
  metrics: OwnerMetrics,
  { includeSensitive }: { includeSensitive: boolean },
) {
  return [
    csvSection("summary", [
      ["generated_at", metrics.generatedAt],
      ["period_days", metrics.period.days],
      ["period_started_at", metrics.period.startedAt],
      ["period_ended_at", metrics.period.endedAt],
      ["users_total_signed_up", metrics.users.totalSignedUp],
      ["users_active_in_period", metrics.users.activeInPeriod],
      ["profiles_ready", metrics.profiles.ready],
      ["applications_logged", metrics.applications.logged],
      ["credits_purchased", metrics.profitability.creditsPurchased],
      ["credits_used", metrics.profitability.creditsUsed],
      ["revenue_usd", metrics.profitability.revenueUsd],
      ["gross_margin_percent", metrics.profitability.grossMarginPercent],
      ["support_tickets_open", metrics.support.ticketsOpen],
      ["support_tickets_escalated", metrics.support.ticketsEscalated],
      ["fix_required", metrics.systemHealth.fixRequired],
    ]),
    csvTable("user_economics", [
      "user_ref",
      ...(includeSensitive ? ["user_id", "email"] : []),
      "credits_available",
      "credits_used",
      "paid_usd",
      "estimated_cost_usd",
      "gross_profit_usd",
      "margin_percent",
    ], metrics.profitability.userEconomics.map((user) => [
      userRef(user.userId),
      ...(includeSensitive ? [user.userId, user.email ?? ""] : []),
      user.creditsAvailable,
      user.creditsUsed,
      user.paidUsd,
      user.estimatedCostUsd,
      user.grossProfitUsd,
      user.marginPercent,
    ])),
    csvTable("credit_consumption_evidence", [
      "created_at",
      "user_ref",
      ...(includeSensitive ? ["user_id", "email"] : []),
      "event_type",
      "credits",
      "paid_usd",
      "estimated_cost_usd",
      "resource_type",
      "resource_id",
    ], metrics.profitability.consumptionEvidence.map((event) => [
      event.createdAt,
      userRef(event.userId),
      ...(includeSensitive ? [event.userId, event.email ?? ""] : []),
      event.eventType,
      event.credits,
      event.paidUsd,
      event.estimatedCostUsd,
      event.resourceType ?? "",
      event.resourceId ?? "",
    ])),
    csvTable("support_tickets", [
      "id",
      "created_at",
      "updated_at",
      "status",
      "priority",
      "area",
      ...(includeSensitive ? ["user_email"] : []),
      "subject",
      ...(includeSensitive ? ["owner_notes"] : []),
      "escalated_to_l2",
      "escalation_reason",
    ], metrics.supportTickets.map((ticket) => [
      ticket.id,
      ticket.createdAt,
      ticket.updatedAt,
      ticket.status,
      ticket.priority,
      ticket.area,
      ...(includeSensitive ? [ticket.userEmail ?? ""] : []),
      ticket.subject,
      ...(includeSensitive ? [ticket.ownerNotes] : []),
      ticket.escalatedToL2,
      ticket.escalationReason ?? "",
    ])),
    csvTable("error_details", [
      "id",
      "created_at",
      "source",
      "area",
      "severity",
      "status",
      "code",
      "root_cause",
      "fix_required",
      "summary",
      "rationale",
      ...(includeSensitive ? ["user_email"] : []),
    ], metrics.errorDetails.map((error) => [
      error.id,
      error.createdAt,
      error.source,
      error.area,
      error.severity,
      error.status,
      error.code,
      error.rootCause,
      error.fixRequired,
      error.summary,
      error.rationale,
      ...(includeSensitive ? [error.userEmail ?? ""] : []),
    ])),
  ].join("\n\n");
}

async function logOwnerMetricsExport({
  actorUserId,
  includeSensitive,
  periodDays,
  reason,
  requestId,
  userCount,
}: {
  actorUserId: string;
  includeSensitive: boolean;
  periodDays: number;
  reason: string | null;
  requestId: string;
  userCount: number;
}) {
  const supabase = await createClient();
  const { error } = await supabase.from("audit_events").insert({
    actor_user_id: actorUserId,
    event_type: includeSensitive
      ? "admin.metrics_export.sensitive"
      : "admin.metrics_export.sanitized",
    metadata: {
      includeSensitive,
      periodDays,
      reason,
      userCount,
    },
    request_id: requestId,
    resource_type: "owner_metrics_export",
  });

  if (error) {
    throw new Error("ADMIN_METRICS_EXPORT_AUDIT_FAILED");
  }
}

function csvSection(name: string, rows: Array<[string, string | number | boolean]>) {
  return csvTable(name, ["metric", "value"], rows);
}

function csvTable(name: string, headers: string[], rows: Array<Array<string | number | boolean>>) {
  return [
    `# ${name}`,
    headers.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ].join("\n");
}

function csvCell(value: string | number | boolean) {
  const text = String(value);

  if (!/[",\n\r]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, "\"\"")}"`;
}

function userRef(userId: string) {
  return createHash("sha256").update(userId).digest("hex").slice(0, 12);
}

function toApiError(error: unknown) {
  const authError = apiAuthErrorDetails(error, "Sign in is required.");
  if (authError) return authError;

  return {
    category: "server",
    code:
      error instanceof Error && error.message === "ADMIN_METRICS_EXPORT_AUDIT_FAILED"
        ? "admin.metrics_export_audit_failed"
        : "admin.metrics_export_failed",
    message:
      error instanceof Error && error.message === "ADMIN_METRICS_EXPORT_AUDIT_FAILED"
        ? "Owner metrics export was blocked because the audit event could not be recorded."
        : "Unable to export owner metrics right now.",
    status: 500,
  };
}

function parsePeriodDays(value: string | null) {
  if (value === "all" || value === "0") {
    return 0;
  }

  const parsed = Number(value ?? 30);

  if (!Number.isFinite(parsed)) {
    return 30;
  }

  return Math.max(0, Math.min(Math.trunc(parsed), 365));
}
