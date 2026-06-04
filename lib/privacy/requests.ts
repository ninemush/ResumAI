import "server-only";

import { z } from "zod";

import {
  adminPrivacyRequestUpdateSchema,
  privacyRequestCreateSchema,
  type PrivacyRequestStatus,
  type PrivacyRequestType,
} from "@/lib/privacy/schemas";
import { createClient } from "@/lib/supabase/server";

export type PrivacyRequestSummary = {
  adminNotes?: string | null;
  createdAt: string;
  details: string | null;
  dueAt: string | null;
  exportStoragePath?: string | null;
  id: string;
  identityVerificationStatus: string;
  requestType: PrivacyRequestType;
  resolvedAt: string | null;
  resolutionSummary: string | null;
  status: PrivacyRequestStatus;
  subject: string | null;
  updatedAt: string;
  userId?: string;
};

type PrivacyRequestRow = {
  admin_notes?: string | null;
  created_at: string;
  details: string | null;
  due_at: string | null;
  export_storage_path?: string | null;
  id: string;
  identity_verification_status: string;
  request_type: PrivacyRequestType;
  resolved_at: string | null;
  resolution_summary: string | null;
  status: PrivacyRequestStatus;
  subject: string | null;
  updated_at: string;
  user_id?: string;
};

const userSelect = [
  "id",
  "request_type",
  "status",
  "subject",
  "details",
  "identity_verification_status",
  "due_at",
  "resolved_at",
  "resolution_summary",
  "export_storage_path",
  "created_at",
  "updated_at",
].join(", ");

const adminSelect = `${userSelect}, user_id, admin_notes`;

export async function listUserPrivacyRequests() {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  const { data, error } = await supabase
    .from("privacy_requests")
    .select(userSelect)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new Error("PRIVACY_REQUESTS_READ_FAILED");
  }

  return (data ?? []).map((row) => mapPrivacyRequestRow(row as PrivacyRequestRow, false));
}

export async function createPrivacyRequest(input: z.input<typeof privacyRequestCreateSchema>) {
  const parsed = privacyRequestCreateSchema.parse(input);
  const supabase = await createClient();
  const user = await requireUser(supabase);
  const now = new Date();
  const dueAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("privacy_requests")
    .insert({
      details: parsed.details ?? null,
      due_at: dueAt,
      request_type: parsed.requestType,
      status: "submitted",
      subject: parsed.subject ?? defaultSubject(parsed.requestType),
      user_id: user.id,
    })
    .select(userSelect)
    .single();

  if (error || !data) {
    throw new Error("PRIVACY_REQUEST_CREATE_FAILED");
  }

  return mapPrivacyRequestRow(data as PrivacyRequestRow, false);
}

export async function listAdminPrivacyRequests() {
  const supabase = await createClient();
  await requireAdmin(supabase);

  const { data, error } = await supabase
    .from("privacy_requests")
    .select(adminSelect)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error("ADMIN_PRIVACY_REQUESTS_READ_FAILED");
  }

  return (data ?? []).map((row) => mapPrivacyRequestRow(row as PrivacyRequestRow, true));
}

export async function updateAdminPrivacyRequest({
  id,
  input,
}: {
  id: string;
  input: z.input<typeof adminPrivacyRequestUpdateSchema>;
}) {
  const parsed = adminPrivacyRequestUpdateSchema.parse(input);
  const supabase = await createClient();
  await requireAdmin(supabase);

  const patch: Record<string, unknown> = {};

  if (parsed.adminNotes !== undefined) patch.admin_notes = parsed.adminNotes;
  if (parsed.resolutionSummary !== undefined) patch.resolution_summary = parsed.resolutionSummary;
  if (parsed.status !== undefined) {
    patch.status = parsed.status;
    if (["completed", "rejected", "cancelled"].includes(parsed.status)) {
      patch.resolved_at = new Date().toISOString();
    }
  }

  if (Object.keys(patch).length === 0) {
    throw new Error("PRIVACY_REQUEST_NO_CHANGES");
  }

  const { data, error } = await supabase
    .from("privacy_requests")
    .update(patch)
    .eq("id", id)
    .select(adminSelect)
    .single();

  if (error || !data) {
    throw new Error("PRIVACY_REQUEST_UPDATE_FAILED");
  }

  return mapPrivacyRequestRow(data as PrivacyRequestRow, true);
}

export function defaultSubject(requestType: PrivacyRequestType) {
  const labels: Record<PrivacyRequestType, string> = {
    access: "Access request",
    ai_review: "AI-assisted processing review",
    correction: "Correction request",
    deletion: "Deletion and minimization review",
    export: "Data export request",
    objection: "Objection review",
    restriction: "Restriction review",
  };

  return labels[requestType];
}

export async function requireUser(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  return user;
}

export async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const user = await requireUser(supabase);
  const { data, error } = await supabase
    .from("admin_roles")
    .select("role")
    .eq("user_id", user.id)
    .in("role", ["owner", "admin"])
    .limit(1);

  if (error || !data || data.length === 0) {
    throw new Error("ADMIN_REQUIRED");
  }

  return user;
}

function mapPrivacyRequestRow(row: PrivacyRequestRow, includeAdmin: boolean): PrivacyRequestSummary {
  return {
    adminNotes: includeAdmin ? row.admin_notes ?? null : undefined,
    createdAt: row.created_at,
    details: row.details,
    dueAt: row.due_at,
    exportStoragePath: row.export_storage_path ?? null,
    id: row.id,
    identityVerificationStatus: row.identity_verification_status,
    requestType: row.request_type,
    resolvedAt: row.resolved_at,
    resolutionSummary: row.resolution_summary,
    status: row.status,
    subject: row.subject,
    updatedAt: row.updated_at,
    userId: includeAdmin ? row.user_id : undefined,
  };
}
