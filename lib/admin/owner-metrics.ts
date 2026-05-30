import "server-only";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const countRecordSchema = z.record(z.string(), z.number().int().nonnegative());
const outcomeSegmentSchema = z.record(
  z.string(),
  z.record(z.string(), z.number().nonnegative()),
);

export const ownerMetricsSchema = z.object({
  applications: z.object({
    byStatus: countRecordSchema,
    converted: z.number().int().nonnegative(),
    logged: z.number().int().nonnegative(),
  }),
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
  sources: countRecordSchema,
  support: z.object({
    l1Resolved: z.number().int().nonnegative(),
    status: z.string(),
    ticketsEscalated: z.number().int().nonnegative(),
    ticketsOpen: z.number().int().nonnegative(),
  }),
  systemHealth: z.object({
    jobIngestionFailures: z.number().int().nonnegative(),
    profileExtractionFailures: z.number().int().nonnegative(),
  }),
  users: z.object({
    active7d: z.number().int().nonnegative(),
    active30d: z.number().int().nonnegative(),
    totalSignedUp: z.number().int().nonnegative(),
  }),
});

export type OwnerMetrics = z.infer<typeof ownerMetricsSchema>;

export async function getOwnerMetrics(): Promise<OwnerMetrics> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_operating_metrics");

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
