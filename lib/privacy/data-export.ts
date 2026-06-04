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

  await supabase
    .from("privacy_requests")
    .update({
      export_storage_path: storagePath,
      resolution_summary:
        "Structured JSON export generated in private user-scoped storage. Uploaded binary files are referenced by metadata only in v1.",
      status: "completed",
      resolved_at: new Date().toISOString(),
    })
    .eq("id", privacyRequest.id)
    .eq("user_id", user.id);

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
    roleRecommendations,
    jobIngestions,
    applications,
    applicationStatusEvents,
    generatedResumes,
    generatedCoverLetters,
    creditLedger,
    privacyRequests,
  ] = await Promise.all([
    selectMaybeSingle("profiles", "id, display_name, headline, summary, target_direction, target_level, profile_status, photo_storage_path, terms_accepted_at, terms_version, created_at, updated_at", userId),
    selectMany("profile_facts", "id, fact_type, fact_value, origin, source_ids, confidence, user_confirmed, created_at, updated_at", userId),
    selectMany("profile_sources", "id, source_type, source_url, storage_path, original_filename, mime_type, extraction_status, failure_reason, created_at, updated_at", userId),
    selectMany("role_recommendations", "id, role_family, role_titles, seniority_level, rationale, assumptions, open_questions, confidence, user_acknowledged, created_at, updated_at", userId),
    selectMany("job_ingestions", "id, job_url, resolved_url, title, company, extracted_text, ingestion_status, failure_reason, archived_at, created_at, updated_at", userId),
    selectMany("applications", "id, company_name, job_title, job_url, job_ingestion_id, status, quota_event_id, archived_at, created_at, updated_at", userId),
    selectMany("application_status_events", "id, application_id, previous_status, new_status, source, metadata, created_at", userId),
    selectMany("generated_resumes", "id, profile_id, application_id, resume_type, prompt_version, model, content_json, storage_path, pdf_storage_path, docx_storage_path, status, created_at, updated_at", userId),
    selectMany("generated_cover_letters", "id, application_id, prompt_version, model, content, pdf_storage_path, docx_storage_path, status, created_at, updated_at", userId),
    selectMany("credit_ledger", "id, event_type, credit_delta, resource_type, resource_id, metadata, created_at", userId),
    selectMany("privacy_requests", "id, request_type, status, subject, details, identity_verification_status, due_at, resolved_at, resolution_summary, export_storage_path, created_at, updated_at", userId),
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
    applications,
    applicationStatusEvents,
    creditLedger,
    generatedCoverLetters,
    generatedResumes,
    jobIngestions,
    privacyRequests,
    profile,
    profileFacts,
    profileSources: profileSources.map((source) => ({
      ...source,
      binaryFileIncluded: false,
      note: source.storage_path
        ? "Private uploaded file is referenced by storage path metadata only; full binary embedding is excluded from v1 export."
        : null,
    })),
    roleRecommendations,
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
