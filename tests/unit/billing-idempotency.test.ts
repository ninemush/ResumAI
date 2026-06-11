import { describe, expect, test } from "vitest";

import { createIdempotencyHeaders } from "@/lib/billing/idempotency";

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
});
