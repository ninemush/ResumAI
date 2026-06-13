import "server-only";

import { z } from "zod";

import { requireAdmin } from "@/lib/privacy/requests";
import { createAdminClient } from "@/lib/supabase/admin";
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
      storagePaths: z.array(z.string()).default([]),
      table: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
  warnings: z.array(z.string()),
});

export type DeletionPlan = z.infer<typeof deletionPlanSchema>;

const deletionExecutionSchema = z.object({
  actorUserId: z.string(),
  executedAt: z.string(),
  failedCategories: z.array(z.string()),
  requestId: z.string(),
  retainedCategories: z.array(z.string()),
  subjectUserId: z.string(),
  actions: z.array(
    z.object({
      action: z.enum(["deleted", "minimized", "retained", "retained_with_reason", "failed", "blocked_pending_review"]),
      count: z.number().int().nonnegative(),
      detail: z.string(),
      reason: z.string(),
      status: z.enum(["deleted", "minimized", "retained", "failed", "blocked_pending_review"]),
      storage: z.object({
        deletedPathCount: z.number().int().nonnegative(),
        failedPathCount: z.number().int().nonnegative(),
        pathCount: z.number().int().nonnegative(),
      }),
      table: z.string(),
    }),
  ),
  storage: z.object({
    buckets: z.array(
      z.object({
        bucket: z.string(),
        deletedPathCount: z.number().int().nonnegative(),
        failedPathCount: z.number().int().nonnegative(),
        paths: z.array(z.string()),
      }),
    ),
    deletedPathCount: z.number().int().nonnegative(),
    failedPathCount: z.number().int().nonnegative(),
  }),
});

export type DeletionExecution = z.infer<typeof deletionExecutionSchema>;

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
    profileSourceAnalyses,
    careerProfiles,
    profileFacts,
    generatedMasterResumes,
    draftApplications,
    submittedApplications,
    generatedApplicationResumes,
    generatedCoverLetters,
    creditLedger,
    creditReservations,
    quotaEvents,
    auditEvents,
    adminAccessAuditEvents,
    sensitiveSupportContexts,
  ] = await Promise.all([
    selectRows("profile_sources", "id, storage_path", userId),
    countRows("profile_source_analyses", userId),
    countRows("career_profiles", userId),
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
    countRows("credit_reservations", userId),
    countRows("quota_events", userId),
    countRows("audit_events", userId),
    countRowsByColumn("admin_access_audit_events", "target_user_id", userId),
    countRows("sensitive_support_contexts", userId),
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
        count: profileSourceAnalyses,
        reason: "Profile source analyses are derived career data and can normally be deleted with the profile source graph.",
        storagePaths: [],
        table: "profile_source_analyses",
      },
      {
        count: careerProfiles,
        reason: "Canonical career profiles are derived editable profile data and can normally be deleted with the profile graph.",
        storagePaths: [],
        table: "career_profiles",
      },
      {
        count: sensitiveSupportContexts,
        reason: "Sensitive support context requires explicit consent and should be removed unless a support or legal hold applies.",
        storagePaths: [],
        table: "sensitive_support_contexts",
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
        storagePaths: [],
        table: "applications(non_draft)",
      },
      {
        count: generatedApplicationResumes.length,
        fields: ["content_json", "storage_path", "pdf_storage_path", "docx_storage_path"],
        reason:
          "Generated application resumes may be tied to quota and dispute evidence; minimize content and artifacts instead of blind deletion.",
        storagePaths: applicationResumeStoragePaths,
        table: "generated_resumes(application)",
      },
      {
        count: generatedCoverLetters.length,
        fields: ["content", "pdf_storage_path", "docx_storage_path"],
        reason:
          "Generated cover letters may be tied to application records; minimize content and artifacts after review.",
        storagePaths: coverLetterStoragePaths,
        table: "generated_cover_letters",
      },
      {
        count: creditReservations,
        fields: ["idempotency_key", "metadata"],
        reason:
          "Credit reservations may be needed for billing/support reconciliation; minimize retry keys and metadata after review.",
        storagePaths: [],
        table: "credit_reservations",
      },
      {
        count: adminAccessAuditEvents,
        fields: ["metadata"],
        reason:
          "Admin access audit rows are retained for accountability, but request-specific metadata should be minimized after review.",
        storagePaths: [],
        table: "admin_access_audit_events",
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

export async function attachDeletionPlanToRequest({
  actorUserId,
  requestId,
}: {
  actorUserId: string;
  requestId: string;
}) {
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

  const { error: auditError } = await supabase.from("audit_events").insert({
    actor_user_id: actorUserId,
    event_type: "privacy.deletion_plan.generated",
    metadata: {
      deleteCategories: plan.delete.map((item) => item.table),
      minimizeCategories: plan.minimize.map((item) => item.table),
      privacyRequestId: requestId,
      retainedCategories: plan.retain.map((item) => item.table),
    },
    request_id: requestId,
    resource_id: requestId,
    resource_type: "privacy_request",
  });

  if (auditError) {
    throw new Error("DELETION_PLAN_AUDIT_FAILED");
  }

  return plan;
}

export async function completeDeletionReviewForRequest({
  actorUserId,
  requestId,
  resolutionSummary,
}: {
  actorUserId: string;
  requestId: string;
  resolutionSummary: string;
}) {
  const supabase = await createClient();
  await requireAdmin(supabase);

  const { data: request, error: readError } = await supabase
    .from("privacy_requests")
    .select("id, user_id, request_type, deletion_plan")
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

  const plan = deletionPlanSchema.parse(request.deletion_plan);
  const deletionExecution = await executeDeletionPlan({
    actorUserId,
    plan,
    requestId,
    subjectUserId: request.user_id as string,
  });
  const executionFailed =
    deletionExecution.storage.failedPathCount > 0 || deletionExecution.failedCategories.length > 0;

  const { data, error } = await supabase
    .from("privacy_requests")
    .update({
      admin_notes:
        executionFailed
          ? "Deletion/minimization execution is partial. Review deletion_execution failed categories and storage details before completing this request."
          : "Deletion/minimization execution completed. Retained records are limited to documented audit-safe evidence.",
      deletion_execution: deletionExecution,
      resolution_summary: resolutionSummary,
      resolved_at: executionFailed ? null : new Date().toISOString(),
      status: executionFailed ? "in_review" : "completed",
    })
    .eq("id", requestId)
    .select("id")
    .single();

  if (error || !data) {
    throw new Error("DELETION_REVIEW_COMPLETE_FAILED");
  }

  return {
    deletionExecution,
    id: data.id as string,
    status: executionFailed ? "in_review" : "completed",
  };
}

async function executeDeletionPlan({
  actorUserId,
  plan,
  requestId,
  subjectUserId,
}: {
  actorUserId: string;
  plan: DeletionPlan;
  requestId: string;
  subjectUserId: string;
}): Promise<DeletionExecution> {
  const admin = createAdminClient();
  const storagePaths = collectExecutionStoragePaths(plan);
  const storageResult = await deleteStoragePaths(storagePaths);
  const actions: DeletionExecution["actions"] = [];
  const failedCategories = new Set<string>();
  const pushAction = ({
    action,
    count,
    detail,
    failure,
    reason,
    table,
  }: {
    action: "deleted" | "minimized" | "retained";
    count: number;
    detail: string;
    failure?: string | null;
    reason: string;
    table: string;
  }) => {
    if (failure) {
      failedCategories.add(table);
    }

    actions.push({
      action: failure ? "failed" : action === "retained" ? "retained_with_reason" : action,
      count,
      detail: failure ? `${detail} Failure: ${failure}` : detail,
      reason,
      status: failure ? "failed" : action,
      storage: readActionStorageResult({ plan, storageResult, table }),
      table,
    });
  };

  await runDeletionMutation(() => admin.from("profile_source_analyses").delete().eq("user_id", subjectUserId)).then((failure) =>
  pushAction({
    action: "deleted",
    count: countPlanItem(plan.delete, "profile_source_analyses"),
    detail: "Deleted derived profile-source analysis records.",
    failure,
    reason: readPlanReason(plan.delete, "profile_source_analyses"),
    table: "profile_source_analyses",
  }));

  await runDeletionMutation(() => admin.from("career_profiles").delete().eq("user_id", subjectUserId)).then((failure) =>
  pushAction({
    action: "deleted",
    count: countPlanItem(plan.delete, "career_profiles"),
    detail: "Deleted canonical derived career profile records.",
    failure,
    reason: readPlanReason(plan.delete, "career_profiles"),
    table: "career_profiles",
  }));

  await runDeletionMutation(() => admin.from("profile_facts").delete().eq("user_id", subjectUserId)).then((failure) =>
  pushAction({
    action: "deleted",
    count: countPlanItem(plan.delete, "profile_facts"),
    detail: "Deleted editable extracted profile facts.",
    failure,
    reason: readPlanReason(plan.delete, "profile_facts"),
    table: "profile_facts",
  }));

  await runDeletionMutation(() => admin.from("profile_sources").delete().eq("user_id", subjectUserId)).then((failure) =>
  pushAction({
    action: "deleted",
    count: countPlanItem(plan.delete, "profile_sources"),
    detail: "Deleted uploaded and pasted profile source records.",
    failure,
    reason: readPlanReason(plan.delete, "profile_sources"),
    table: "profile_sources",
  }));

  await runDeletionMutation(() => admin.from("sensitive_support_contexts").delete().eq("user_id", subjectUserId)).then((failure) =>
  pushAction({
    action: "deleted",
    count: countPlanItem(plan.delete, "sensitive_support_contexts"),
    detail: "Deleted sensitive support context records associated with the user.",
    failure,
    reason: readPlanReason(plan.delete, "sensitive_support_contexts"),
    table: "sensitive_support_contexts",
  }));

  await runDeletionMutation(() =>
    admin
      .from("generated_resumes")
      .delete()
      .eq("user_id", subjectUserId)
      .eq("resume_type", "master"),
  ).then((failure) =>
  pushAction({
    action: "deleted",
    count: countPlanItem(plan.delete, "generated_resumes(master)"),
    detail: "Deleted user-controlled master resume drafts and exports.",
    failure,
    reason: readPlanReason(plan.delete, "generated_resumes(master)"),
    table: "generated_resumes(master)",
  }));

  const { data: draftApplications, error: draftApplicationsError } = await admin
    .from("applications")
    .select("id")
    .eq("user_id", subjectUserId)
    .eq("status", "draft");
  if (draftApplicationsError) {
    failedCategories.add("applications(draft)");
  }
  const draftApplicationIds = (draftApplications ?? []).map((row) => row.id as string);

  let draftDeletionFailure: string | null = readMutationFailure(draftApplicationsError);
  if (draftApplicationIds.length > 0) {
    const draftFailures = await Promise.all([
      runDeletionMutation(() =>
        admin.from("application_status_events").delete().in("application_id", draftApplicationIds),
      ),
      runDeletionMutation(() =>
        admin.from("generated_cover_letters").delete().in("application_id", draftApplicationIds),
      ),
      runDeletionMutation(() =>
        admin.from("generated_resumes").delete().in("application_id", draftApplicationIds),
      ),
      runDeletionMutation(() => admin.from("applications").delete().in("id", draftApplicationIds)),
    ]);
    draftDeletionFailure = draftFailures.filter(Boolean).join("; ") || null;
  }

  pushAction({
    action: "deleted",
    count: countPlanItem(plan.delete, "applications(draft)"),
    detail: "Deleted draft applications after removing dependent draft artifacts and status history.",
    failure: draftDeletionFailure,
    reason: readPlanReason(plan.delete, "applications(draft)"),
    table: "applications(draft)",
  });

  await runDeletionMutation(() =>
    admin
      .from("applications")
      .update({
        company_name: "Deleted per privacy request",
        job_title: null,
        job_url: "https://deleted.invalid/privacy-request",
      })
      .eq("user_id", subjectUserId)
      .neq("status", "draft"),
  ).then((failure) =>
  pushAction({
    action: "minimized",
    count: countPlanItem(plan.minimize, "applications(non_draft)"),
    detail: "Minimized submitted or status-bearing application metadata while preserving quota/status evidence.",
    failure,
    reason: readPlanReason(plan.minimize, "applications(non_draft)"),
    table: "applications(non_draft)",
  }));

  await runDeletionMutation(() =>
    admin
      .from("generated_resumes")
      .update({
        content_json: {},
        docx_storage_path: null,
        pdf_storage_path: null,
        status: "deleted",
        storage_path: null,
      })
      .eq("user_id", subjectUserId)
      .eq("resume_type", "application"),
  ).then((failure) =>
  pushAction({
    action: "minimized",
    count: countPlanItem(plan.minimize, "generated_resumes(application)"),
    detail: "Cleared generated application resume content and artifact paths while retaining minimal audit linkage.",
    failure,
    reason: readPlanReason(plan.minimize, "generated_resumes(application)"),
    table: "generated_resumes(application)",
  }));

  await runDeletionMutation(() =>
    admin
      .from("generated_cover_letters")
      .update({
        claim_risks: [],
        content: "",
        docx_storage_path: null,
        pdf_storage_path: null,
        reviewer_notes: [],
        status: "deleted",
      })
      .eq("user_id", subjectUserId),
  ).then((failure) =>
  pushAction({
    action: "minimized",
    count: countPlanItem(plan.minimize, "generated_cover_letters"),
    detail: "Cleared generated cover letter content and artifact paths while retaining minimal audit linkage.",
    failure,
    reason: readPlanReason(plan.minimize, "generated_cover_letters"),
    table: "generated_cover_letters",
  }));

  const { data: creditReservations, error: creditReservationsError } = await admin
    .from("credit_reservations")
    .select("id")
    .eq("user_id", subjectUserId);
  const minimizedAt = new Date().toISOString();

  const creditReservationFailures = await Promise.all(
    (creditReservations ?? []).map((reservation) =>
      runDeletionMutation(() =>
        admin
          .from("credit_reservations")
          .update({
            idempotency_key: `privacy-minimized:${reservation.id}`,
            metadata: {
              privacy_minimized_at: minimizedAt,
              privacy_request_id: requestId,
            },
          })
          .eq("id", reservation.id)
          .eq("user_id", subjectUserId),
      ),
    ),
  );
  pushAction({
    action: "minimized",
    count: countPlanItem(plan.minimize, "credit_reservations"),
    detail: "Minimized retry keys and reservation metadata while preserving billing traceability.",
    failure:
      [readMutationFailure(creditReservationsError), ...creditReservationFailures]
        .filter(Boolean)
        .join("; ") || null,
    reason: readPlanReason(plan.minimize, "credit_reservations"),
    table: "credit_reservations",
  });

  await runDeletionMutation(() =>
    admin
      .from("admin_access_audit_events")
      .update({ metadata: {} })
      .eq("target_user_id", subjectUserId),
  ).then((failure) =>
  pushAction({
    action: "minimized",
    count: countPlanItem(plan.minimize, "admin_access_audit_events"),
    detail: "Cleared admin access audit metadata while preserving accountability records.",
    failure,
    reason: readPlanReason(plan.minimize, "admin_access_audit_events"),
    table: "admin_access_audit_events",
  }));

  for (const retained of plan.retain) {
    pushAction({
      action: "retained",
      count: retained.count,
      detail: retained.reason,
      reason: retained.reason,
      table: retained.table,
    });
  }

  const execution = deletionExecutionSchema.parse({
    actions,
    actorUserId,
    executedAt: new Date().toISOString(),
    failedCategories: Array.from(failedCategories),
    requestId,
    retainedCategories: plan.retain.map((item) => item.table),
    storage: storageResult,
    subjectUserId,
  });
  const executionHadFailures =
    execution.failedCategories.length > 0 || execution.storage.failedPathCount > 0;

  await runDeletionMutation(() => admin.from("audit_events").insert({
    actor_user_id: actorUserId,
    event_type: executionHadFailures
      ? "privacy.deletion_execution.partial"
      : "privacy.deletion_execution.completed",
    metadata: {
      ...execution,
      failedCategories: execution.failedCategories,
      retainedCategories: execution.retainedCategories,
      storage: execution.storage,
    },
    request_id: requestId,
    resource_id: requestId,
    resource_type: "privacy_request",
    user_id: subjectUserId,
  })).then((failure) => {
    if (failure) {
      execution.failedCategories.push("audit_events");
      execution.actions.push({
        action: "failed",
        count: 1,
        detail: `Deletion execution audit event could not be recorded. Failure: ${failure}`,
        reason: "Audit event is required for deletion execution accountability.",
        status: "failed",
        storage: { deletedPathCount: 0, failedPathCount: 0, pathCount: 0 },
        table: "audit_events",
      });
    }
  });

  return execution;
}

function countPlanItem(
  items: Array<{ count: number; table: string }>,
  table: string,
) {
  return items.find((item) => item.table === table)?.count ?? 0;
}

function readPlanReason(
  items: Array<{ reason: string; table: string }>,
  table: string,
) {
  return items.find((item) => item.table === table)?.reason ?? "No plan reason recorded.";
}

async function runDeletionMutation(
  mutation: () => PromiseLike<{ error: { message?: string } | null }>,
) {
  try {
    const result = await mutation();

    return readMutationFailure(result.error);
  } catch (error) {
    return error instanceof Error ? error.message : "UNKNOWN_MUTATION_FAILURE";
  }
}

function readMutationFailure(error: { message?: string } | null | undefined) {
  return error ? error.message ?? "DATABASE_MUTATION_FAILED" : null;
}

function readActionStorageResult({
  plan,
  storageResult,
  table,
}: {
  plan: DeletionPlan;
  storageResult: DeletionExecution["storage"];
  table: string;
}) {
  const plannedPaths = [
    ...plan.delete.filter((item) => item.table === table).flatMap((item) => item.storagePaths),
    ...plan.minimize.filter((item) => item.table === table).flatMap((item) => item.storagePaths),
  ];
  const plannedPathSet = new Set(plannedPaths);

  if (plannedPathSet.size === 0) {
    return {
      deletedPathCount: 0,
      failedPathCount: 0,
      pathCount: 0,
    };
  }

  const relevantBuckets = storageResult.buckets.filter((bucket) =>
    bucket.paths.some((path) => plannedPathSet.has(path)),
  );

  return {
    deletedPathCount: relevantBuckets.reduce((sum, bucket) => {
      if (bucket.failedPathCount > 0) return sum;
      return sum + bucket.paths.filter((path) => plannedPathSet.has(path)).length;
    }, 0),
    failedPathCount: relevantBuckets.reduce((sum, bucket) => {
      if (bucket.failedPathCount === 0) return sum;
      return sum + bucket.paths.filter((path) => plannedPathSet.has(path)).length;
    }, 0),
    pathCount: plannedPathSet.size,
  };
}

function collectExecutionStoragePaths(plan: DeletionPlan) {
  const pathsByBucket = new Map<string, Set<string>>();

  const addPath = (bucket: string, path: string) => {
    const trimmed = path.trim();

    if (!trimmed) return;

    const paths = pathsByBucket.get(bucket) ?? new Set<string>();
    paths.add(trimmed);
    pathsByBucket.set(bucket, paths);
  };

  for (const item of plan.delete) {
    for (const path of item.storagePaths) {
      addPath(item.table === "profile_sources" ? "profile-sources" : "generated-artifacts", path);
    }
  }

  for (const item of plan.minimize) {
    for (const path of item.storagePaths) {
      addPath("generated-artifacts", path);
    }
  }

  return Array.from(pathsByBucket.entries()).map(([bucket, paths]) => ({
    bucket,
    paths: Array.from(paths),
  }));
}

async function deleteStoragePaths(
  groups: Array<{
    bucket: string;
    paths: string[];
  }>,
) {
  const admin = createAdminClient();
  const buckets: Array<{
    bucket: string;
    deletedPathCount: number;
    failedPathCount: number;
    paths: string[];
  }> = [];

  for (const group of groups) {
    if (group.paths.length === 0) continue;

    const result = await admin.storage.from(group.bucket).remove(group.paths);
    const failedPathCount = result.error ? group.paths.length : 0;

    buckets.push({
      bucket: group.bucket,
      deletedPathCount: failedPathCount > 0 ? 0 : group.paths.length,
      failedPathCount,
      paths: group.paths,
    });
  }

  return {
    buckets,
    deletedPathCount: buckets.reduce((sum, bucket) => sum + bucket.deletedPathCount, 0),
    failedPathCount: buckets.reduce((sum, bucket) => sum + bucket.failedPathCount, 0),
  };
}

async function countRows(table: string, userId: string) {
  const supabase = createAdminClient();
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) {
    return 0;
  }

  return count ?? 0;
}

async function countRowsByColumn(table: string, column: string, value: string) {
  const supabase = createAdminClient();
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, value);

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
  const supabase = createAdminClient();
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
