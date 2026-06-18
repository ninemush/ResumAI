import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { enrichMasterResumeWithOptionalSourceEvidence } from "@/lib/resumes/master-resume";
import type { ResumeContent } from "@/lib/resumes/resume-content";

describe("master resume optional source enrichment", () => {
  test("maps explicit LinkedIn Projects into Special Projects", () => {
    const enriched = enrichMasterResumeWithOptionalSourceEvidence(buildResume(), [
      {
        created_at: "2026-06-18T00:00:00.000Z",
        extracted_text: `
Public LinkedIn profile source: https://www.linkedin.com/in/sumeet-sangawar/
Projects
Emerging AI Company Advisory: GTM, Product Strategy & Customer Engagement
2020 – 2023
Associated with UiPath
Worked closely with senior leadership at an emerging AI company, including CEO, COO, and product leadership, on GTM strategy, product direction, customer engagement, and presales execution.
Go-to-Market Strategy, Customer Success and +2 skills
Volunteering
BuildOn
        `,
        id: "00000000-0000-4000-8000-000000000001",
        original_filename: null,
        source_type: "linkedin",
        source_url: "https://www.linkedin.com/in/sumeet-sangawar/",
      },
    ]);

    expect(enriched.specialProjects).toEqual([
      {
        bullets: [
          "Worked closely with senior leadership at an emerging AI company, including CEO, COO, and product leadership, on GTM strategy, product direction, customer engagement, and presales execution.",
        ],
        context: "UiPath",
        dates: "2020 - 2023",
        name: "Emerging AI Company Advisory: GTM, Product Strategy & Customer Engagement",
      },
    ]);
  });

  test("does not invent Special Projects when a PDF source has no Projects section", () => {
    const enriched = enrichMasterResumeWithOptionalSourceEvidence(buildResume(), [
      {
        created_at: "2026-06-18T00:00:00.000Z",
        extracted_text: `
About
I am interested in board advisory opportunities with emerging technology companies.
Experience
Global Vice President of Professional Services, GTM & Operations
Contributed a self-initiated AI concept that informed a product capability.
        `,
        id: "00000000-0000-4000-8000-000000000002",
        original_filename: "Profile.pdf",
        source_type: "pdf",
        source_url: null,
      },
    ]);

    expect(enriched.specialProjects).toEqual([]);
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
    experienceBullets: [],
    experienceSections: [
      {
        bullets: ["Led Services GTM operations."],
        company: "UiPath",
        dates: "2022 - Present",
        location: "Dubai",
        roleTitle: "Global Vice President of Professional Services, GTM & Operations",
      },
    ],
    headline: "Transformation Executive",
    keywordGaps: [],
    languages: [],
    reviewerNotes: [],
    skills: ["GTM", "Transformation"],
    specialProjects: [],
    summary: "Technology-led transformation executive.",
    ...overrides,
  };
}
