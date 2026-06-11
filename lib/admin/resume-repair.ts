import "server-only";

import { z } from "zod";

import { logAdminUserAccesses } from "@/lib/admin/access-audit";
import { sanitizeResumeContent, type ResumeQualityReport } from "@/lib/resumes/resume-quality";
import { parseResumeContent, type ResumeContent } from "@/lib/resumes/resume-content";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const adminResumeRepairSchema = z
  .object({
    dryRun: z.boolean().default(true),
    email: z.string().trim().email().optional(),
    userId: z.string().trim().uuid().optional(),
  })
  .default({ dryRun: true });

type GeneratedResumeRepairRow = {
  content_json: unknown;
  created_at: string;
  docx_storage_path: string | null;
  id: string;
  pdf_storage_path: string | null;
  profile_id: string;
  status: string;
  user_id: string;
};

export type ResumeRepairReport = {
  after: ResumeContent;
  before: ResumeContent;
  changed: boolean;
  changedSections: string[];
  clearedArtifactPaths: boolean;
  report: ResumeQualityReport;
  resumeId: string;
  statusBefore: string;
  userId: string;
};

export type ResumeRepairResult = {
  auditEventId: string | null;
  changedCount: number;
  dryRun: boolean;
  reports: ResumeRepairReport[];
  targets: {
    email: string | null;
    resumeCount: number;
    userId: string | null;
  };
};

export async function repairMasterResumes(
  input: z.input<typeof adminResumeRepairSchema>,
): Promise<ResumeRepairResult> {
  const parsed = adminResumeRepairSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("ADMIN_REQUIRED");
  }

  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");

  if (adminError || !isAdmin) {
    throw new Error("ADMIN_REQUIRED");
  }

  const targetUserId = await resolveRepairTargetUserId({
    email: parsed.email,
    userId: parsed.userId,
  });
  const rows = await readLatestMasterResumeRows(supabase, targetUserId ? [targetUserId] : null);

  await logAdminUserAccesses({
    accessReason: parsed.dryRun ? "admin_resume_repair_dry_run" : "admin_resume_repair_apply",
    actorUserId: user.id,
    metadata: {
      dryRun: parsed.dryRun,
      email: parsed.email ?? null,
      rowCount: rows.length,
      targeted: Boolean(targetUserId),
    },
    resourceType: "master_resume_repair",
    supabase,
    targetUserIds: rows.map((row) => row.user_id),
    visibilityLevel: "sensitive_source_review",
  });

  const reports = rows.map(buildRepairReport);
  const changedReports = reports.filter((report) => report.changed);
  let auditEventId: string | null = null;

  if (!parsed.dryRun && changedReports.length > 0) {
    for (const report of changedReports) {
      const { error } = await supabase
        .from("generated_resumes")
        .update({
          content_json: report.after,
          docx_storage_path: null,
          pdf_storage_path: null,
          status: "draft",
        })
        .eq("id", report.resumeId);

      if (error) {
        throw new Error("RESUME_REPAIR_UPDATE_FAILED");
      }
    }

    const { data: auditEvent, error: auditError } = await supabase
      .from("audit_events")
      .insert({
        actor_user_id: user.id,
        event_type: "admin.resume_repair.applied",
        metadata: {
          changedCount: changedReports.length,
          dryRun: false,
          email: parsed.email ?? null,
          reports: changedReports.map((report) => ({
            changedSections: report.changedSections,
            removed: report.report.removed,
            resumeId: report.resumeId,
            userId: report.userId,
          })),
          userId: targetUserId,
        },
        resource_id: changedReports[0]?.resumeId ?? null,
        resource_type: "master_resume_repair",
        user_id: targetUserId,
      })
      .select("id")
      .single();

    if (auditError || !auditEvent) {
      throw new Error("RESUME_REPAIR_AUDIT_FAILED");
    }

    auditEventId = auditEvent.id;
  }

  return {
    auditEventId,
    changedCount: changedReports.length,
    dryRun: parsed.dryRun,
    reports,
    targets: {
      email: parsed.email ?? null,
      resumeCount: rows.length,
      userId: targetUserId,
    },
  };
}

async function resolveRepairTargetUserId({
  email,
  userId,
}: {
  email?: string;
  userId?: string;
}) {
  if (!email) {
    return userId ?? null;
  }

  const adminClient = createAdminClient();
  const normalizedEmail = email.toLowerCase();
  let page = 1;

  while (page <= 50) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage: 100,
    });

    if (error) {
      throw new Error("RESUME_REPAIR_USER_LOOKUP_FAILED");
    }

    const match = data.users.find((candidate) => candidate.email?.toLowerCase() === normalizedEmail);

    if (match) {
      if (userId && match.id !== userId) {
        throw new Error("RESUME_REPAIR_TARGET_MISMATCH");
      }

      return match.id;
    }

    if (data.users.length < 100) {
      break;
    }

    page += 1;
  }

  throw new Error("RESUME_REPAIR_TARGET_NOT_FOUND");
}

async function readLatestMasterResumeRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userIds: string[] | null,
) {
  let query = supabase
    .from("generated_resumes")
    .select("id, user_id, profile_id, content_json, status, pdf_storage_path, docx_storage_path, created_at")
    .eq("resume_type", "master")
    .is("application_id", null)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (userIds?.length) {
    query = query.in("user_id", userIds);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error("RESUME_REPAIR_READ_FAILED");
  }

  const seenUsers = new Set<string>();
  const latestRows: GeneratedResumeRepairRow[] = [];

  for (const row of (data ?? []) as GeneratedResumeRepairRow[]) {
    if (seenUsers.has(row.user_id)) {
      continue;
    }

    seenUsers.add(row.user_id);
    latestRows.push(row);
  }

  return latestRows;
}

function buildRepairReport(row: GeneratedResumeRepairRow): ResumeRepairReport {
  const before = parseResumeContent(row.content_json);
  const { content: after, report } = sanitizeResumeContent(before);

  return {
    after,
    before,
    changed: report.changed,
    changedSections: report.changedSections,
    clearedArtifactPaths: report.changed && Boolean(row.pdf_storage_path || row.docx_storage_path),
    report,
    resumeId: row.id,
    statusBefore: row.status,
    userId: row.user_id,
  };
}
