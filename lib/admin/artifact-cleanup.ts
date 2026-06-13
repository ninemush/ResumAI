import "server-only";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export const adminArtifactCleanupSchema = z
  .object({
    dryRun: z.boolean().default(true),
    resumeIds: z.array(z.string().trim().uuid()).max(100).optional(),
  })
  .default({ dryRun: true });

type StaleArtifactRow = {
  created_at: string;
  docx_storage_path: string | null;
  id: string;
  pdf_storage_path: string | null;
  resume_type: string;
  status: string;
  updated_at: string;
  user_id: string;
};

export type ArtifactCleanupReport = {
  createdAt: string;
  id: string;
  missingArtifacts: ("pdf" | "docx")[];
  resumeType: string;
  statusBefore: string;
  updatedAt: string;
  userId: string;
};

export type ArtifactCleanupResult = {
  appliedCount: number;
  auditEventId: string | null;
  dryRun: boolean;
  reports: ArtifactCleanupReport[];
  staleCount: number;
};

export async function cleanupStaleResumeArtifacts(
  input: z.input<typeof adminArtifactCleanupSchema>,
): Promise<ArtifactCleanupResult> {
  const parsed = adminArtifactCleanupSchema.parse(input);
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

  const rows = await readStaleArtifactRows(supabase, parsed.resumeIds);
  const reports = rows.map(buildArtifactCleanupReport);
  let auditEventId: string | null = null;

  if (!parsed.dryRun && rows.length > 0) {
    const rowIds = rows.map((row) => row.id);
    const { error: updateError } = await supabase
      .from("generated_resumes")
      .update({
        docx_storage_path: null,
        pdf_storage_path: null,
        status: "draft",
      })
      .in("id", rowIds);

    if (updateError) {
      throw new Error("ARTIFACT_CLEANUP_UPDATE_FAILED");
    }

    const { data: auditEvent, error: auditError } = await supabase
      .from("audit_events")
      .insert({
        actor_user_id: user.id,
        event_type: "admin.artifact_cleanup.applied",
        metadata: {
          dryRun: false,
          reports,
          staleCount: rows.length,
        },
        resource_id: rows[0]?.id ?? null,
        resource_type: "generated_resume_artifact_cleanup",
        user_id: null,
      })
      .select("id")
      .single();

    if (auditError || !auditEvent) {
      throw new Error("ARTIFACT_CLEANUP_AUDIT_FAILED");
    }

    auditEventId = auditEvent.id;
  }

  return {
    appliedCount: parsed.dryRun ? 0 : rows.length,
    auditEventId,
    dryRun: parsed.dryRun,
    reports,
    staleCount: rows.length,
  };
}

async function readStaleArtifactRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  resumeIds: string[] | undefined,
) {
  let query = supabase
    .from("generated_resumes")
    .select("id, user_id, resume_type, status, pdf_storage_path, docx_storage_path, created_at, updated_at")
    .eq("status", "ready")
    .order("updated_at", { ascending: false })
    .limit(100);

  if (resumeIds?.length) {
    query = query.in("id", resumeIds);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error("ARTIFACT_CLEANUP_READ_FAILED");
  }

  return ((data ?? []) as StaleArtifactRow[]).filter(
    (row) => !row.pdf_storage_path || !row.docx_storage_path,
  );
}

function buildArtifactCleanupReport(row: StaleArtifactRow): ArtifactCleanupReport {
  const missingArtifacts: ("pdf" | "docx")[] = [];

  if (!row.pdf_storage_path) {
    missingArtifacts.push("pdf");
  }

  if (!row.docx_storage_path) {
    missingArtifacts.push("docx");
  }

  return {
    createdAt: row.created_at,
    id: row.id,
    missingArtifacts,
    resumeType: row.resume_type,
    statusBefore: row.status,
    updatedAt: row.updated_at,
    userId: row.user_id,
  };
}
