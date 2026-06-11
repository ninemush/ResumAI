import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";

type AuditClient = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>;

export type AdminVisibilityLevel =
  | "aggregate_metrics"
  | "support_metadata"
  | "user_support_context"
  | "sensitive_source_review"
  | "owner_override";

export async function logAdminUserAccess({
  accessReason,
  actorUserId,
  metadata = {},
  resourceId = null,
  resourceType,
  supabase,
  targetUserId,
  visibilityLevel,
}: {
  accessReason: string;
  actorUserId: string;
  metadata?: Record<string, unknown>;
  resourceId?: string | null;
  resourceType: string;
  supabase: AuditClient;
  targetUserId: string | null | undefined;
  visibilityLevel: AdminVisibilityLevel;
}) {
  await logAdminUserAccesses({
    accessReason,
    actorUserId,
    metadata,
    resourceId,
    resourceType,
    supabase,
    targetUserIds: targetUserId ? [targetUserId] : [],
    visibilityLevel,
  });
}

export async function logAdminUserAccesses({
  accessReason,
  actorUserId,
  metadata = {},
  resourceId = null,
  resourceType,
  supabase,
  targetUserIds,
  visibilityLevel,
}: {
  accessReason: string;
  actorUserId: string;
  metadata?: Record<string, unknown>;
  resourceId?: string | null;
  resourceType: string;
  supabase: AuditClient;
  targetUserIds: (string | null | undefined)[];
  visibilityLevel: AdminVisibilityLevel;
}) {
  const uniqueTargetUserIds = Array.from(
    new Set(targetUserIds.filter((targetUserId): targetUserId is string => Boolean(targetUserId))),
  );

  if (uniqueTargetUserIds.length === 0) {
    return;
  }

  const { error } = await supabase.from("admin_access_audit_events").insert(
    uniqueTargetUserIds.map((targetUserId) => ({
      access_reason: accessReason,
      actor_user_id: actorUserId,
      metadata,
      resource_id: resourceId,
      resource_type: resourceType,
      target_user_id: targetUserId,
      visibility_level: visibilityLevel,
    })),
  );

  if (error) {
    throw new Error("ADMIN_ACCESS_AUDIT_FAILED");
  }
}
