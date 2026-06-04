import "server-only";

import { z } from "zod";

import {
  securityIncidentCreateSchema,
  securityIncidentUpdateSchema,
} from "@/lib/privacy/schemas";
import { requireAdmin } from "@/lib/privacy/requests";
import { createClient } from "@/lib/supabase/server";

export type SecurityIncidentSummary = {
  affectedDataCategories: string[];
  affectedUserCount: number | null;
  containedAt: string | null;
  createdAt: string;
  detectedAt: string;
  id: string;
  notificationDeadlineAt: string | null;
  regulatorNotificationRequired: boolean | null;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  severity: string;
  status: string;
  summary: string | null;
  title: string;
  updatedAt: string;
  userNotificationRequired: boolean | null;
};

const incidentSelect = [
  "id",
  "severity",
  "status",
  "title",
  "summary",
  "detected_at",
  "contained_at",
  "resolved_at",
  "affected_user_count",
  "affected_data_categories",
  "regulator_notification_required",
  "user_notification_required",
  "notification_deadline_at",
  "resolution_notes",
  "created_at",
  "updated_at",
].join(", ");

export async function listSecurityIncidents() {
  const supabase = await createClient();
  await requireAdmin(supabase);
  const { data, error } = await supabase
    .from("security_incidents")
    .select(incidentSelect)
    .order("detected_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error("SECURITY_INCIDENTS_READ_FAILED");
  }

  return (data ?? []).map(mapIncidentRow);
}

export async function createSecurityIncident(input: z.input<typeof securityIncidentCreateSchema>) {
  const parsed = securityIncidentCreateSchema.parse(input);
  const supabase = await createClient();
  const user = await requireAdmin(supabase);
  const detectedAt = parsed.detectedAt ?? new Date().toISOString();

  const { data, error } = await supabase
    .from("security_incidents")
    .insert({
      affected_data_categories: parsed.affectedDataCategories,
      affected_user_count: parsed.affectedUserCount ?? null,
      created_by: user.id,
      detected_at: detectedAt,
      notification_deadline_at: shouldSetDeadline(parsed)
        ? new Date(Date.parse(detectedAt) + 72 * 60 * 60 * 1000).toISOString()
        : null,
      regulator_notification_required: parsed.regulatorNotificationRequired ?? null,
      severity: parsed.severity,
      status: parsed.status,
      summary: parsed.summary ?? null,
      title: parsed.title,
      user_notification_required: parsed.userNotificationRequired ?? null,
    })
    .select(incidentSelect)
    .single();

  if (error || !data) {
    throw new Error("SECURITY_INCIDENT_CREATE_FAILED");
  }

  return mapIncidentRow(data);
}

export async function updateSecurityIncident({
  id,
  input,
}: {
  id: string;
  input: z.input<typeof securityIncidentUpdateSchema>;
}) {
  const parsed = securityIncidentUpdateSchema.parse(input);
  const supabase = await createClient();
  await requireAdmin(supabase);
  const patch: Record<string, unknown> = {};

  if (parsed.affectedDataCategories !== undefined) patch.affected_data_categories = parsed.affectedDataCategories;
  if (parsed.affectedUserCount !== undefined) patch.affected_user_count = parsed.affectedUserCount;
  if (parsed.containedAt !== undefined) patch.contained_at = parsed.containedAt;
  if (parsed.detectedAt !== undefined) patch.detected_at = parsed.detectedAt;
  if (parsed.regulatorNotificationRequired !== undefined) {
    patch.regulator_notification_required = parsed.regulatorNotificationRequired;
  }
  if (parsed.resolutionNotes !== undefined) patch.resolution_notes = parsed.resolutionNotes;
  if (parsed.resolvedAt !== undefined) patch.resolved_at = parsed.resolvedAt;
  if (parsed.severity !== undefined) patch.severity = parsed.severity;
  if (parsed.status !== undefined) patch.status = parsed.status;
  if (parsed.summary !== undefined) patch.summary = parsed.summary;
  if (parsed.title !== undefined) patch.title = parsed.title;
  if (parsed.userNotificationRequired !== undefined) {
    patch.user_notification_required = parsed.userNotificationRequired;
  }
  if (shouldSetDeadline(parsed) && parsed.detectedAt) {
    patch.notification_deadline_at = new Date(Date.parse(parsed.detectedAt) + 72 * 60 * 60 * 1000).toISOString();
  }
  if (parsed.status && ["resolved", "closed"].includes(parsed.status) && parsed.resolvedAt === undefined) {
    patch.resolved_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("security_incidents")
    .update(patch)
    .eq("id", id)
    .select(incidentSelect)
    .single();

  if (error || !data) {
    throw new Error("SECURITY_INCIDENT_UPDATE_FAILED");
  }

  return mapIncidentRow(data);
}

function shouldSetDeadline(input: {
  regulatorNotificationRequired?: boolean | null;
  userNotificationRequired?: boolean | null;
}) {
  return Boolean(input.regulatorNotificationRequired || input.userNotificationRequired);
}

function mapIncidentRow(row: Record<string, unknown>): SecurityIncidentSummary {
  return {
    affectedDataCategories: Array.isArray(row.affected_data_categories)
      ? row.affected_data_categories.filter((item): item is string => typeof item === "string")
      : [],
    affectedUserCount: typeof row.affected_user_count === "number" ? row.affected_user_count : null,
    containedAt: typeof row.contained_at === "string" ? row.contained_at : null,
    createdAt: String(row.created_at),
    detectedAt: String(row.detected_at),
    id: String(row.id),
    notificationDeadlineAt:
      typeof row.notification_deadline_at === "string" ? row.notification_deadline_at : null,
    regulatorNotificationRequired:
      typeof row.regulator_notification_required === "boolean" ? row.regulator_notification_required : null,
    resolutionNotes: typeof row.resolution_notes === "string" ? row.resolution_notes : null,
    resolvedAt: typeof row.resolved_at === "string" ? row.resolved_at : null,
    severity: String(row.severity),
    status: String(row.status),
    summary: typeof row.summary === "string" ? row.summary : null,
    title: String(row.title),
    updatedAt: String(row.updated_at),
    userNotificationRequired:
      typeof row.user_notification_required === "boolean" ? row.user_notification_required : null,
  };
}
