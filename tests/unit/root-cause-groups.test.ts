import { describe, expect, test } from "vitest";

import {
  buildRootCauseGroups,
  readRootCauseQueueStatus,
  type RootCauseSignal,
} from "@/lib/support/root-cause-groups";

describe("root cause groups", () => {
  test("keeps guidance-only error signals out of the open queue", () => {
    const signals: RootCauseSignal[] = [
      {
        area: "job_ingestion",
        code: "JOB_UNSUPPORTED_CONTENT_TYPE",
        createdAt: "2026-06-11T00:00:00.000Z",
        fixRequired: false,
        id: "guidance-error",
        rootCause: "unsupported_site",
        rootCauseCategory: "unsupported_site",
        source: "error",
        status: "open",
        summary: "https://www.google.com/robots.txt",
        userEmail: "qa@example.com",
      },
    ];

    const [group] = buildRootCauseGroups(signals);

    expect(group.activeErrors).toBe(0);
    expect(group.resolvedSignals).toBe(1);
    expect(readRootCauseQueueStatus(group)).toBe("history");
  });

  test("keeps unresolved fix-required errors in the open queue", () => {
    const signals: RootCauseSignal[] = [
      {
        area: "profile_intake",
        code: "PROFILE_PROVIDER_FAILED",
        createdAt: "2026-06-11T00:00:00.000Z",
        fixRequired: true,
        id: "active-error",
        rootCause: "provider_failure",
        rootCauseCategory: "provider_failure",
        source: "error",
        status: "open",
        summary: "OCR provider failed after retrying.",
      },
    ];

    const [group] = buildRootCauseGroups(signals);

    expect(group.activeErrors).toBe(1);
    expect(readRootCauseQueueStatus(group)).toBe("open");
  });
});
