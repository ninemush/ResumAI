import { NextResponse } from "next/server";

import { apiAuthErrorDetails, requireProtectedApiSession } from "@/lib/api/auth";
import { getOwnerMetrics, type OwnerMetrics } from "@/lib/admin/owner-metrics";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  const periodDays = parsePeriodDays(url.searchParams.get("periodDays"));

  try {
    await requireProtectedApiSession({ requireAdmin: true });
    const metrics = await getOwnerMetrics(periodDays);
    const csv = buildOwnerMetricsCsv(metrics);
    const filePeriod = periodDays === 0 ? "all-time" : `${periodDays}d`;

    return new NextResponse(csv, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="pramania-owner-metrics-${filePeriod}.csv"`,
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

function buildOwnerMetricsCsv(metrics: OwnerMetrics) {
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
      "user_id",
      "email",
      "credits_available",
      "credits_used",
      "paid_usd",
      "estimated_cost_usd",
      "gross_profit_usd",
      "margin_percent",
    ], metrics.profitability.userEconomics.map((user) => [
      user.userId,
      user.email ?? "",
      user.creditsAvailable,
      user.creditsUsed,
      user.paidUsd,
      user.estimatedCostUsd,
      user.grossProfitUsd,
      user.marginPercent,
    ])),
    csvTable("credit_consumption_evidence", [
      "created_at",
      "user_id",
      "email",
      "event_type",
      "credits",
      "paid_usd",
      "estimated_cost_usd",
      "resource_type",
      "resource_id",
    ], metrics.profitability.consumptionEvidence.map((event) => [
      event.createdAt,
      event.userId,
      event.email ?? "",
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
      "user_email",
      "subject",
      "owner_notes",
      "escalated_to_l2",
      "escalation_reason",
    ], metrics.supportTickets.map((ticket) => [
      ticket.id,
      ticket.createdAt,
      ticket.updatedAt,
      ticket.status,
      ticket.priority,
      ticket.area,
      ticket.userEmail ?? "",
      ticket.subject,
      ticket.ownerNotes,
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
      "user_email",
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
      error.userEmail ?? "",
    ])),
  ].join("\n\n");
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

function toApiError(error: unknown) {
  const authError = apiAuthErrorDetails(error, "Sign in is required.");
  if (authError) return authError;

  return {
    category: "server",
    code: "admin.metrics_export_failed",
    message: "Unable to export owner metrics right now.",
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
