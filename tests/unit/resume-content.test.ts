import { describe, expect, test } from "vitest";

import { normalizeResumeContent } from "@/lib/resumes/resume-content";

describe("resume content normalization", () => {
  test("removes generated placeholder bullets and testimonials from resume content", () => {
    const normalized = normalizeResumeContent({
      certifications: [],
      contact: {},
      education: [],
      experienceBullets: [
        "Held a leadership role. Add measurable scope and outcomes.",
        "Scaled regional operations across 4 countries while reducing cycle time by 18%.",
        "I had the pleasure of working with this excellent professional.",
      ],
      experienceSections: [
        {
          bullets: [
            "Managed a 35-person delivery team across enterprise transformation programs.",
            "Recommendation: one of the best leaders I worked with.",
          ],
          company: "Example Group",
          dates: "2021 - Present",
          location: "Dubai",
          roleTitle: "Director of Operations",
        },
      ],
      headline: "  Director of Operations  ",
      keywordGaps: [],
      reviewerNotes: [],
      skills: [" Operations ", "Portfolio Governance"],
      summary: "  Operations leader with enterprise transformation scope.  ",
    });

    expect(normalized.experienceBullets).toEqual([
      "Scaled regional operations across 4 countries while reducing cycle time by 18%.",
    ]);
    expect(normalized.experienceSections[0]?.bullets).toEqual([
      "Managed a 35-person delivery team across enterprise transformation programs.",
    ]);
    expect(normalized.headline).toBe("Director of Operations");
    expect(normalized.skills).toEqual(["Operations", "Portfolio Governance"]);
  });

  test("deduplicates experience sections that describe the same role", () => {
    const normalized = normalizeResumeContent({
      certifications: [],
      contact: {},
      education: [],
      experienceBullets: [],
      experienceSections: [
        {
          bullets: ["Led operating model redesign across shared services."],
          company: "Example Group",
          dates: "2020 - 2023",
          location: "Dubai",
          roleTitle: "Head of Operations",
        },
        {
          bullets: ["Reduced reporting cycle time by 20%."],
          company: "Example Group",
          dates: "2020 - 2023",
          location: "Dubai",
          roleTitle: "Head of Operations",
        },
      ],
      headline: "Head of Operations",
      keywordGaps: [],
      reviewerNotes: [],
      skills: ["Operations"],
      summary: "Operations leader.",
    });

    expect(normalized.experienceSections).toHaveLength(1);
    expect(normalized.experienceSections[0]?.bullets).toEqual([
      "Led operating model redesign across shared services.",
      "Reduced reporting cycle time by 20%.",
    ]);
  });

  test("keeps Special Projects limited to actual project evidence", () => {
    const normalized = normalizeResumeContent({
      certifications: [
        {
          date: "2024",
          issuer: "PMI",
          name: "PMP",
        },
      ],
      contact: {},
      education: [
        {
          credential: "MBA",
          dates: "2018",
          institution: "Example University",
          location: "Dubai",
        },
      ],
      experienceBullets: [
        "Improved warehouse throughput by 22% across a 40-person operation.",
      ],
      experienceSections: [
        {
          bullets: ["Led daily operations for inbound, outbound, and inventory teams."],
          company: "Northstar Logistics",
          dates: "2021 - Present",
          location: "Dubai",
          roleTitle: "Operations Manager",
        },
      ],
      headline: "Operations Manager",
      keywordGaps: [],
      languages: [
        {
          name: "English",
          proficiency: "Professional",
        },
      ],
      reviewerNotes: [],
      skills: ["Operations", "WMS"],
      specialProjects: [
        {
          bullets: ["Recommendation: she is an excellent professional and trusted colleague."],
          context: "LinkedIn recommendations",
          dates: null,
          name: "Recommendations received",
        },
        {
          bullets: ["Improved cycle counts and reduced inventory variance by 18%."],
          context: "Northstar Logistics",
          dates: "2023",
          name: "WMS rollout project",
        },
        {
          bullets: ["Senior operations leader with strong people management experience."],
          context: null,
          dates: null,
          name: "Professional summary",
        },
      ],
      summary: "Operations leader with logistics and warehouse transformation evidence.",
    });

    expect(normalized.specialProjects).toEqual([
      {
        bullets: ["Improved cycle counts and reduced inventory variance by 18%."],
        context: "Northstar Logistics",
        dates: "2023",
        name: "WMS rollout project",
      },
    ]);
    expect(normalized.education).toHaveLength(1);
    expect(normalized.languages).toHaveLength(1);
    expect(normalized.certifications).toHaveLength(1);
    expect(normalized.experienceSections).toHaveLength(1);
  });

  test("removes special project bullets that duplicate the project title", () => {
    const normalized = normalizeResumeContent({
      certifications: [],
      contact: {},
      education: [],
      experienceBullets: [],
      experienceSections: [
        {
          bullets: ["Led the operating model workstream for a regional rollout."],
          company: "Example Group",
          dates: "2021 - Present",
          location: "Dubai",
          roleTitle: "Operations Lead",
        },
      ],
      headline: "Operations Lead",
      keywordGaps: [],
      reviewerNotes: [],
      skills: ["Operations"],
      specialProjects: [
        {
          bullets: [
            "WMS rollout project",
            "Led the WMS rollout across warehouse teams and coordinated adoption.",
          ],
          context: "Example Group",
          dates: "2023",
          name: "WMS rollout project",
        },
      ],
      summary: "Operations leader.",
    });

    expect(normalized.specialProjects).toEqual([
      {
        bullets: ["Led the WMS rollout across warehouse teams and coordinated adoption."],
        context: "Example Group",
        dates: "2023",
        name: "WMS rollout project",
      },
    ]);
  });

  test("removes special project bullets that duplicate experience bullets", () => {
    const normalized = normalizeResumeContent({
      certifications: [],
      contact: {},
      education: [],
      experienceBullets: [],
      experienceSections: [
        {
          bullets: [
            "Worked closely with senior leadership at an emerging AI company on GTM strategy, product direction, customer engagement, and presales execution.",
          ],
          company: "UiPath",
          dates: "2020 - 2023",
          location: null,
          roleTitle: "Global Services GTM Leader",
        },
      ],
      headline: "Transformation Executive",
      keywordGaps: [],
      reviewerNotes: [],
      skills: ["GTM"],
      specialProjects: [
        {
          bullets: [
            "Worked closely with senior leadership at an emerging AI company on GTM strategy, product direction, customer engagement, and presales execution.",
          ],
          context: "UiPath",
          dates: "2020 - 2023",
          name: "Emerging AI Company Advisory: GTM, Product Strategy & Customer Engagement",
        },
      ],
      summary: "Technology-led transformation executive.",
    });

    expect(normalized.specialProjects).toEqual([]);
  });

  test("rejects broad project-like labels without action and provenance", () => {
    const normalized = normalizeResumeContent({
      certifications: [],
      contact: {},
      education: [],
      experienceBullets: ["Managed operations planning across regional teams."],
      experienceSections: [],
      headline: "Operations Manager",
      keywordGaps: [],
      reviewerNotes: [],
      skills: ["Operations"],
      specialProjects: [
        {
          bullets: ["Portfolio of operational excellence and leadership achievements."],
          context: null,
          dates: null,
          name: "Leadership portfolio",
        },
        {
          bullets: ["Implemented scheduling automation and improved weekly planning handoffs."],
          context: null,
          dates: null,
          name: "Scheduling automation project",
        },
      ],
      summary: "Operations manager.",
    });

    expect(normalized.specialProjects).toEqual([]);
  });
});
