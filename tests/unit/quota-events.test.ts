import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildJobIngestionOperationKey,
  buildQuotaOperationKey,
} from "@/lib/quota/operation-key";

describe("quota operation keys", () => {
  test("builds stable quota keys from a quota event and durable resource id", () => {
    const key = buildQuotaOperationKey({
      eventType: "generation_created",
      resourceId: "1f76e7d9-44f1-4d77-9465-ec6ae8579af4",
      resourceType: "master_resume",
    });

    expect(key).toBe(
      "generation_created:master_resume:1f76e7d9-44f1-4d77-9465-ec6ae8579af4",
    );
  });

  test("keeps operation keys within the database limit", () => {
    const key = buildQuotaOperationKey({
      eventType: "application_logged",
      resourceId: "1f76e7d9-44f1-4d77-9465-ec6ae8579af4",
      resourceType: "application".repeat(40),
    });

    expect(key.length).toBeLessThanOrEqual(180);
  });

  test("hashes manual job ingestion keys from normalized source type and text", () => {
    const first = buildJobIngestionOperationKey({
      sourceType: "manual_paste",
      jobText: " Senior Product Lead\n\nOwn AI workflow delivery. ",
    });
    const second = buildJobIngestionOperationKey({
      sourceType: "manual_paste",
      jobText: "senior product lead own ai workflow delivery.",
    });
    const different = buildJobIngestionOperationKey({
      sourceType: "manual_paste",
      jobText: "Finance operations manager with SOX controls.",
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^jobIngest:[a-f0-9]{64}$/);
    expect(first).not.toContain("Senior Product Lead");
    expect(different).not.toBe(first);
  });

  test("launch migration rejects same quota key for different operation fingerprints", () => {
    const guardMigration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260617120000_add_operation_fingerprint_guards.sql",
      ),
      "utf8",
    );
    const requiredFingerprintMigration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260618120000_require_operation_fingerprints_for_new_reservations.sql",
      ),
      "utf8",
    );

    expect(guardMigration).toContain("operation_fingerprint");
    expect(guardMigration).toContain("QUOTA_IDEMPOTENCY_MISMATCH");
    expect(guardMigration).toContain("CREDIT_IDEMPOTENCY_MISMATCH");
    expect(guardMigration).toContain("p_operation_fingerprint");
    expect(requiredFingerprintMigration).toContain("QUOTA_OPERATION_FINGERPRINT_REQUIRED");
    expect(requiredFingerprintMigration).toContain("CREDIT_OPERATION_FINGERPRINT_REQUIRED");
    expect(requiredFingerprintMigration).toContain(
      "credit_reservations_require_operation_fingerprint",
    );
    expect(requiredFingerprintMigration).toContain(
      "quota_reservations_require_operation_fingerprint",
    );
  });
});
