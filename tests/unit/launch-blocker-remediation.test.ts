import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const root = process.cwd();

function readProjectFile(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("launch blocker remediation controls", () => {
  test("makes credit reservation reuse exact and finalizes output atomically", () => {
    const migration = readProjectFile(
      "supabase/migrations/20260614120000_launch_blocker_credit_atomicity.sql",
    );

    expect(migration).toContain("CREDIT_IDEMPOTENCY_MISMATCH");
    expect(migration).toContain("and v_existing.amount = p_amount");
    expect(migration).toContain("and v_existing.resource_type = p_resource_type");
    expect(migration).toContain("and v_existing.resource_id is not distinct from p_resource_id");
    expect(migration).toContain("finalize_credit_reservation_with_output");
    expect(migration).toContain("insert into public.credit_ledger");
    expect(migration).toContain("insert into public.credit_operation_outputs");
    expect(migration).toContain('drop policy if exists "users can insert own credit operation outputs"');
    expect(migration).toContain('drop policy if exists "users can update own pending credit operation outputs"');
  });

  test("blocks legacy export backfills from reusable/download state", () => {
    const migration = readProjectFile(
      "supabase/migrations/20260614121000_invalidate_legacy_export_backfills.sql",
    );
    const masterResume = readProjectFile("lib/resumes/master-resume.ts");
    const materialReview = readProjectFile("lib/applications/material-review.ts");

    expect(migration).toContain("LEGACY_EXPORT_REVALIDATION_REQUIRED");
    expect(migration).toContain("requiresModernRevalidation");
    expect(masterResume).toContain("isLegacyBackfilledExport");
    expect(materialReview).toContain("isLegacyBackfilledExport");
  });

  test("keeps admin metrics exports rate-limited, audited, and sanitized by default", () => {
    const metricsRoute = readProjectFile("app/api/admin/metrics/route.ts");
    const exportRoute = readProjectFile("app/api/admin/metrics/export/route.ts");
    const ownerMetrics = readProjectFile("lib/admin/owner-metrics.ts");
    const accessAudit = readProjectFile("lib/admin/access-audit.ts");

    expect(metricsRoute).toContain("admin_metrics_read");
    expect(exportRoute).toContain("admin_metrics_export");
    expect(exportRoute).toContain("includeSensitive");
    expect(exportRoute).toContain("admin.metrics_export.sensitive");
    expect(exportRoute).toContain("admin.metrics_export.sanitized");
    expect(exportRoute).toContain("userRef(");
    expect(ownerMetrics).toContain('visibilityLevel: "user_support_context"');
    expect(accessAudit).toContain('visibilityLevel === "user_support_context"');
  });

  test("hides desktop conversation controls on mobile workspace screens", () => {
    const css = readProjectFile("app/globals.css");

    expect(css).toContain(".workspace-shell.workspace-first .conversation-panel-shell");
    expect(css).toContain(".conversation-pane-controls");
    expect(css).toContain(".conversation-collapsed-rail");
    expect(css).toContain(".conversation-resize-handle");
  });

  test("adds source receipts to shared profile intake", () => {
    const intake = readProjectFile("lib/profile/profile-intake.ts");

    expect(intake).toContain("Source receipt: I read");
    expect(intake).toContain("Facts added:");
    expect(intake).toContain("Resume areas affected:");
    expect(intake).toContain("Missing details:");
    expect(intake).toContain("Next best action:");
  });
});
