import { expect, test } from "@playwright/test";

import {
  createServiceRoleClient,
  hasServiceRoleFixtureEnv,
} from "./helpers/launch-fixtures";

test.describe("Supabase schema readiness maturity", () => {
  test.skip(
    !hasServiceRoleFixtureEnv(),
    "Launch readiness gate and service-role Supabase access are required for schema drift evidence.",
  );

  test("proves launch-required artifact and owner audit schema exists", async () => {
    const admin = createServiceRoleClient();
    const requiredReads = [
      {
        columns:
          "version_number, export_status, export_validation, export_validated_at, export_failed_reason, claim_review_acknowledged_at, claim_review_acknowledgement",
        reason: "artifact versioning, validation states, and export-time claim acknowledgement",
        table: "generated_resumes",
      },
      {
        columns:
          "version_number, export_status, export_validation, export_validated_at, export_failed_reason, claim_review_acknowledged_at, claim_review_acknowledgement",
        reason: "artifact versioning, validation states, and export-time claim acknowledgement",
        table: "generated_cover_letters",
      },
      {
        columns: "id",
        reason: "owner access audit evidence",
        table: "admin_access_audit_events",
      },
      {
        columns: "feature, operation_key, output_ids",
        reason: "durable credit operation output tracing",
        table: "credit_operation_outputs",
      },
      {
        columns: "provider_reference, reason, user_notice_sent",
        reason: "refund and reversal reconciliation evidence",
        table: "credit_reversals",
      },
    ];
    const failures: string[] = [];

    for (const requiredRead of requiredReads) {
      const { error } = await admin
        .from(requiredRead.table)
        .select(requiredRead.columns)
        .limit(1);

      if (error) {
        failures.push(
          `${requiredRead.table}.${requiredRead.columns} missing for ${requiredRead.reason}: ${error.message}`,
        );
      }
    }

    expect(failures).toEqual([]);
  });

  test("proves owner and stale reservation operational functions exist", async () => {
    const admin = createServiceRoleClient();
    const ownerProbe = await admin.rpc("is_owner");
    const staleCleanupProbe = await admin.rpc("cleanup_stale_credit_reservations");

    expect(ownerProbe.error).toBeNull();
    expect(typeof ownerProbe.data).toBe("boolean");
    expect(staleCleanupProbe.error).toBeNull();
    expect(staleCleanupProbe.data).toMatchObject({
      affectedFeatureTotals: expect.any(Object),
      expiredCount: expect.any(Number),
      releasedCount: expect.any(Number),
    });
  });
});
