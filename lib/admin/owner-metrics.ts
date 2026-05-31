import "server-only";

import { z } from "zod";

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
  closedReason: z.string().nullable().optional(),
  createdAt: isoDateSchema,
  errorCode: z.string().nullable().optional(),
  escalatedToL2: z.boolean(),
  escalationReason: z.string().nullable(),
  fixStatus: z.string().default("not_started"),
  id: z.string(),
  l1Disposition: z.string(),
  ownerNotes: z.string().default(""),
  priority: z.string(),
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
});

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
      days: z.number().int().positive(),
      endedAt: isoDateSchema,
      startedAt: isoDateSchema,
    })
    .default({
      days: 30,
      endedAt: new Date(0).toISOString(),
      startedAt: new Date(0).toISOString(),
    }),
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

  const { data, error } = await supabase.rpc("get_admin_operating_metrics", {
    p_period_days: periodDays,
  });

  if (error || !data) {
    throw new Error(mapOwnerMetricsError(error?.message));
  }

  const metrics = ownerMetricsSchema.parse(data);
  const supportTickets = await readSupportIssues(supabase, metrics.period.startedAt, metrics.usersList);

  return supportTickets.length > 0 ? { ...metrics, supportTickets } : metrics;
}

function mapOwnerMetricsError(message: string | undefined) {
  if (message?.includes("ADMIN_REQUIRED")) {
    return "ADMIN_REQUIRED";
  }

  return "OWNER_METRICS_READ_FAILED";
}

async function readSupportIssues(
  supabase: Awaited<ReturnType<typeof createClient>>,
  startedAt: string,
  usersList: OwnerMetrics["usersList"],
): Promise<OwnerMetrics["supportTickets"]> {
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
    closed_reason: string | null;
    created_at: string;
    error_code: string | null;
    escalated_to_l2: boolean;
    escalation_reason: string | null;
    fix_status: string | null;
    id: string;
    l1_disposition: string;
    owner_notes: string | null;
    priority: string;
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
      closedReason: ticket.closed_reason ?? null,
      createdAt: ticket.created_at,
      errorCode: ticket.error_code ?? null,
      escalatedToL2: ticket.escalated_to_l2,
      escalationReason: ticket.escalation_reason ?? null,
      fixStatus: ticket.fix_status ?? "not_started",
      id: ticket.id,
      l1Disposition: ticket.l1_disposition,
      ownerNotes: ticket.owner_notes ?? "",
      priority: ticket.priority,
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
    };
  });
}
