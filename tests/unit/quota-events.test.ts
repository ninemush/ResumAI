import { describe, expect, test } from "vitest";

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
});
