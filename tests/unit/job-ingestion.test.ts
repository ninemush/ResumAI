import { describe, expect, test } from "vitest";

import { cleanJobCompany, cleanJobTitle } from "@/lib/jobs/job-metadata";

describe("job ingestion metadata cleanup", () => {
  test("removes scraped site noise and decodes job titles", () => {
    expect(cleanJobTitle("Senior Product Manager &amp; AI Lead | LinkedIn")).toBe(
      "Senior Product Manager & AI Lead",
    );
    expect(cleanJobTitle("linkedin.com | LinkedIn")).toBeNull();
    expect(cleanJobTitle("Job Details - Director of Operations - Careers")).toBe(
      "Director of Operations",
    );
  });

  test("keeps company names clean for application packets", () => {
    expect(cleanJobCompany("Example &amp; Co")).toBe("Example & Co");
    expect(cleanJobCompany("LinkedIn")).toBeNull();
  });
});
