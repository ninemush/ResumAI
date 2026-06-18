import "server-only";

import { z } from "zod";

import { buildOperationFingerprint } from "@/lib/security/operation-fingerprint";
import { createClient } from "@/lib/supabase/server";

export const applicationStatusSchema = z.enum([
  "draft",
  "applied",
  "no_reply",
  "rejected",
  "interview_in_progress",
  "interviewed_not_selected",
  "interviewed_selected",
  "withdrawn",
]);

export const createApplicationFromJobSchema = z.object({
  decision: z.enum(["apply", "network_first", "skip", "save_for_later", "needs_more_profile"]),
  decisionReason: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(180).optional(),
  jobIngestionId: z.string().uuid(),
  overrideSkip: z.boolean().default(false),
  status: applicationStatusSchema.default("draft"),
});

export const updateApplicationStatusSchema = z.object({
  applicationId: z.string().uuid(),
  status: applicationStatusSchema,
  source: z.enum(["chat", "ui", "system"]).default("ui"),
});

export const updateApplicationArchiveStateSchema = z.object({
  applicationId: z.string().uuid(),
  archived: z.boolean(),
});

const nullableTrimmedText = (max: number) =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value ?? null;
      }

      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    },
    z.string().max(max).nullable(),
  );

export const updateApplicationPlanSchema = z.object({
  applicationId: z.string().uuid(),
  contactChannel: nullableTrimmedText(160),
  contactName: nullableTrimmedText(160),
  followUpAt: nullableTrimmedText(40),
  nextAction: nullableTrimmedText(180),
  notes: nullableTrimmedText(1200),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
});

export type ApplicationCommandResult = {
  application: {
    archivedAt?: string | null;
    contactChannel?: string | null;
    contactName?: string | null;
    followUpAt?: string | null;
    id: string;
    companyName: string;
    jobTitle: string | null;
    jobUrl: string;
    nextAction?: string | null;
    notes?: string | null;
    priority?: "low" | "normal" | "high";
    status: z.infer<typeof applicationStatusSchema>;
  };
  created: boolean;
};

export async function createApplicationFromJob(
  input: z.input<typeof createApplicationFromJobSchema>,
): Promise<ApplicationCommandResult> {
  const parsed = createApplicationFromJobSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { data: rpcResult, error: rpcError } = await supabase.rpc("create_application_from_job", {
    p_decision: parsed.decision,
    p_decision_reason: parsed.decisionReason ?? null,
    p_job_ingestion_id: parsed.jobIngestionId,
    p_operation_fingerprint: buildOperationFingerprint({
      basis: {
        creationMode: "job_ingestion",
        decision: parsed.decision,
        decisionReason: parsed.decisionReason ?? null,
        jobIngestionId: parsed.jobIngestionId,
        overrideSkip: parsed.overrideSkip,
        status: parsed.status,
      },
      feature: "application_logged",
      operationKey:
        parsed.idempotencyKey ??
        `applicationCreate:${parsed.jobIngestionId}:${parsed.decision}:${parsed.status}`,
      resourceId: parsed.jobIngestionId,
      resourceType: "application",
      userId: user.id,
    }),
    p_operation_key:
      parsed.idempotencyKey ??
      `applicationCreate:${parsed.jobIngestionId}:${parsed.decision}:${parsed.status}`,
    p_override_skip: parsed.overrideSkip,
    p_status: parsed.status,
  });

  if (rpcError || !rpcResult) {
    throw new Error(mapApplicationCreateRpcError(rpcError?.message));
  }

  const application = normalizeApplicationRpcResult(rpcResult);

  return {
    application: {
      id: application.id,
      companyName: application.companyName,
      jobTitle: application.jobTitle,
      jobUrl: application.jobUrl,
      status: application.status,
    },
    created: application.created,
  };

}

export async function updateApplicationArchiveState(
  input: z.input<typeof updateApplicationArchiveStateSchema>,
): Promise<ApplicationCommandResult> {
  const parsed = updateApplicationArchiveStateSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { data, error } = await supabase
    .from("applications")
    .update({ archived_at: parsed.archived ? new Date().toISOString() : null })
    .eq("id", parsed.applicationId)
    .eq("user_id", user.id)
    .select("id, company_name, job_title, job_url, status, archived_at")
    .single();

  if (error || !data) {
    throw new Error("APPLICATION_NOT_FOUND");
  }

  return {
    application: mapApplication(data),
    created: false,
  };
}

export async function updateApplicationPlan(
  input: z.input<typeof updateApplicationPlanSchema>,
): Promise<ApplicationCommandResult> {
  const parsed = updateApplicationPlanSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const followUpAt = normalizeFollowUpAt(parsed.followUpAt);
  const { data, error } = await supabase
    .from("applications")
    .update({
      contact_channel: parsed.contactChannel,
      contact_name: parsed.contactName,
      follow_up_at: followUpAt,
      next_action: parsed.nextAction,
      notes: parsed.notes,
      priority: parsed.priority,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.applicationId)
    .eq("user_id", user.id)
    .select(
      "id, company_name, job_title, job_url, status, archived_at, next_action, follow_up_at, contact_name, contact_channel, priority, notes",
    )
    .single();

  if (error || !data) {
    throw new Error("APPLICATION_NOT_FOUND");
  }

  await supabase.from("audit_events").insert({
    actor_user_id: user.id,
    event_type: "application.plan.updated",
    metadata: {
      has_contact: Boolean(parsed.contactName || parsed.contactChannel),
      has_follow_up: Boolean(followUpAt),
      priority: parsed.priority,
    },
    resource_id: parsed.applicationId,
    resource_type: "application",
    user_id: user.id,
  });

  return {
    application: mapApplication(data),
    created: false,
  };
}

export async function updateApplicationStatus(
  input: z.input<typeof updateApplicationStatusSchema>,
): Promise<ApplicationCommandResult> {
  const parsed = updateApplicationStatusSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { data: application, error } = await supabase.rpc("update_application_status", {
    p_application_id: parsed.applicationId,
    p_metadata: {},
    p_new_status: parsed.status,
    p_source: parsed.source,
  });

  if (error || !application) {
    throw new Error(mapStatusUpdateError(error?.message));
  }

  const updatedApplication = Array.isArray(application) ? application[0] : application;

  if (!updatedApplication) {
    throw new Error("APPLICATION_NOT_FOUND");
  }

  return {
    application: mapApplication(updatedApplication),
    created: false,
  };
}

function mapApplication(application: {
  archived_at?: string | null;
  contact_channel?: string | null;
  contact_name?: string | null;
  follow_up_at?: string | null;
  id: string;
  company_name: string;
  job_title: string | null;
  job_url: string;
  next_action?: string | null;
  notes?: string | null;
  priority?: "low" | "normal" | "high";
  status: z.infer<typeof applicationStatusSchema>;
}) {
  return {
    archivedAt: application.archived_at ?? null,
    contactChannel: application.contact_channel ?? null,
    contactName: application.contact_name ?? null,
    followUpAt: application.follow_up_at ?? null,
    id: application.id,
    companyName: application.company_name,
    jobTitle: application.job_title,
    jobUrl: application.job_url,
    nextAction: application.next_action ?? null,
    notes: application.notes ?? null,
    priority: application.priority ?? "normal",
    status: application.status,
  };
}

function normalizeFollowUpAt(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00.000Z` : value;
  const timestamp = Date.parse(normalized);

  if (Number.isNaN(timestamp)) {
    throw new Error("APPLICATION_PLAN_INVALID_DATE");
  }

  return new Date(timestamp).toISOString();
}

function mapStatusUpdateError(message: string | undefined) {
  if (message?.includes("AUTH_REQUIRED")) return "AUTH_REQUIRED";
  if (message?.includes("APPLICATION_NOT_FOUND")) return "APPLICATION_NOT_FOUND";
  if (message?.includes("FINAL_MATERIALS_REQUIRED")) return "FINAL_MATERIALS_REQUIRED";
  return "APPLICATION_STATUS_EVENT_FAILED";
}

function mapApplicationCreateRpcError(message: string | undefined) {
  if (message?.includes("AUTH_REQUIRED")) return "AUTH_REQUIRED";
  if (message?.includes("JOB_NOT_FOUND")) return "JOB_NOT_FOUND";
  if (message?.includes("JOB_NOT_READY")) return "JOB_NOT_READY";
  if (message?.includes("APPLICATION_SKIP_REQUIRES_OVERRIDE")) {
    return "APPLICATION_SKIP_REQUIRES_OVERRIDE";
  }
  if (message?.includes("QUOTA_TIER_REQUIRED")) return "QUOTA_TIER_REQUIRED";
  if (message?.includes("QUOTA_LIMIT_REACHED")) return "QUOTA_LIMIT_REACHED";
  if (message?.includes("QUOTA_IDEMPOTENCY_MISMATCH")) return "QUOTA_IDEMPOTENCY_MISMATCH";
  if (message?.includes("INVALID_APPLICATION_DECISION")) return "INVALID_APPLICATION_DECISION";
  return "APPLICATION_CREATE_FAILED";
}

function normalizeApplicationRpcResult(value: unknown) {
  const parsed = z.object({
    companyName: z.string(),
    created: z.boolean(),
    fitDecision: z.string().nullable().optional(),
    fitDecisionReason: z.string().nullable().optional(),
    id: z.string().uuid(),
    jobTitle: z.string().nullable(),
    jobUrl: z.string(),
    status: applicationStatusSchema,
  }).parse(value);

  return parsed;
}
