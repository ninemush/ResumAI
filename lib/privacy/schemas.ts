import { z } from "zod";

export const privacyRequestTypes = [
  "access",
  "export",
  "deletion",
  "correction",
  "restriction",
  "objection",
  "ai_review",
] as const;

export const privacyRequestStatuses = [
  "submitted",
  "in_review",
  "waiting_for_user",
  "approved",
  "completed",
  "rejected",
  "cancelled",
] as const;

export const privacyRequestCreateSchema = z.object({
  details: z.string().trim().max(2000).optional().or(z.literal("").transform(() => undefined)),
  requestType: z.enum(privacyRequestTypes),
  subject: z.string().trim().max(180).optional().or(z.literal("").transform(() => undefined)),
});

export const adminPrivacyRequestUpdateSchema = z.object({
  adminNotes: z.string().trim().max(4000).optional(),
  resolutionSummary: z.string().trim().max(4000).optional(),
  status: z.enum(privacyRequestStatuses).optional(),
});

export const securityIncidentSeverities = ["low", "medium", "high", "critical"] as const;
export const securityIncidentStatuses = [
  "open",
  "investigating",
  "contained",
  "resolved",
  "closed",
] as const;

export const securityIncidentCreateSchema = z.object({
  affectedDataCategories: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  affectedUserCount: z.number().int().min(0).optional().nullable(),
  detectedAt: z.string().datetime().optional(),
  regulatorNotificationRequired: z.boolean().optional().nullable(),
  severity: z.enum(securityIncidentSeverities),
  status: z.enum(securityIncidentStatuses).default("open"),
  summary: z.string().trim().max(4000).optional().or(z.literal("").transform(() => undefined)),
  title: z.string().trim().min(4).max(180),
  userNotificationRequired: z.boolean().optional().nullable(),
});

export const securityIncidentUpdateSchema = securityIncidentCreateSchema
  .partial()
  .extend({
    containedAt: z.string().datetime().optional().nullable(),
    resolutionNotes: z.string().trim().max(4000).optional().nullable(),
    resolvedAt: z.string().datetime().optional().nullable(),
  });

export type PrivacyRequestType = (typeof privacyRequestTypes)[number];
export type PrivacyRequestStatus = (typeof privacyRequestStatuses)[number];
