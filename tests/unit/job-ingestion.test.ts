import { describe, expect, test } from "vitest";

import { cleanJobCompany, cleanJobTitle, readJobMetadataFromTitle } from "@/lib/jobs/job-metadata";

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

  test("extracts LinkedIn hiring page titles into actual role metadata", () => {
    expect(
      cleanJobTitle(
        "Charterhouse Middle East hiring Head of AI & Automation in Dubai, United Arab Emirates | LinkedIn",
      ),
    ).toBe("Head of AI & Automation");
    expect(
      readJobMetadataFromTitle(
        "Charterhouse Middle East hiring Head of AI & Automation in Dubai, United Arab Emirates | LinkedIn",
      ),
    ).toEqual({
      company: "Charterhouse Middle East",
      title: "Head of AI & Automation",
    });
  });

  test("keeps company names clean for application packets", () => {
    expect(cleanJobCompany("Example &amp; Co")).toBe("Example & Co");
    expect(cleanJobCompany("LinkedIn")).toBeNull();
  });
});
