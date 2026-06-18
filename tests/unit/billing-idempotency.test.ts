import { describe, expect, test } from "vitest";

import { createIdempotencyHeaders, createIdempotencyKey } from "@/lib/billing/idempotency";
import { buildOperationFingerprint } from "@/lib/security/operation-fingerprint";

describe("billing idempotency headers", () => {
  test("creates a safe operation key header for paid client actions", () => {
    const headers = createIdempotencyHeaders("master resume generate / focused variant") as Record<
      string,
      string
    >;
    const key = headers["Idempotency-Key"];

    expect(key).toMatch(/^master-resume-generate-\/-focused-variant:[A-Za-z0-9-]+/);
    expect(key).toMatch(/^[A-Za-z0-9._:/=-]+$/);
    expect(key).not.toContain(" ");
  });

  test("can reuse a stable operation id for retry-safe duplicate UI actions", () => {
    const first = createIdempotencyKey("application materials export", "pending click 123");
    const second = createIdempotencyKey("application materials export", "pending click 123");
    const third = createIdempotencyKey("application materials export", "pending click 456");

    expect(first).toBe(second);
    expect(first).toMatch(/^application-materials-export:pending-click-123$/);
    expect(third).toMatch(/^application-materials-export:pending-click-456$/);
    expect(third).not.toBe(first);
  });

  test("keeps implicit operation keys unique so unrelated actions do not collapse", () => {
    const first = createIdempotencyKey("masterResumeGenerate:resume-panel");
    const second = createIdempotencyKey("masterResumeGenerate:resume-panel");

    expect(first).not.toBe(second);
  });
});

describe("server operation fingerprints", () => {
  test("are stable for equivalent canonical input", () => {
    const first = buildOperationFingerprint({
      basis: {
        instruction: "  Focus on platform work. ",
        promptVersion: "master-resume.v8",
        sourceIds: ["b", "a"].sort(),
      },
      feature: "masterResumeGenerate",
      operationKey: "retry-key-1",
      resourceId: null,
      resourceType: "master_resume",
      userId: "user-123",
    });
    const second = buildOperationFingerprint({
      basis: {
        sourceIds: ["a", "b"],
        promptVersion: "master-resume.v8",
        instruction: "Focus on platform work.",
      },
      feature: "masterResumeGenerate",
      operationKey: "retry-key-1",
      resourceId: null,
      resourceType: "master_resume",
      userId: "user-123",
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  test("change when meaningful paid input changes", () => {
    const first = buildOperationFingerprint({
      basis: { instruction: "Focus on platform work." },
      feature: "masterResumeGenerate",
      operationKey: "retry-key-1",
      resourceId: null,
      resourceType: "master_resume",
      userId: "user-123",
    });
    const second = buildOperationFingerprint({
      basis: { instruction: "Focus on finance controls." },
      feature: "masterResumeGenerate",
      operationKey: "retry-key-1",
      resourceId: null,
      resourceType: "master_resume",
      userId: "user-123",
    });

    expect(first).not.toBe(second);
  });
});
