import "server-only";

import { z } from "zod";

import { createPrivacyRequest } from "@/lib/privacy/requests";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const PRIVACY_EXPORT_BUCKET = "privacy-exports";

type PrivacyExportCategoryStatus =
  | "included"
  | "empty"
  | "omitted_with_reason"
  | "failed";

type PrivacyExportCategoryResult<T> = {
  data: T;
  manifest: {
    reason?: string;
    recordCount: number;
    required: boolean;
    status: PrivacyExportCategoryStatus;
  };
};

type PrivacyExportManifest = Record<
  string,
  PrivacyExportCategoryResult<unknown>["manifest"]
>;

class PrivacyExportCategoryError extends Error {
  readonly manifest: PrivacyExportManifest;

  constructor(manifest: PrivacyExportManifest) {
    super("PRIVACY_EXPORT_REQUIRED_CATEGORY_FAILED");
    this.manifest = manifest;
  }
}

export type PrivacyExportResult = {
  exportJson: Record<string, unknown>;
  requestId: string;
  storagePath: string | null;
};

export async function createUserDataExport(): Promise<PrivacyExportResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const privacyRequest = await createPrivacyRequest({
    requestType: "export",
    subject: "Data export request",
  });
  const exportJson = await assembleUserDataExport(user.id, privacyRequest.id);
  assertPrivacyExportManifestComplete(exportJson.exportManifest);
  const storagePath = `${user.id}/${privacyRequest.id}/privacy-export.json`;

  const { error: uploadError } = await supabase.storage
    .from(PRIVACY_EXPORT_BUCKET)
    .upload(storagePath, JSON.stringify(exportJson, null, 2), {
      contentType: "application/json",
      upsert: true,
    });

  if (uploadError) {
    throw new Error("PRIVACY_EXPORT_UPLOAD_FAILED");
  }

  const { error: completeError } = await supabase.rpc("complete_privacy_export", {
    p_export_storage_path: storagePath,
    p_request_id: privacyRequest.id,
  });

  if (completeError) {
    throw new Error("PRIVACY_EXPORT_COMPLETE_FAILED");
  }

  return {
    exportJson,
    requestId: privacyRequest.id,
    storagePath,
  };
}

export async function assembleUserDataExport(userId: string, requestId: string) {
  const [
    profile,
    profileFacts,
    profileSources,
    profileSourceAnalyses,
    careerProfiles,
    roleRecommendations,
    jobIngestions,
    applications,
    applicationStatusEvents,
    generatedResumes,
    generatedCoverLetters,
    creditLedger,
    creditReservations,
    privacyRequests,
    adminAccessAuditEvents,
    sensitiveSupportContexts,
  ] = await Promise.all([
    selectMaybeSingleCategory("profile", "profiles", "id, display_name, headline, summary, target_direction, target_level, profile_status, photo_storage_path, terms_accepted_at, terms_version, created_at, updated_at", userId),
    selectManyCategory("profileFacts", "profile_facts", "id, fact_type, fact_value, origin, source_ids, confidence, user_confirmed, evidence_status, evidence_strength, source_type, source_label, role_context, employer_context, time_period, seniority_signal, impact_category, metric_type, safe_for_resume, inferred_vs_stated, created_at, updated_at", userId),
    selectManyCategory("profileSources", "profile_sources", "id, source_type, source_url, storage_path, original_filename, mime_type, extraction_status, failure_reason, processing_started_at, created_at, updated_at", userId),
    selectManyCategory("profileSourceAnalyses", "profile_source_analyses", "id, profile_id, source_id, schema_version, prompt_version, model, status, content_json, confidence, warnings, failure_reason, created_at, updated_at", userId),
    selectManyCategory("careerProfiles", "career_profiles", "id, profile_id, schema_version, version_number, content_json, merge_metadata, status, last_source_analysis_id, is_current, created_at, updated_at", userId),
    selectManyCategory("roleRecommendations", "role_recommendations", "id, role_family, role_titles, seniority_level, rationale, assumptions, open_questions, confidence, user_acknowledged, created_at, updated_at", userId),
    selectManyCategory("jobIngestions", "job_ingestions", "id, job_url, resolved_url, source_type, title, company, extracted_text, ingestion_status, failure_reason, fit_snapshot_at_ingestion, current_fit_analysis, fit_decision, fit_decision_reason, archived_at, created_at, updated_at", userId),
    selectManyCategory("applications", "applications", "id, company_name, job_title, job_url, job_ingestion_id, status, quota_event_id, fit_decision, fit_decision_reason, resume_angle, networking_route, likely_blocker, why_apply, next_best_action, outcome_learning, archived_at, next_action, follow_up_at, contact_name, contact_channel, priority, notes, created_at, updated_at", userId),
    selectManyCategory("applicationStatusEvents", "application_status_events", "id, application_id, previous_status, new_status, source, metadata, created_at", userId),
    selectManyCategory("generatedResumes", "generated_resumes", "id, profile_id, application_id, resume_type, prompt_version, model, content_json, storage_path, pdf_storage_path, docx_storage_path, status, version_number, generation_reason, parent_artifact_id, is_current, generation_basis, export_status, export_validation, export_validated_at, claim_review_acknowledged_at, claim_review_acknowledgement, created_at, updated_at", userId),
    selectManyCategory("generatedCoverLetters", "generated_cover_letters", "id, application_id, prompt_version, model, content, pdf_storage_path, docx_storage_path, status, version_number, generation_reason, parent_artifact_id, is_current, generation_basis, reviewer_notes, claim_risks, export_status, export_validation, export_validated_at, claim_review_acknowledged_at, claim_review_acknowledgement, created_at, updated_at", userId),
    selectManyCategory("creditLedger", "credit_ledger", "id, event_type, credit_delta, resource_type, resource_id, operation_key, metadata, created_at", userId),
    selectManyCategory("creditReservations", "credit_reservations", "id, feature, amount, resource_type, resource_id, idempotency_key, status, ledger_event_id, metadata, expires_at, created_at, updated_at", userId),
    selectManyCategory("privacyRequests", "privacy_requests", "id, request_type, status, subject, details, identity_verification_status, due_at, resolved_at, resolution_summary, export_storage_path, created_at, updated_at", userId),
    selectManyByColumnCategory("adminAccessAuditEvents", "admin_access_audit_events", "id, actor_user_id, visibility_level, access_reason, resource_type, resource_id, metadata, created_at", "target_user_id", userId, { serviceRoleFallback: true }),
    selectManyCategory("sensitiveSupportContexts", "sensitive_support_contexts", "id, support_ticket_id, consent_recorded_at, context_json, created_at, updated_at", userId, { serviceRoleFallback: true }),
  ]);
  const exportManifest = buildExportManifest({
    adminAccessAuditEvents,
    applications,
    applicationStatusEvents,
    careerProfiles,
    creditLedger,
    creditReservations,
    generatedCoverLetters,
    generatedResumes,
    jobIngestions,
    privacyRequests,
    profile,
    profileFacts,
    profileSourceAnalyses,
    profileSources,
    roleRecommendations,
    sensitiveSupportContexts,
  });

  return {
    exportMetadata: {
      generatedAt: new Date().toISOString(),
      requestId,
      userId,
      version: "2026-06-04",
    },
    exportManifest,
    account: {
      email: null,
      note: "Authentication email and identity provider metadata are managed by Supabase Auth and are not expanded in this v1 export.",
      userId,
    },
    adminAccessAuditEvents: adminAccessAuditEvents.data,
    applications: applications.data,
    applicationStatusEvents: applicationStatusEvents.data,
    careerProfiles: careerProfiles.data,
    creditLedger: creditLedger.data,
    creditReservations: creditReservations.data,
    generatedCoverLetters: generatedCoverLetters.data,
    generatedResumes: generatedResumes.data,
    jobIngestions: jobIngestions.data,
    privacyRequests: privacyRequests.data,
    profile: profile.data,
    profileFacts: profileFacts.data,
    profileSourceAnalyses: profileSourceAnalyses.data,
    profileSources: profileSources.data.map((source) => ({
      ...source,
      binaryFileIncluded: false,
      note: source.storage_path
        ? "Private uploaded file is referenced by storage path metadata only; full binary embedding is excluded from v1 export."
        : null,
    })),
    roleRecommendations: roleRecommendations.data,
    sensitiveSupportContexts: sensitiveSupportContexts.data,
    termsAcceptance: readTermsAcceptance(profile.data),
  };
}

async function selectManyCategory(
  category: string,
  table: string,
  columns: string,
  userId: string,
  options: { required?: boolean; serviceRoleFallback?: boolean } = {},
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return selectManyWithServiceRoleFallback({
      column: "user_id",
      columns,
      error,
      options,
      table,
      value: userId,
    });
  }

  return buildCategoryResult({
    data: (data ?? []) as unknown as Record<string, unknown>[],
    required: options.required ?? true,
  });
}

async function selectMaybeSingleCategory(
  category: string,
  table: string,
  columns: string,
  userId: string,
  options: { required?: boolean; serviceRoleFallback?: boolean } = {},
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (options.serviceRoleFallback) {
      try {
        const admin = createAdminClient();
        const { data: fallbackData, error: fallbackError } = await admin
          .from(table)
          .select(columns)
          .eq("user_id", userId)
          .maybeSingle();

        if (!fallbackError) {
          return buildCategoryResult({
            data: (fallbackData ?? null) as unknown as Record<string, unknown> | null,
            required: options.required ?? true,
          });
        }
      } catch {
        // The manifest below records a hard failure; callers must fail closed.
      }
    }

    return buildFailedCategoryResult<Record<string, unknown> | null>({
      data: null,
      error,
      required: options.required ?? true,
    });
  }

  return buildCategoryResult({
    data: (data ?? null) as unknown as Record<string, unknown> | null,
    required: options.required ?? true,
  });
}

async function selectManyByColumnCategory(
  category: string,
  table: string,
  columns: string,
  column: string,
  value: string,
  options: { required?: boolean; serviceRoleFallback?: boolean } = {},
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .eq(column, value)
    .order("created_at", { ascending: false });

  if (error) {
    return selectManyWithServiceRoleFallback({
      column,
      columns,
      error,
      options,
      table,
      value,
    });
  }

  return buildCategoryResult({
    data: (data ?? []) as unknown as Record<string, unknown>[],
    required: options.required ?? true,
  });
}

async function selectManyWithServiceRoleFallback({
  column,
  columns,
  error,
  options,
  table,
  value,
}: {
  column: string;
  columns: string;
  error: { message?: string };
  options: { required?: boolean; serviceRoleFallback?: boolean };
  table: string;
  value: string;
}) {
  if (options.serviceRoleFallback) {
    try {
      const admin = createAdminClient();
      const { data, error: fallbackError } = await admin
        .from(table)
        .select(columns)
        .eq(column, value)
        .order("created_at", { ascending: false });

      if (!fallbackError) {
        return buildCategoryResult({
          data: (data ?? []) as unknown as Record<string, unknown>[],
          required: options.required ?? true,
        });
      }
    } catch {
      // The manifest below records a hard failure; callers must fail closed.
    }
  }

  return buildFailedCategoryResult<Record<string, unknown>[]>({
    data: [],
    error,
    required: options.required ?? true,
  });
}

function buildCategoryResult<T>({
  data,
  required,
}: {
  data: T;
  required: boolean;
}): PrivacyExportCategoryResult<T> {
  const recordCount = Array.isArray(data) ? data.length : data ? 1 : 0;

  return {
    data,
    manifest: {
      recordCount,
      required,
      status: recordCount > 0 ? "included" : "empty",
    },
  };
}

function buildFailedCategoryResult<T>({
  data,
  error,
  required,
}: {
  data: T;
  error: { message?: string };
  required: boolean;
}): PrivacyExportCategoryResult<T> {
  return {
    data,
    manifest: {
      reason: normalizeExportFailureReason(error.message),
      recordCount: 0,
      required,
      status: required ? "failed" : "omitted_with_reason",
    },
  };
}

function buildExportManifest(
  categories: Record<string, PrivacyExportCategoryResult<unknown>>,
): PrivacyExportManifest {
  return Object.fromEntries(
    Object.entries(categories).map(([category, result]) => [category, result.manifest]),
  );
}

function assertPrivacyExportManifestComplete(manifest: PrivacyExportManifest) {
  const requiredFailures = Object.values(manifest).filter(
    (entry) => entry.required && entry.status === "failed",
  );

  if (requiredFailures.length > 0) {
    throw new PrivacyExportCategoryError(manifest);
  }
}

function normalizeExportFailureReason(message: string | undefined) {
  if (!message) {
    return "Category could not be read.";
  }

  return message.slice(0, 180);
}

function readTermsAcceptance(profile: unknown) {
  const parsed = z
    .object({
      terms_accepted_at: z.string().nullable().optional(),
      terms_version: z.string().nullable().optional(),
    })
    .nullable()
    .safeParse(profile);

  if (!parsed.success || !parsed.data) {
    return {
      acceptedAt: null,
      version: null,
    };
  }

  return {
    acceptedAt: parsed.data.terms_accepted_at ?? null,
    version: parsed.data.terms_version ?? null,
  };
}
