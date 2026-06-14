import { describe, expect, test } from "vitest";

import {
  buildSupportedEvidenceCorpus,
  reviewCoverLetterClaimProvenance,
  reviewResumeClaimProvenance,
} from "@/lib/ai/claim-provenance";
import { normalizeResumeContent } from "@/lib/resumes/resume-content";

describe("claim provenance review", () => {
  test("moves unsupported high-risk resume claims into reviewer notes", () => {
    const evidenceCorpus = buildSupportedEvidenceCorpus([
      {
        status: "user_confirmed",
        text: "Operations Manager at Northstar Logistics from 2020 to 2023. Led warehouse modernization.",
        userConfirmed: true,
      },
    ]);
    const resume = normalizeResumeContent({
      certifications: [{ date: "2024", issuer: "Cloud Org", name: "AWS Architect" }],
      contact: {},
      education: [{ credential: "MBA", dates: "2018", institution: "Fictional Business School", location: null }],
      experienceBullets: ["Led warehouse modernization."],
      experienceSections: [
        {
          bullets: ["Increased revenue 45% across five countries."],
          company: "Invented Employer",
          dates: "2019",
          location: null,
          roleTitle: "Chief Revenue Officer",
        },
        {
          bullets: ["Led warehouse modernization."],
          company: "Northstar Logistics",
          dates: "2020 to 2023",
          location: null,
          roleTitle: "Operations Manager",
        },
      ],
      headline: "Operations leader",
      keywordGaps: [],
      languages: [{ name: "Japanese", proficiency: "Native" }],
      reviewerNotes: [],
      skills: ["Operations"],
      specialProjects: [],
      summary: "Operations leader.",
    });

    const reviewed = reviewResumeClaimProvenance({ evidenceCorpus, resume });

    expect(reviewed.experienceSections).toHaveLength(1);
    expect(reviewed.experienceSections[0].company).toBe("Northstar Logistics");
    expect(reviewed.certifications).toHaveLength(0);
    expect(reviewed.education).toHaveLength(0);
    expect(reviewed.languages).toHaveLength(0);
    expect(reviewed.reviewerNotes.join(" ")).toContain("Verify role title before export");
    expect(reviewed.reviewerNotes.join(" ")).toContain("AWS Architect");
  });

  test("flags unsupported high-risk cover-letter claims", () => {
    const evidenceCorpus = buildSupportedEvidenceCorpus([
      {
        status: "user_confirmed",
        text: "Operations Manager at Northstar Logistics from 2020 to 2023. Led warehouse modernization.",
        userConfirmed: true,
      },
    ]);
    const review = reviewCoverLetterClaimProvenance({
      coverLetter:
        "I am excited to apply. As Director of Strategy at Invented Employer, I increased revenue 45% across five countries and hold an MBA from Fictional Business School.",
      evidenceCorpus,
    });

    expect(review.claimRisks.map((risk) => risk.category)).toEqual(
      expect.arrayContaining(["education", "employer", "numeric_achievement", "seniority"]),
    );
    expect(review.reviewerNotes.join(" ")).toContain("Verify numeric achievement before export");
  });

  test("does not trust high-impact imported facts without strong evidence metadata", () => {
    const evidenceCorpus = buildSupportedEvidenceCorpus([
      {
        confidence: 0.52,
        label: "role_title",
        sourceIds: ["source-1"],
        status: "source_supported",
        text: "Chief Revenue Officer at Invented Employer",
        userConfirmed: false,
      },
      {
        confidence: 0.54,
        label: "metric",
        sourceIds: ["source-1"],
        status: "source_supported",
        text: "Increased revenue 45%",
        userConfirmed: false,
      },
    ]);
    const resume = normalizeResumeContent({
      certifications: [],
      contact: {},
      education: [],
      experienceBullets: ["Increased revenue 45%."],
      experienceSections: [
        {
          bullets: ["Increased revenue 45%."],
          company: "Invented Employer",
          dates: null,
          location: null,
          roleTitle: "Chief Revenue Officer",
        },
      ],
      headline: "Revenue executive",
      keywordGaps: [],
      languages: [],
      reviewerNotes: [],
      skills: ["Revenue"],
      specialProjects: [],
      summary: "Revenue executive.",
    });

    const reviewed = reviewResumeClaimProvenance({ evidenceCorpus, resume });

    expect(reviewed.experienceSections).toHaveLength(0);
    expect(reviewed.reviewerNotes.join(" ")).toContain("Chief Revenue Officer");
  });

  test("rejects near-match high-impact title and employer claims", () => {
    const evidenceCorpus = buildSupportedEvidenceCorpus([
      {
        status: "user_confirmed",
        text: "Product Manager at Northstar Logistics. Led launch operations.",
        userConfirmed: true,
      },
    ]);
    const resume = normalizeResumeContent({
      certifications: [],
      contact: {},
      education: [],
      experienceBullets: [],
      experienceSections: [
        {
          bullets: ["Led launch operations."],
          company: "Northstar Logistics International",
          dates: null,
          location: null,
          roleTitle: "Senior Product Manager",
        },
      ],
      headline: "Product leader",
      keywordGaps: [],
      languages: [],
      reviewerNotes: [],
      skills: ["Launch operations"],
      specialProjects: [],
      summary: "Product leader.",
    });

    const reviewed = reviewResumeClaimProvenance({ evidenceCorpus, resume });

    expect(reviewed.experienceSections).toHaveLength(0);
    expect(reviewed.reviewerNotes.join(" ")).toContain("Senior Product Manager");
    expect(reviewed.reviewerNotes.join(" ")).toContain("Northstar Logistics International");
  });
});
