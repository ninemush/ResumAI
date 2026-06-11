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
        columns: "version_number",
        reason: "artifact versioning and duplicate-output reconciliation",
        table: "generated_resumes",
      },
      {
        columns: "version_number",
        reason: "artifact versioning and duplicate-output reconciliation",
        table: "generated_cover_letters",
      },
      {
        columns: "id",
        reason: "owner access audit evidence",
        table: "admin_access_audit_events",
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
});
