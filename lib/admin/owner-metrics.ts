import "server-only";

import { z } from "zod";

import { CREDIT_PURCHASE_OPTIONS } from "@/lib/billing/credits";
import { createClient } from "@/lib/supabase/server";

const countRecordSchema = z.record(z.string(), z.number().int().nonnegative());
const outcomeSegmentSchema = z.record(
  z.string(),
  z.record(z.string(), z.number().nonnegative()),
);
const isoDateSchema = z.string();
const adminTrendPointSchema = z.object({
  activeUsers: z.number().int().nonnegative(),
  applications: z.number().int().nonnegative(),
  date: z.string(),
  errors: z.number().int().nonnegative(),
  pageViews: z.number().int().nonnegative(),
  signups: z.number().int().nonnegative(),
  tickets: z.number().int().nonnegative(),
});
const adminPageUsageSchema = z.object({
  averageSeconds: z.number().nonnegative(),
  page: z.string(),
  totalSeconds: z.number().nonnegative(),
  uniqueUsers: z.number().int().nonnegative(),
  views: z.number().int().nonnegative(),
});
const adminUserRowSchema = z.object({
  applications: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
  creditsAvailable: z.number().int().nonnegative().default(0),
  creditsUsed: z.number().int().nonnegative().default(0),
  creditsUsedAllTime: z.number().int().nonnegative().default(0),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  lastActivityAt: isoDateSchema.nullable(),
  lastSignInAt: isoDateSchema.nullable(),
  openTickets: z.number().int().nonnegative(),
  profileStatus: z.string().nullable(),
  resumes: z.number().int().nonnegative(),
  sources: z.number().int().nonnegative(),
  tier: z.string(),
  userId: z.string(),
});
const adminErrorDetailSchema = z.object({
  area: z.string(),
  code: z.string(),
  createdAt: isoDateSchema,
  fixRequired: z.boolean(),
  id: z.string(),
  rationale: z.string(),
  rootCause: z.string(),
  severity: z.string(),
  source: z.string(),
  status: z.string(),
  summary: z.string(),
  userEmail: z.string().nullable(),
});
const adminSupportTicketSchema = z.object({
  area: z.string().default("general"),
  autoClosedAt: isoDateSchema.nullable().optional(),
  closedReason: z.string().nullable().optional(),
  createdAt: isoDateSchema,
  errorCode: z.string().nullable().optional(),
  escalatedToL2: z.boolean(),
  escalationReason: z.string().nullable(),
  fixStatus: z.string().default("not_started"),
  id: z.string(),
  l1Disposition: z.string(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  ownerNotes: z.string().default(""),
  priority: z.string(),
  reopenUntil: isoDateSchema.nullable().optional(),
  resolutionVerification: z.string().default(""),
  rootCause: z.string().default("Needs owner review."),
  rootCauseCategory: z.string().default("needs_triage"),
  sentiment: z.string(),
  source: z.string().default("user_report"),
  status: z.string(),
  subject: z.string(),
  summary: z.string(),
  suggestedFix: z.string().default(""),
  supportingLogs: z
    .array(
      z.object({
        area: z.string(),
        code: z.string(),
        createdAt: isoDateSchema,
        fixRequired: z.boolean(),
        id: z.string(),
        message: z.string(),
        rootCause: z.string(),
        source: z.string(),
      }),
    )
    .default([]),
  updatedAt: isoDateSchema,
  userEmail: z.string().nullable(),
  userVisibleResolution: z.string().default(""),
});
const profitabilitySchema = z.object({
  aiVariableCostUsd: z.number(),
  assumptions: z.array(
    z.object({
      detail: z.string(),
      label: z.string(),
      value: z.string(),
    }),
  ),
  consumptionEvidence: z.array(
    z.object({
      createdAt: isoDateSchema,
      credits: z.number(),
      email: z.string().nullable(),
      eventType: z.string(),
      estimatedCostUsd: z.number(),
      paidUsd: z.number(),
      resourceId: z.string().nullable(),
      resourceType: z.string().nullable(),
      userId: z.string(),
    }),
  ),
  costPerActiveUserUsd: z.number(),
  creditsPurchased: z.number().int().nonnegative(),
  creditsUsed: z.number().int().nonnegative(),
  grossMarginPercent: z.number(),
  grossProfitUsd: z.number(),
  paidCreditsUsed: z.number().int().nonnegative(),
  paymentFeesUsd: z.number(),
  platformFixedCostUsd: z.number(),
  revenuePerActiveUserUsd: z.number(),
  revenueUsd: z.number(),
  totalCostUsd: z.number(),
  userEconomics: z.array(
    z.object({
      creditsAvailable: z.number().int(),
      creditsUsed: z.number().int().nonnegative(),
      email: z.string().nullable(),
      estimatedCostUsd: z.number(),
      grossProfitUsd: z.number(),
      marginPercent: z.number(),
      paidUsd: z.number(),
      userId: z.string(),
    }),
  ),
});
const emptyProfitability = {
  aiVariableCostUsd: 0,
  assumptions: [],
  consumptionEvidence: [],
  costPerActiveUserUsd: 0,
  creditsPurchased: 0,
  creditsUsed: 0,
  grossMarginPercent: 0,
  grossProfitUsd: 0,
  paidCreditsUsed: 0,
  paymentFeesUsd: 0,
  platformFixedCostUsd: 0,
  revenuePerActiveUserUsd: 0,
  revenueUsd: 0,
  totalCostUsd: 0,
  userEconomics: [],
};

export const ownerMetricsSchema = z.object({
  applications: z.object({
    byStatus: countRecordSchema,
    converted: z.number().int().nonnegative(),
    logged: z.number().int().nonnegative(),
  }),
  errorDetails: z.array(adminErrorDetailSchema).default([]),
  featureUsage: countRecordSchema,
  generatedAt: z.string(),
  jobs: z.object({
    failed: z.number().int().nonnegative(),
    ingested: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
  }),
  outcomes: z
    .object({
      averageHoursToFirstResponse: z.number().nonnegative().default(0),
      byRoleFamily: outcomeSegmentSchema.default({}),
      byResumeType: outcomeSegmentSchema.default({}),
      bySourceType: outcomeSegmentSchema.default({}),
      byTier: outcomeSegmentSchema.default({}),
      interviewRate: z.number().nonnegative().default(0),
      rejectionRate: z.number().nonnegative().default(0),
      selectionRate: z.number().nonnegative().default(0),
    })
    .default({
      averageHoursToFirstResponse: 0,
      byResumeType: {},
      byRoleFamily: {},
      bySourceType: {},
      byTier: {},
      interviewRate: 0,
      rejectionRate: 0,
      selectionRate: 0,
    }),
  materials: z.object({
    coverLetterPdfs: z.number().int().nonnegative(),
    generatedCoverLetters: z.number().int().nonnegative(),
    generatedResumes: z.number().int().nonnegative(),
    resumePdfs: z.number().int().nonnegative(),
  }),
  profiles: z.object({
    created: z.number().int().nonnegative(),
    draft: z.number().int().nonnegative(),
    needsReview: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
  }),
  period: z
    .object({
      days: z.number().int().nonnegative(),
      endedAt: isoDateSchema,
      startedAt: isoDateSchema,
    })
    .default({
      days: 30,
      endedAt: new Date(0).toISOString(),
      startedAt: new Date(0).toISOString(),
    }),
  profitability: profitabilitySchema.default(emptyProfitability),
  sources: countRecordSchema,
  support: z.object({
    l1Resolved: z.number().int().nonnegative(),
    status: z.string(),
    ticketsEscalated: z.number().int().nonnegative(),
    ticketsOpen: z.number().int().nonnegative(),
  }),
  supportTickets: z.array(adminSupportTicketSchema).default([]),
  systemHealth: z.object({
    clientErrors: z.number().int().nonnegative().default(0),
    fixRequired: z.number().int().nonnegative().default(0),
    jobIngestionFailures: z.number().int().nonnegative(),
    profileExtractionFailures: z.number().int().nonnegative(),
  }),
  trends: z
    .object({
      daily: z.array(adminTrendPointSchema).default([]),
      pageUsage: z.array(adminPageUsageSchema).default([]),
    })
    .default({
      daily: [],
      pageUsage: [],
    }),
  users: z.object({
    active7d: z.number().int().nonnegative(),
    active30d: z.number().int().nonnegative(),
    activeInPeriod: z.number().int().nonnegative().default(0),
    newInPeriod: z.number().int().nonnegative().default(0),
    totalSignedUp: z.number().int().nonnegative(),
  }),
  usersList: z.array(adminUserRowSchema).default([]),
});

export type OwnerMetrics = z.infer<typeof ownerMetricsSchema>;

export async function getOwnerMetrics(periodDays = 30): Promise<OwnerMetrics> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("ADMIN_REQUIRED");
  }

  const normalizedPeriodDays = Math.trunc(periodDays);
  const rpcPeriodDays = normalizedPeriodDays > 0 ? normalizedPeriodDays : 36500;
  const { data, error } = await supabase.rpc("get_admin_operating_metrics", {
    p_period_days: rpcPeriodDays,
  });

  if (error || !data) {
    throw new Error(mapOwnerMetricsError(error?.message));
  }

  const metrics = normalizeOwnerErrorDetails(
    await attachUserCreditMetrics(
      supabase,
      ownerMetricsSchema.parse(data),
      normalizedPeriodDays,
    ),
  );
  const supportTickets = await readSupportIssues(supabase, metrics.period.startedAt, metrics.usersList);

  return supportTickets.length > 0 ? { ...metrics, supportTickets } : metrics;
}

function normalizeOwnerErrorDetails(metrics: OwnerMetrics): OwnerMetrics {
  const errorDetails = metrics.errorDetails.map(normalizeOwnerErrorSignal);
  const activeFixRequired = errorDetails.filter(
    (error) => error.fixRequired && error.status !== "resolved",
  ).length;

  return {
    ...metrics,
    errorDetails,
    systemHealth: {
      ...metrics.systemHealth,
      fixRequired: activeFixRequired,
    },
  };
}

function normalizeOwnerErrorSignal(
  error: OwnerMetrics["errorDetails"][number],
): OwnerMetrics["errorDetails"][number] {
  if (error.status === "resolved") {
    return { ...error, fixRequired: false };
  }

  const source = error.source.toLowerCase();
  const code = error.code.toLowerCase();
  const rootCause = error.rootCause.toLowerCase();
  const searchable = [code, rootCause, error.summary, error.rationale].join(" ").toLowerCase();

  if (source === "profile_source" && isProfileSourceGuidanceSignal(searchable)) {
    return {
      ...error,
      fixRequired: false,
      rootCause: readProfileSourceGuidanceRootCause(searchable, error.rootCause),
      status: "resolved",
    };
  }

  if (source === "job_ingestion" && isJobIngestionGuidanceSignal(searchable)) {
    return {
      ...error,
      fixRequired: false,
      rootCause: readJobIngestionGuidanceRootCause(searchable, error.rootCause),
      status: "resolved",
    };
  }

  return error;
}

function isProfileSourceGuidanceSignal(value: string) {
  return /\b(unsupported|blocked|empty|too_short|too short|too_big|too big|too_large|too large|limit|exceeded)\b/.test(
    value,
  );
}

function readProfileSourceGuidanceRootCause(value: string, fallback: string) {
  if (/\b(too_big|too big|too_large|too large|limit|exceeded)\b/.test(value)) {
    return "input_limit";
  }

  if (/\b(empty|too_short|too short)\b/.test(value)) {
    return "source_quality";
  }

  if (/\bblocked\b/.test(value)) {
    return "third_party_blocked";
  }

  if (/\bunsupported\b/.test(value)) {
    return "unsupported_input";
  }

  return fallback;
}

function isJobIngestionGuidanceSignal(value: string) {
  return (
    /\b(job_unsupported_content_type|job_posting_unavailable|posting unavailable|unavailable-posting|unsupported_content_type|robots\.txt|blocked|too_short|too short|empty)\b/.test(
      value,
    ) ||
    (/\bjob_fetch_failed\b/.test(value) && /job-boards\.greenhouse\.io\/\S*\/jobs\//.test(value))
  );
}

function readJobIngestionGuidanceRootCause(value: string, fallback: string) {
  if (/\b(job_posting_unavailable|posting unavailable|unavailable-posting|blocked)\b/.test(value)) {
    return "third_party_blocked";
  }

  if (/\b(job_unsupported_content_type|unsupported_content_type|robots\.txt)\b/.test(value)) {
    return "unsupported_site";
  }

  if (/\b(empty|too_short|too short)\b/.test(value)) {
    return "source_quality";
  }

  return fallback;
}

function mapOwnerMetricsError(message: string | undefined) {
  if (message?.includes("ADMIN_REQUIRED")) {
    return "ADMIN_REQUIRED";
  }

  return "OWNER_METRICS_READ_FAILED";
}

async function attachUserCreditMetrics(
  supabase: Awaited<ReturnType<typeof createClient>>,
  metrics: OwnerMetrics,
  periodDays: number,
): Promise<OwnerMetrics> {
  const userIds = metrics.usersList.map((user) => user.userId);

  if (userIds.length === 0) {
    return metrics;
  }

  const { data: ledgerRows, error } = await supabase
    .from("credit_ledger")
    .select("user_id, credit_delta, event_type, resource_type, resource_id, metadata, created_at")
    .in("user_id", userIds)
    .order("created_at", { ascending: false })
    .limit(20000);

  if (error || !ledgerRows) {
    return metrics;
  }

  const periodStartedAt =
    periodDays > 0 ? new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString() : null;
  const emailByUserId = new Map(metrics.usersList.map((user) => [user.userId, user.email]));
  const creditTotals = new Map<
    string,
    {
      available: number;
      paidUsd: number;
      purchased: number;
      used: number;
      usedAllTime: number;
    }
  >();
  const evidence: OwnerMetrics["profitability"]["consumptionEvidence"] = [];

  for (const row of ledgerRows) {
    const userId = row.user_id as string | null;
    const creditDelta = Number(row.credit_delta ?? 0);
    const createdAt = row.created_at as string;
    const isInPeriod = !periodStartedAt || new Date(createdAt) >= new Date(periodStartedAt);

    if (!userId) {
      continue;
    }

    const totals = creditTotals.get(userId) ?? {
      available: 0,
      paidUsd: 0,
      purchased: 0,
      used: 0,
      usedAllTime: 0,
    };
    totals.available += creditDelta;

    const paidUsd = isInPeriod && creditDelta > 0 ? estimatePaidUsd(row) : 0;
    if (paidUsd > 0) {
      totals.paidUsd += paidUsd;
      totals.purchased += creditDelta;
    }

    if (creditDelta < 0) {
      const usedAmount = Math.abs(creditDelta);
      totals.usedAllTime += usedAmount;

      if (isInPeriod) {
        totals.used += usedAmount;
      }
    }

    if (isInPeriod && (creditDelta < 0 || paidUsd > 0)) {
      evidence.push({
        createdAt,
        credits: Math.trunc(creditDelta),
        email: emailByUserId.get(userId) ?? null,
        eventType: String(row.event_type ?? "credit_event"),
        estimatedCostUsd: creditDelta < 0 ? roundMoney(Math.abs(creditDelta) * readCostAssumptions().costPerCreditUsd) : 0,
        paidUsd,
        resourceId: typeof row.resource_id === "string" ? row.resource_id : null,
        resourceType: typeof row.resource_type === "string" ? row.resource_type : null,
        userId,
      });
    }

    creditTotals.set(userId, totals);
  }

  const usersList = metrics.usersList.map((user) => {
    const totals = creditTotals.get(user.userId);

    if (!totals) {
      return user;
    }

    return {
      ...user,
      creditsAvailable: Math.max(0, Math.trunc(totals.available)),
      creditsUsed: Math.trunc(totals.used),
      creditsUsedAllTime: Math.trunc(totals.usedAllTime),
    };
  });

  return {
    ...metrics,
    profitability: buildProfitabilityModel({
      creditTotals,
      evidence,
      metrics,
      periodDays,
      usersList,
    }),
    usersList,
  };
}

function estimatePaidUsd(row: Record<string, unknown>) {
  const metadata = readMetadata(row.metadata);
  const productId =
    readString(metadata.product_id) ??
    readString(metadata.productId) ??
    readString(metadata.product_identifier) ??
    readString(metadata.productIdentifier);
  const purchaseOption = productId
    ? CREDIT_PURCHASE_OPTIONS.find((option) => option.productId === productId)
    : CREDIT_PURCHASE_OPTIONS.find((option) => option.credits === Number(row.credit_delta ?? 0));
  const eventType = String(row.event_type ?? "").toLowerCase();

  if (!purchaseOption || !/purchase|revenuecat|stripe|paid|checkout/.test(eventType)) {
    return 0;
  }

  return purchaseOption.priceUsd;
}

function buildProfitabilityModel({
  creditTotals,
  evidence,
  metrics,
  periodDays,
  usersList,
}: {
  creditTotals: Map<string, { available: number; paidUsd: number; purchased: number; used: number; usedAllTime: number }>;
  evidence: OwnerMetrics["profitability"]["consumptionEvidence"];
  metrics: OwnerMetrics;
  periodDays: number;
  usersList: OwnerMetrics["usersList"];
}): OwnerMetrics["profitability"] {
  const assumptions = readCostAssumptions();
  const periodAllocationDays = periodDays > 0 ? periodDays : Math.max(1, metrics.period.days);
  const platformFixedCostUsd = roundMoney(
    ((assumptions.vercelMonthlyUsd +
      assumptions.supabaseMonthlyUsd +
      assumptions.revenueCatMonthlyUsd +
      assumptions.miscMonthlyUsd) *
      periodAllocationDays) /
      30,
  );
  const revenueUsd = roundMoney([...creditTotals.values()].reduce((sum, total) => sum + total.paidUsd, 0));
  const creditsUsed = usersList.reduce((sum, user) => sum + user.creditsUsed, 0);
  const creditsPurchased = Math.trunc([...creditTotals.values()].reduce((sum, total) => sum + total.purchased, 0));
  const aiVariableCostUsd = roundMoney(creditsUsed * assumptions.costPerCreditUsd);
  const purchaseCount = evidence.filter((row) => row.paidUsd > 0).length;
  const paymentFeesUsd = roundMoney(revenueUsd * assumptions.paymentFeePercent + purchaseCount * assumptions.paymentFixedUsd);
  const totalCostUsd = roundMoney(platformFixedCostUsd + aiVariableCostUsd + paymentFeesUsd);
  const grossProfitUsd = roundMoney(revenueUsd - totalCostUsd);
  const activeUsers = Math.max(1, metrics.users.activeInPeriod || usersList.filter((user) => user.creditsUsed > 0).length);
  const paidCreditsUsed = Math.min(creditsUsed, creditsPurchased);
  const fixedCostPerUserUsd = platformFixedCostUsd / Math.max(1, usersList.length);

  return {
    aiVariableCostUsd,
    assumptions: [
      {
        detail: "Estimated from RevenueCat/Stripe credit purchase ledger events. Promo and signup grants do not count as revenue.",
        label: "Revenue basis",
        value: "Credit purchases",
      },
      {
        detail: "Used for AI, parsing, storage, and operational variable cost until provider-level cost telemetry is wired.",
        label: "Variable cost per credit",
        value: `$${assumptions.costPerCreditUsd.toFixed(2)}`,
      },
      {
        detail: "Allocated across the same selected reporting window as metrics, credits, and revenue. All-time uses the all-time window returned by the metrics function.",
        label: "Fixed platform baseline",
        value: `$${(assumptions.vercelMonthlyUsd + assumptions.supabaseMonthlyUsd + assumptions.revenueCatMonthlyUsd + assumptions.miscMonthlyUsd).toFixed(2)}/mo`,
      },
      {
        detail: "Stripe-style estimate; reconcile against Stripe exports before financial reporting.",
        label: "Payment fee estimate",
        value: `${(assumptions.paymentFeePercent * 100).toFixed(1)}% + $${assumptions.paymentFixedUsd.toFixed(2)}`,
      },
    ],
    consumptionEvidence: evidence.slice(0, 120),
    costPerActiveUserUsd: roundMoney(totalCostUsd / activeUsers),
    creditsPurchased,
    creditsUsed,
    grossMarginPercent: revenueUsd > 0 ? Math.round((grossProfitUsd / revenueUsd) * 1000) / 10 : 0,
    grossProfitUsd,
    paidCreditsUsed,
    paymentFeesUsd,
    platformFixedCostUsd,
    revenuePerActiveUserUsd: roundMoney(revenueUsd / activeUsers),
    revenueUsd,
    totalCostUsd,
    userEconomics: usersList
      .map((user) => {
        const totals = creditTotals.get(user.userId);
        const paidUsd = roundMoney(totals?.paidUsd ?? 0);
        const estimatedCostUsd = roundMoney(user.creditsUsed * assumptions.costPerCreditUsd + fixedCostPerUserUsd);
        const grossProfit = roundMoney(paidUsd - estimatedCostUsd);

        return {
          creditsAvailable: user.creditsAvailable,
          creditsUsed: user.creditsUsed,
          email: user.email,
          estimatedCostUsd,
          grossProfitUsd: grossProfit,
          marginPercent: paidUsd > 0 ? Math.round((grossProfit / paidUsd) * 1000) / 10 : 0,
          paidUsd,
          userId: user.userId,
        };
      })
      .sort((left, right) => right.paidUsd - left.paidUsd || right.creditsUsed - left.creditsUsed)
      .slice(0, 80),
  };
}

function readCostAssumptions() {
  return {
    costPerCreditUsd: readNumberEnv("OWNER_COST_PER_CREDIT_USD", 0.18),
    miscMonthlyUsd: readNumberEnv("OWNER_COST_MISC_MONTHLY_USD", 10),
    paymentFeePercent: readNumberEnv("OWNER_PAYMENT_FEE_PERCENT", 0.029),
    paymentFixedUsd: readNumberEnv("OWNER_PAYMENT_FIXED_USD", 0.3),
    revenueCatMonthlyUsd: readNumberEnv("OWNER_COST_REVENUECAT_MONTHLY_USD", 0),
    supabaseMonthlyUsd: readNumberEnv("OWNER_COST_SUPABASE_MONTHLY_USD", 25),
    vercelMonthlyUsd: readNumberEnv("OWNER_COST_VERCEL_MONTHLY_USD", 20),
  };
}

function readMetadata(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function readNumberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);

  return Number.isFinite(value) ? value : fallback;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

async function readSupportIssues(
  supabase: Awaited<ReturnType<typeof createClient>>,
  startedAt: string,
  usersList: OwnerMetrics["usersList"],
): Promise<OwnerMetrics["supportTickets"]> {
  const now = new Date().toISOString();

  await supabase
    .from("support_tickets")
    .update({
      auto_closed_at: now,
      closed_reason: "reopen_window_expired",
      status: "closed",
    })
    .eq("status", "resolved")
    .lt("reopen_until", now)
    .is("auto_closed_at", null);

  const { data: tickets, error } = await supabase
    .from("support_tickets")
    .select(
      [
        "id",
        "user_id",
        "created_at",
        "updated_at",
        "status",
        "priority",
        "sentiment",
        "subject",
        "summary",
        "l1_disposition",
        "metadata",
        "escalated_to_l2",
        "escalation_reason",
        "area",
        "source",
        "error_code",
        "root_cause_category",
        "root_cause",
        "suggested_fix",
        "fix_status",
        "owner_notes",
        "user_visible_resolution",
        "reopen_until",
        "resolution_verification",
        "auto_closed_at",
        "closed_reason",
      ].join(", "),
    )
    .gte("created_at", startedAt)
    .order("updated_at", { ascending: false })
    .limit(80);

  if (error || !tickets) {
    return [];
  }

  type SupportTicketRow = {
    area: string | null;
    auto_closed_at: string | null;
    closed_reason: string | null;
    created_at: string;
    error_code: string | null;
    escalated_to_l2: boolean;
    escalation_reason: string | null;
    fix_status: string | null;
    id: string;
    l1_disposition: string;
    metadata: Record<string, unknown> | null;
    owner_notes: string | null;
    priority: string;
    reopen_until: string | null;
    resolution_verification: string | null;
    root_cause: string | null;
    root_cause_category: string | null;
    sentiment: string;
    source: string | null;
    status: string;
    subject: string;
    suggested_fix: string | null;
    summary: string;
    updated_at: string;
    user_id: string | null;
    user_visible_resolution: string | null;
  };
  const ticketRows = tickets as unknown as SupportTicketRow[];
  const userIds = Array.from(
    new Set(ticketRows.map((ticket) => ticket.user_id).filter((value): value is string => Boolean(value))),
  );

  const { data: logs } =
    userIds.length > 0
      ? await supabase
          .from("error_events")
          .select("id, user_id, area, error_code, message, root_cause_category, fix_required, created_at")
          .in("user_id", userIds)
          .gte("created_at", startedAt)
          .order("created_at", { ascending: false })
          .limit(200)
      : { data: [] };

  const emailByUserId = new Map(usersList.map((profile) => [profile.userId, profile.email]));

  return ticketRows.map((ticket) => {
    const supportingLogs = (logs ?? [])
      .filter((log) => log.user_id === ticket.user_id)
      .slice(0, 8)
      .map((log) => ({
        area: log.area,
        code: log.error_code,
        createdAt: log.created_at,
        fixRequired: log.fix_required,
        id: log.id,
        message: log.message,
        rootCause: log.root_cause_category,
        source: "error_event",
      }));

    return {
      area: ticket.area ?? "general",
      autoClosedAt: ticket.auto_closed_at ?? null,
      closedReason: ticket.closed_reason ?? null,
      createdAt: ticket.created_at,
      errorCode: ticket.error_code ?? null,
      escalatedToL2: ticket.escalated_to_l2,
      escalationReason: ticket.escalation_reason ?? null,
      fixStatus: ticket.fix_status ?? "not_started",
      id: ticket.id,
      l1Disposition: ticket.l1_disposition,
      metadata: ticket.metadata ?? {},
      ownerNotes: ticket.owner_notes ?? "",
      priority: ticket.priority,
      reopenUntil: ticket.reopen_until ?? null,
      resolutionVerification: ticket.resolution_verification ?? "",
      rootCause: ticket.root_cause ?? "Needs owner review.",
      rootCauseCategory: ticket.root_cause_category ?? "needs_triage",
      sentiment: ticket.sentiment,
      source: ticket.source ?? "user_report",
      status: ticket.status,
      subject: ticket.subject,
      summary: ticket.summary,
      suggestedFix: ticket.suggested_fix ?? "",
      supportingLogs,
      updatedAt: ticket.updated_at,
      userEmail: ticket.user_id ? emailByUserId.get(ticket.user_id) ?? null : null,
      userVisibleResolution: ticket.user_visible_resolution ?? "",
    };
  });
}
