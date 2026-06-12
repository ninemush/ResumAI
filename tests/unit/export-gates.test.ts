import { describe, expect, test } from "vitest";

import {
  ClaimReviewRequiredError,
  classifyResumeExportRisks,
  getBlockingExportRisks,
  hasBlockingExportRisks,
} from "@/lib/applications/export-gates";
import type { ResumeContent } from "@/lib/resumes/resume-content";

describe("export gates", () => {
  test("blocks unresolved high-impact claim review notes", () => {
    const resume = buildResume({
      reviewerNotes: ["Verify employer before export: Example Bank"],
    });

    expect(hasBlockingExportRisks(resume)).toBe(true);
    expect(classifyResumeExportRisks(resume)).toEqual([
      {
        category: "reviewer_note",
        severity: "high",
        text: "Verify employer before export: Example Bank",
      },
    ]);
    expect(getBlockingExportRisks(resume)).toHaveLength(1);
  });

  test("allows low-impact keyword notes to remain warnings", () => {
    const resume = buildResume({
      keywordGaps: ["Add more product terminology if relevant"],
    });

    expect(hasBlockingExportRisks(resume)).toBe(false);
    expect(classifyResumeExportRisks(resume)).toEqual([
      {
        category: "keyword_gap",
        severity: "medium",
        text: "Add more product terminology if relevant",
      },
    ]);
  });

  test("carries unresolved claim review items through the export error", () => {
    const risks = getBlockingExportRisks(
      buildResume({
        reviewerNotes: ["Verify director title and exact dates before export."],
      }),
    );
    const error = new ClaimReviewRequiredError("MASTER_RESUME_CLAIM_REVIEW_REQUIRED", risks);

    expect(error.message).toBe("MASTER_RESUME_CLAIM_REVIEW_REQUIRED");
    expect(error.risks).toEqual(risks);
    expect(error.risks[0]?.severity).toBe("high");
  });
});

function buildResume(overrides: Partial<ResumeContent> = {}): ResumeContent {
  return {
    certifications: [],
    contact: {
      email: null,
      linkedin: null,
      location: null,
      phone: null,
      website: null,
    },
    education: [],
    experienceBullets: ["Built launch workflows from confirmed source notes."],
    experienceSections: [
      {
        bullets: ["Built launch workflows from confirmed source notes."],
        company: "Example Co",
        dates: "2024",
        location: null,
        roleTitle: "Product Lead",
      },
    ],
    headline: "Product Lead",
    keywordGaps: [],
    languages: [],
    reviewerNotes: [],
    skills: ["Product"],
    specialProjects: [],
    summary: "Product lead with launch workflow experience.",
    ...overrides,
  };
}
