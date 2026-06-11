import { describe, expect, test } from "vitest";

import { isUnavailableJobPostingRedirect } from "@/lib/jobs/job-url-diagnostics";

describe("job URL diagnostics", () => {
  test("detects Greenhouse specific-post redirects to generic board error pages", () => {
    expect(
      isUnavailableJobPostingRedirect({
        requestedUrl: "https://job-boards.greenhouse.io/assetwatch/jobs/4674217005?gh_src=test",
        resolvedUrl: "https://job-boards.greenhouse.io/assetwatch?error=true",
      }),
    ).toBe(true);
  });

  test("keeps valid Greenhouse job URLs ingestible", () => {
    expect(
      isUnavailableJobPostingRedirect({
        requestedUrl: "https://job-boards.greenhouse.io/assetwatch/jobs/4674217005",
        resolvedUrl: "https://job-boards.greenhouse.io/assetwatch/jobs/4674217005",
      }),
    ).toBe(false);
  });

  test("does not classify unrelated provider redirects as Greenhouse posting failures", () => {
    expect(
      isUnavailableJobPostingRedirect({
        requestedUrl: "https://example.com/jobs/123",
        resolvedUrl: "https://example.com/careers",
      }),
    ).toBe(false);
  });
});
