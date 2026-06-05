import "server-only";

import { z } from "zod";

import { requireAdmin } from "@/lib/privacy/requests";
import { createClient } from "@/lib/supabase/server";

export const deletionPlanSchema = z.object({
  generatedAt: z.string(),
  requestId: z.string(),
  retain: z.array(
    z.object({
      reason: z.string(),
      table: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
  delete: z.array(
    z.object({
      reason: z.string(),
      storagePaths: z.array(z.string()),
      table: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
  minimize: z.array(
    z.object({
      fields: z.array(z.string()),
      reason: z.string(),
      table: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
  warnings: z.array(z.string()),
});

export type DeletionPlan = z.infer<typeof deletionPlanSchema>;

export async function buildDeletionPlanForRequest(requestId: string): Promise<DeletionPlan> {
  const supabase = await createClient();
  await requireAdmin(supabase);

  const { data: request, error } = await supabase
    .from("privacy_requests")
    .select("id, user_id, request_type")
    .eq("id", requestId)
    .single();

  if (error || !request) {
    throw new Error("PRIVACY_REQUEST_NOT_FOUND");
  }

  if (request.request_type !== "deletion") {
    throw new Error("PRIVACY_REQUEST_NOT_DELETION");
  }

  const userId = request.user_id as string;
  const [
    profileSources,
    profileFacts,
    generatedMasterResumes,
    draftApplications,
    submittedApplications,
    generatedApplicationResumes,
    generatedCoverLetters,
    creditLedger,
    quotaEvents,
    auditEvents,
  ] = await Promise.all([
    selectRows("profile_sources", "id, storage_path", userId),
    countRows("profile_facts", userId),
    selectRows(
      "generated_resumes",
      "id, storage_path, pdf_storage_path, docx_storage_path",
      userId,
      { column: "resume_type", value: "master" },
    ),
    selectRows("applications", "id", userId, { column: "status", value: "draft" }),
    selectRows("applications", "id", userId, { column: "status", value: "not:draft" }),
    selectRows(
      "generated_resumes",
      "id, storage_path, pdf_storage_path, docx_storage_path",
      userId,
      { column: "resume_type", value: "application" },
    ),
    selectRows("generated_cover_letters", "id, pdf_storage_path, docx_storage_path", userId),
    countRows("credit_ledger", userId),
    countRows("quota_events", userId),
    countRows("audit_events", userId),
  ]);

  const sourceStoragePaths = readStoragePaths(profileSources, ["storage_path"]);
  const masterResumeStoragePaths = readStoragePaths(generatedMasterResumes, [
    "storage_path",
    "pdf_storage_path",
    "docx_storage_path",
  ]);
  const applicationResumeStoragePaths = readStoragePaths(generatedApplicationResumes, [
    "storage_path",
    "pdf_storage_path",
    "docx_storage_path",
  ]);
  const coverLetterStoragePaths = readStoragePaths(generatedCoverLetters, [
    "pdf_storage_path",
    "docx_storage_path",
  ]);

  return {
    delete: [
      {
        count: profileSources.length,
        reason: "Uploaded and pasted profile sources are user-provided profile materials without standalone audit value.",
        storagePaths: sourceStoragePaths,
        table: "profile_sources",
      },
      {
        count: profileFacts,
        reason: "Profile facts are editable profile data and can normally be deleted with the profile source graph.",
        storagePaths: [],
        table: "profile_facts",
      },
      {
        count: generatedMasterResumes.length,
        reason: "Master resume drafts are user-controlled generated materials and are normally deletable.",
        storagePaths: masterResumeStoragePaths,
        table: "generated_resumes(master)",
      },
      {
        count: draftApplications.length,
        reason: "Draft applications not tied to submitted status can normally be deleted after review.",
        storagePaths: [],
        table: "applications(draft)",
      },
    ],
    generatedAt: new Date().toISOString(),
    minimize: [
      {
        count: submittedApplications.length,
        fields: ["company_name", "job_title", "job_url"],
        reason:
          "Application records tied to quota or status history should preserve minimal evidence while removing unnecessary free text.",
        table: "applications(non_draft)",
      },
      {
        count: generatedApplicationResumes.length,
        fields: ["content_json", "storage_path", "pdf_storage_path", "docx_storage_path"],
        reason:
          "Generated application resumes may be tied to quota and dispute evidence; minimize content and artifacts instead of blind deletion.",
        table: "generated_resumes(application)",
      },
      {
        count: generatedCoverLetters.length,
        fields: ["content", "pdf_storage_path", "docx_storage_path"],
        reason:
          "Generated cover letters may be tied to application records; minimize content and artifacts after review.",
        table: "generated_cover_letters",
      },
    ],
    requestId,
    retain: [
      {
        count: creditLedger,
        reason: "Credit ledger is append-only quota, purchase, fraud, accounting, and dispute evidence.",
        table: "credit_ledger",
      },
      {
        count: quotaEvents,
        reason: "Quota events justify tier usage and application logging limits.",
        table: "quota_events",
      },
      {
        count: auditEvents,
        reason: "Admin/security audit events may be required for fraud, abuse, accounting, dispute, and incident handling.",
        table: "audit_events",
      },
    ],
    warnings: [
      "This plan does not execute deletion automatically.",
      "Storage objects should be deleted when their owning records are deleted or minimized.",
      "Final retention periods and legal bases must be approved before production launch.",
      applicationResumeStoragePaths.length + coverLetterStoragePaths.length > 0
        ? "Application artifact storage paths exist and require admin review before removal."
        : "",
    ].filter(Boolean),
  };
}

export async function attachDeletionPlanToRequest(requestId: string) {
  const supabase = await createClient();
  await requireAdmin(supabase);
  const plan = await buildDeletionPlanForRequest(requestId);
  const { data, error } = await supabase
    .from("privacy_requests")
    .update({
      admin_notes: "Deletion/minimization plan generated. Review retention dependencies before completing.",
      deletion_plan: plan,
      status: "in_review",
    })
    .eq("id", requestId)
    .select("id")
    .single();

  if (error || !data) {
    throw new Error("DELETION_PLAN_SAVE_FAILED");
  }

  return plan;
}

export async function completeDeletionReviewForRequest({
  requestId,
  resolutionSummary,
}: {
  requestId: string;
  resolutionSummary: string;
}) {
  const supabase = await createClient();
  await requireAdmin(supabase);

  const { data: request, error: readError } = await supabase
    .from("privacy_requests")
    .select("id, request_type, deletion_plan")
    .eq("id", requestId)
    .single();

  if (readError || !request) {
    throw new Error("PRIVACY_REQUEST_NOT_FOUND");
  }

  if (request.request_type !== "deletion") {
    throw new Error("PRIVACY_REQUEST_NOT_DELETION");
  }

  if (!request.deletion_plan) {
    throw new Error("DELETION_PLAN_REQUIRED");
  }

  const { data, error } = await supabase
    .from("privacy_requests")
    .update({
      admin_notes:
        "Deletion/minimization review completed. Retained records should be limited to documented audit-safe evidence.",
      resolution_summary: resolutionSummary,
      resolved_at: new Date().toISOString(),
      status: "completed",
    })
    .eq("id", requestId)
    .select("id")
    .single();

  if (error || !data) {
    throw new Error("DELETION_REVIEW_COMPLETE_FAILED");
  }

  return { id: data.id as string };
}

async function countRows(table: string, userId: string) {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) {
    return 0;
  }

  return count ?? 0;
}

async function selectRows(
  table: string,
  columns: string,
  userId: string,
  filter?: { column: string; value: string },
) {
  const supabase = await createClient();
  let query = supabase.from(table).select(columns).eq("user_id", userId);

  if (filter?.value.startsWith("not:")) {
    query = query.neq(filter.column, filter.value.replace(/^not:/, ""));
  } else if (filter) {
    query = query.eq(filter.column, filter.value);
  }

  const { data, error } = await query;

  if (error) {
    return [];
  }

  return (data ?? []) as unknown as Record<string, unknown>[];
}

function readStoragePaths(rows: Record<string, unknown>[], keys: string[]) {
  return rows.flatMap((row) =>
    keys
      .map((key) => row[key])
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
}
