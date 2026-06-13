import { describe, expect, test } from "vitest";

import {
  applyResumeExportSectionVisibility,
  buildResumeExportChecklist,
  getResumeOptionalSectionStates,
  isDefaultResumeExportSectionVisibility,
  normalizeResumeExportSectionVisibility,
} from "@/lib/resumes/export-readiness";
import type { ResumeContent } from "@/lib/resumes/resume-content";

describe("resume export readiness", () => {
  test("marks a complete resume ready while surfacing optional sections", () => {
    const resume = buildResume({
      certifications: [{ date: "2025", issuer: "Example", name: "Launch Certification" }],
      education: [{ credential: "MBA", dates: "2020", institution: "Example University", location: "Dubai" }],
      languages: [{ name: "Arabic", proficiency: "Conversational" }],
      specialProjects: [{ bullets: ["Led launch program."], context: "Example Co", dates: "2024", name: "Launch OS" }],
    });

    expect(buildResumeExportChecklist({ resume })).toEqual([
      expect.objectContaining({ id: "core-content", status: "ready" }),
      expect.objectContaining({ id: "role-timeline", status: "ready" }),
      expect.objectContaining({ id: "claim-review", status: "ready" }),
      expect.objectContaining({
        detail:
          "Included: Selected Highlights, Special Projects, Languages, Education, Certifications.",
        id: "optional-sections",
        status: "ready",
      }),
    ]);
  });

  test("treats missing role metadata as a warning, not an export blocker", () => {
    const resume = buildResume({
      experienceSections: [
        {
          bullets: ["Built launch workflows from confirmed source notes."],
          company: "",
          dates: "",
          location: null,
          roleTitle: "Product Lead",
        },
      ],
    });

    const checklist = buildResumeExportChecklist({ resume });

    expect(checklist.find((item) => item.id === "role-timeline")).toEqual(
      expect.objectContaining({
        detail: "3 role metadata items should be reviewed before export.",
        status: "warning",
      }),
    );
  });

  test("blocks unresolved high-impact reviewer notes", () => {
    const checklist = buildResumeExportChecklist({
      resume: buildResume({
        reviewerNotes: ["Verify employer before export: Example Bank"],
      }),
    });

    expect(checklist.find((item) => item.id === "claim-review")).toEqual(
      expect.objectContaining({
        detail: "1 high-impact claim needs acknowledgement.",
        status: "blocked",
      }),
    );
  });

  test("counts optional sections without dropping empty entries", () => {
    expect(
      getResumeOptionalSectionStates(
        buildResume({
          certifications: [{ date: "", issuer: "", name: "" }],
          education: [{ credential: "", dates: "", institution: "", location: "" }],
          languages: [{ name: "", proficiency: "" }],
          specialProjects: [{ bullets: [""], context: "", dates: "", name: "" }],
        }),
      ),
    ).toEqual([
      expect.objectContaining({ count: 1, id: "highlights" }),
      expect.objectContaining({ count: 0, id: "specialProjects" }),
      expect.objectContaining({ count: 0, id: "languages" }),
      expect.objectContaining({ count: 0, id: "education" }),
      expect.objectContaining({ count: 0, id: "certifications" }),
    ]);
  });

  test("normalizes and applies export section visibility", () => {
    const visibility = normalizeResumeExportSectionVisibility({
      certifications: false,
      education: true,
      highlights: false,
      languages: false,
      specialProjects: true,
    });
    const resume = buildResume({
      certifications: [{ date: "2025", issuer: "Example", name: "Launch Certification" }],
      education: [{ credential: "MBA", dates: "2020", institution: "Example University", location: "Dubai" }],
      languages: [{ name: "Arabic", proficiency: "Conversational" }],
      specialProjects: [{ bullets: ["Led launch program."], context: "Example Co", dates: "2024", name: "Launch OS" }],
    });

    expect(isDefaultResumeExportSectionVisibility(visibility)).toBe(false);
    expect(applyResumeExportSectionVisibility(resume, visibility)).toEqual(
      expect.objectContaining({
        certifications: [],
        education: resume.education,
        experienceBullets: [],
        languages: [],
        specialProjects: resume.specialProjects,
      }),
    );
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
        location: "Dubai",
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
