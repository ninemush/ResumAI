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
  createdAt: isoDateSchema,
  escalatedToL2: z.boolean(),
  escalationReason: z.string().nullable(),
  id: z.string(),
  l1Disposition: z.string(),
  priority: z.string(),
  sentiment: z.string(),
  status: z.string(),
  subject: z.string(),
  summary: z.string(),
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

  return ownerMetricsSchema.parse(data);
}

function mapOwnerMetricsError(message: string | undefined) {
  if (message?.includes("ADMIN_REQUIRED")) {
    return "ADMIN_REQUIRED";
  }

  return "OWNER_METRICS_READ_FAILED";
}
