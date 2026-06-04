import "server-only";

import {
  complianceHardeningChecklist,
  retentionPolicyConfig,
  subprocessorConfig,
} from "@/lib/privacy/compliance-config";
import { requireAdmin } from "@/lib/privacy/requests";
import { createClient } from "@/lib/supabase/server";

export type ComplianceDashboard = {
  dataInventory: {
    label: string;
    table: string;
    count: number;
  }[];
  generatedAt: string;
  hardeningChecklist: typeof complianceHardeningChecklist;
  incidents: {
    breachNotificationReviewCount: number;
    open: number;
    overdueNotificationReview: number;
    recent: {
      detectedAt: string;
      id: string;
      notificationDeadlineAt: string | null;
      severity: string;
      status: string;
      title: string;
    }[];
  };
  privacyRequests: {
    completedRecent: number;
    countsByType: Record<string, number>;
    open: number;
    overdue: number;
    recentOpen: {
      createdAt: string;
      dueAt: string | null;
      id: string;
      requestType: string;
      status: string;
      subject: string | null;
      userId: string;
    }[];
  };
  retentionPolicies: typeof retentionPolicyConfig;
  subprocessors: typeof subprocessorConfig;
};

export async function getComplianceDashboard(): Promise<ComplianceDashboard> {
  const supabase = await createClient();
  await requireAdmin(supabase);
  const now = new Date().toISOString();
  const recentCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [privacyRequests, incidents, dataInventory] = await Promise.all([
    readPrivacyRequests(supabase, recentCutoff, now),
    readIncidents(supabase, now),
    readDataInventory(supabase),
  ]);

  return {
    dataInventory,
    generatedAt: now,
    hardeningChecklist: complianceHardeningChecklist,
    incidents,
    privacyRequests,
    retentionPolicies: retentionPolicyConfig,
    subprocessors: subprocessorConfig,
  };
}

async function readPrivacyRequests(
  supabase: Awaited<ReturnType<typeof createClient>>,
  recentCutoff: string,
  now: string,
) {
  const { data } = await supabase
    .from("privacy_requests")
    .select("id, user_id, request_type, status, subject, due_at, created_at, resolved_at")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = data ?? [];
  const openRows = rows.filter((row) => !["completed", "rejected", "cancelled"].includes(row.status));

  return {
    completedRecent: rows.filter((row) => row.resolved_at && row.resolved_at >= recentCutoff).length,
    countsByType: rows.reduce<Record<string, number>>((counts, row) => {
      counts[row.request_type] = (counts[row.request_type] ?? 0) + 1;
      return counts;
    }, {}),
    open: openRows.length,
    overdue: openRows.filter((row) => row.due_at && row.due_at < now).length,
    recentOpen: openRows.slice(0, 12).map((row) => ({
      createdAt: row.created_at,
      dueAt: row.due_at,
      id: row.id,
      requestType: row.request_type,
      status: row.status,
      subject: row.subject,
      userId: row.user_id,
    })),
  };
}

async function readIncidents(supabase: Awaited<ReturnType<typeof createClient>>, now: string) {
  const { data } = await supabase
    .from("security_incidents")
    .select("id, severity, status, title, detected_at, notification_deadline_at, regulator_notification_required, user_notification_required")
    .order("detected_at", { ascending: false })
    .limit(100);
  const rows = data ?? [];
  const notificationRows = rows.filter(
    (row) => row.regulator_notification_required || row.user_notification_required,
  );

  return {
    breachNotificationReviewCount: notificationRows.length,
    open: rows.filter((row) => !["resolved", "closed"].includes(row.status)).length,
    overdueNotificationReview: notificationRows.filter(
      (row) => row.notification_deadline_at && row.notification_deadline_at < now,
    ).length,
    recent: rows.slice(0, 8).map((row) => ({
      detectedAt: row.detected_at,
      id: row.id,
      notificationDeadlineAt: row.notification_deadline_at,
      severity: row.severity,
      status: row.status,
      title: row.title,
    })),
  };
}

async function readDataInventory(supabase: Awaited<ReturnType<typeof createClient>>) {
  const inventory = [
    { label: "Profiles", table: "profiles" },
    { label: "Profile facts", table: "profile_facts" },
    { label: "Profile sources", table: "profile_sources" },
    { label: "Job ingestions", table: "job_ingestions" },
    { label: "Applications", table: "applications" },
    { label: "Generated resumes", table: "generated_resumes" },
    { label: "Generated cover letters", table: "generated_cover_letters" },
    { label: "Credit ledger events", table: "credit_ledger" },
    { label: "Privacy requests", table: "privacy_requests" },
    { label: "Security incidents", table: "security_incidents" },
  ];

  return Promise.all(
    inventory.map(async (item) => {
      const { count } = await supabase.from(item.table).select("id", { count: "exact", head: true });

      return {
        ...item,
        count: count ?? 0,
      };
    }),
  );
}
