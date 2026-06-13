import "server-only";

import { z } from "zod";

import { createPrivacyRequest } from "@/lib/privacy/requests";
import { createClient } from "@/lib/supabase/server";

const PRIVACY_EXPORT_BUCKET = "privacy-exports";

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
    selectMaybeSingle("profiles", "id, display_name, headline, summary, target_direction, target_level, profile_status, photo_storage_path, terms_accepted_at, terms_version, created_at, updated_at", userId),
    selectMany("profile_facts", "id, fact_type, fact_value, origin, source_ids, confidence, user_confirmed, evidence_status, evidence_strength, source_type, source_label, role_context, employer_context, time_period, seniority_signal, impact_category, metric_type, safe_for_resume, inferred_vs_stated, created_at, updated_at", userId),
    selectMany("profile_sources", "id, source_type, source_url, storage_path, original_filename, mime_type, extraction_status, failure_reason, processing_started_at, created_at, updated_at", userId),
    selectMany("profile_source_analyses", "id, profile_id, source_id, schema_version, prompt_version, model, status, content_json, confidence, warnings, failure_reason, created_at, updated_at", userId),
    selectMany("career_profiles", "id, profile_id, schema_version, version_number, content_json, merge_metadata, status, last_source_analysis_id, is_current, created_at, updated_at", userId),
    selectMany("role_recommendations", "id, role_family, role_titles, seniority_level, rationale, assumptions, open_questions, confidence, user_acknowledged, created_at, updated_at", userId),
    selectMany("job_ingestions", "id, job_url, resolved_url, source_type, title, company, extracted_text, ingestion_status, failure_reason, fit_snapshot_at_ingestion, current_fit_analysis, fit_decision, fit_decision_reason, archived_at, created_at, updated_at", userId),
    selectMany("applications", "id, company_name, job_title, job_url, job_ingestion_id, status, quota_event_id, fit_decision, fit_decision_reason, resume_angle, networking_route, likely_blocker, why_apply, next_best_action, outcome_learning, archived_at, next_action, follow_up_at, contact_name, contact_channel, priority, notes, created_at, updated_at", userId),
    selectMany("application_status_events", "id, application_id, previous_status, new_status, source, metadata, created_at", userId),
    selectMany("generated_resumes", "id, profile_id, application_id, resume_type, prompt_version, model, content_json, storage_path, pdf_storage_path, docx_storage_path, status, version_number, generation_reason, parent_artifact_id, is_current, generation_basis, created_at, updated_at", userId),
    selectMany("generated_cover_letters", "id, application_id, prompt_version, model, content, pdf_storage_path, docx_storage_path, status, version_number, generation_reason, parent_artifact_id, is_current, generation_basis, reviewer_notes, claim_risks, claim_review_acknowledged_at, claim_review_acknowledgement, created_at, updated_at", userId),
    selectMany("credit_ledger", "id, event_type, credit_delta, resource_type, resource_id, operation_key, metadata, created_at", userId),
    selectMany("credit_reservations", "id, feature, amount, resource_type, resource_id, idempotency_key, status, ledger_event_id, metadata, expires_at, created_at, updated_at", userId),
    selectMany("privacy_requests", "id, request_type, status, subject, details, identity_verification_status, due_at, resolved_at, resolution_summary, export_storage_path, created_at, updated_at", userId),
    selectManyByColumn("admin_access_audit_events", "id, actor_user_id, visibility_level, access_reason, resource_type, resource_id, metadata, created_at", "target_user_id", userId),
    selectMany("sensitive_support_contexts", "id, support_ticket_id, consent_recorded_at, context_json, created_at, updated_at", userId),
  ]);

  return {
    exportMetadata: {
      generatedAt: new Date().toISOString(),
      requestId,
      userId,
      version: "2026-06-04",
    },
    account: {
      email: null,
      note: "Authentication email and identity provider metadata are managed by Supabase Auth and are not expanded in this v1 export.",
      userId,
    },
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
    profileSources: profileSources.map((source) => ({
      ...source,
      binaryFileIncluded: false,
      note: source.storage_path
        ? "Private uploaded file is referenced by storage path metadata only; full binary embedding is excluded from v1 export."
        : null,
    })),
    roleRecommendations,
    sensitiveSupportContexts,
    termsAcceptance: readTermsAcceptance(profile),
  };
}

async function selectMany(table: string, columns: string, userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return [];
  }

  return (data ?? []) as unknown as Record<string, unknown>[];
}

async function selectMaybeSingle(table: string, columns: string, userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return null;
  }

  return (data ?? null) as unknown as Record<string, unknown> | null;
}

async function selectManyByColumn(
  table: string,
  columns: string,
  column: string,
  value: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .eq(column, value)
    .order("created_at", { ascending: false });

  if (error) {
    return [];
  }

  return (data ?? []) as unknown as Record<string, unknown>[];
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
