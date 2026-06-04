import { expect, test } from "@playwright/test";

import { normalizeResumeContent } from "@/lib/resumes/resume-content";
import { extractExperienceSectionsFromText } from "@/lib/resumes/source-experience";

const linkedInExportText = `
Contact
candidate@example.com
Summary
Enterprise transformation leader with global services, GTM, operations, AI automation, and board advisory experience.

Experience
AutomationCo
7 years 5 months
Global Vice President of Professional Services, GTM & Operations
June 2022 - Present
Dubai, United Arab Emirates
Led global Services GTM and operations across portfolio, pricing, sales engagement, reporting, governance, enablement, and execution.
Scaled the services business at 15%+ CAGR while improving services profitability by 10+ percentage points.
Reduced deployment time and cost by 50%+ through a self-initiated AI concept.
Established global operating frameworks for services engagement and portfolio management.

Senior Director Professional Services, Global GTM & Operations
Feb 2022 - Jun 2022
Dubai, United Arab Emirates
Built planning, pipeline, and forecasting routines for a global professional services organization.
Improved execution discipline across regional services leadership and finance stakeholders.

Senior Director Professional Services, EMEA
Jun 2020 - Feb 2022
Dubai, United Arab Emirates
Scaled EMEA Professional Services revenue approximately 100x over three years.
Built a lean GTM team focused on customer outcomes, execution quality, and revenue growth.

Director of Customer Success - MEA & EECIS
Jan 2019 - Jun 2020
Dubai, United Arab Emirates
Supported 30 strategic customers and built scalable programs for 800+ customers.
Increased revenue by 100% year over year while maintaining NPS above 90.

IndustrialCo
6 years 4 months
CIO - MEA, Turkey & Global Supplier MDM
Feb 2016 - Jan 2019
Dubai, United Arab Emirates
Consolidated ERP and supplier master data across regional operations.
Improved data quality for more than 50K supplier records and strengthened governance controls.

Digital Hub Leader - Saudi
Feb 2016 - Jan 2019
Riyadh, Saudi Arabia
Built a nearly 200-person technology delivery hub with strong quality governance and stakeholder engagement.

Senior Audit Manager
Oct 2012 - Feb 2016
United Arab Emirates
Managed 20 auditors and created automation that improved audit cycle time and risk coverage.

FinanceCo
4 years 11 months
Information Technology Leadership Program
Jul 2010 - Oct 2012
United States
Rotated through infrastructure, risk, and operations leadership assignments.

Information Security Specialist
Nov 2008 - Jun 2010
United States
Strengthened security controls and supported enterprise risk remediation.

Recommendations
Juan Pajon
Global Innovation Customer Success Services Senior Vice President
April 1, 2019, Juan worked with Sumeet on the same team and had the pleasure
to share time at GE with Sumeet. He is an excellent professional and I recommend him.

Education
Example University
`;

test("extracts a LinkedIn-style role timeline without flattening companies or dates", () => {
  const sections = extractExperienceSectionsFromText(linkedInExportText);

  expect(sections.length).toBeGreaterThanOrEqual(8);
  expect(sections[0]).toMatchObject({
    company: "AutomationCo",
    dates: "June 2022 - Present",
    location: "Dubai, United Arab Emirates",
    roleTitle: "Global Vice President of Professional Services, GTM & Operations",
  });
  expect(sections[0].bullets.join(" ")).toMatch(/15%\+ CAGR|50%\+/);
  expect(sections.map((section) => section.company)).toEqual(
    expect.arrayContaining(["AutomationCo", "IndustrialCo", "FinanceCo"]),
  );
  expect(sections.map((section) => section.roleTitle)).toEqual(
    expect.arrayContaining([
      "Senior Director Professional Services, EMEA",
      "CIO - MEA, Turkey & Global Supplier MDM",
      "Information Security Specialist",
    ]),
  );
  expect(sections.map((section) => section.roleTitle)).not.toContain(
    "Global Innovation Customer Success Services Senior Vice President",
  );
  expect(JSON.stringify(sections)).not.toMatch(/Juan Pajon|worked with Sumeet|recommend/i);
});

test("does not fabricate placeholder bullets for sparse source roles", () => {
  const sections = extractExperienceSectionsFromText(`
Experience
GE Capital
Information Security Specialist
November 2008 - June 20
United States

Education
Example University
`);

  expect(sections).toHaveLength(1);
  expect(sections[0]).toMatchObject({
    bullets: [],
    company: "GE Capital",
    dates: null,
    roleTitle: "Information Security Specialist",
  });
  expect(JSON.stringify(sections)).not.toMatch(/Add measurable scope and outcomes|Held Information Security Specialist/i);
});

test("keeps internal resume UI labels out of generated resume content", () => {
  const normalized = normalizeResumeContent({
    contact: {
      email: "candidate@example.com",
      linkedin: "https://www.linkedin.com/in/example",
      location: "Dubai",
      phone: null,
      website: null,
    },
    experienceBullets: [],
    experienceSections: [
      {
        bullets: ["Owned global services operations and improved profitability."],
        company: "AutomationCo",
        dates: "June 2022 - Present",
        location: "Dubai",
        roleTitle: "Master ATS Resume: Global VP",
      },
      {
        bullets: ["Juan worked with Sumeet on the same team and recommended him."],
        company: "Juan Pajon",
        dates: "April 1, 2019, Juan worked with Sumeet on the same team",
        location: null,
        roleTitle: "Global Innovation Customer Success Services Senior Vice President",
      },
    ],
    headline: "Master ATS Resume: Enterprise Transformation Executive | GTM",
    keywordGaps: [],
    reviewerNotes: [],
    skills: ["Transformation"],
    summary: "ATS master resume: Builds operating models and measurable value.",
  });

  expect(normalized.headline).toBe("Enterprise Transformation Executive / GTM");
  expect(normalized.contact.linkedin).toBe("https://www.linkedin.com/in/example");
  expect(normalized.summary).toBe("Builds operating models and measurable value.");
  expect(normalized.experienceSections[0].roleTitle).toBe("Global VP");
  expect(normalized.experienceSections).toHaveLength(1);
});

test("deduplicates near-identical role sections without collapsing real progression", () => {
  const normalized = normalizeResumeContent({
    contact: {
      email: "candidate@example.com",
      linkedin: null,
      location: "Dubai",
      phone: null,
      website: null,
    },
    experienceBullets: [],
    experienceSections: [
      {
        bullets: ["Scaled EMEA Professional Services revenue approximately 100x over three years."],
        company: "AutomationCo",
        dates: "Jun 2020 - Feb 2022",
        location: "Dubai",
        roleTitle: "Senior Director Professional Services, EMEA",
      },
      {
        bullets: ["Built a lean GTM team focused on customer outcomes and revenue growth."],
        company: "AutomationCo",
        dates: "June 2020 - February 2022",
        location: "Dubai, United Arab Emirates",
        roleTitle: "Senior Director, Professional Services EMEA",
      },
      {
        bullets: ["Led global Services GTM and operations across portfolio, pricing, and governance."],
        company: "AutomationCo",
        dates: "June 2022 - Present",
        location: "Dubai",
        roleTitle: "Global Vice President of Professional Services, GTM & Operations",
      },
    ],
    headline: "Enterprise Transformation Executive",
    keywordGaps: [],
    reviewerNotes: [],
    skills: ["Transformation"],
    summary: "Builds operating models and measurable value.",
  });

  expect(normalized.experienceSections).toHaveLength(2);
  expect(normalized.experienceSections[0].bullets).toEqual(
    expect.arrayContaining([
      "Scaled EMEA Professional Services revenue approximately 100x over three years.",
      "Built a lean GTM team focused on customer outcomes and revenue growth.",
    ]),
  );
  expect(normalized.experienceSections[1].roleTitle).toBe(
    "Global Vice President of Professional Services, GTM & Operations",
  );
});

test("does not treat employment type labels as companies or duplicate the same role", () => {
  const normalized = normalizeResumeContent({
    contact: {
      email: "candidate@example.com",
      linkedin: null,
      location: "Dubai",
      phone: null,
      website: null,
    },
    experienceBullets: [],
    experienceSections: [
      {
        bullets: [
          "Led frontline IT service desk operations and stakeholder support, building early experience in service delivery, incident management, operational execution, and user experience.",
        ],
        company: "Contract",
        dates: "Dec 2007 - Aug 2009",
        location: null,
        roleTitle: "Information Technology Service Desk Team Lead",
      },
      {
        bullets: [
          "Led frontline IT service desk operations and stakeholder support, building early experience in service delivery, incident management, operational execution, and user experience.",
        ],
        company: "GE Capital",
        dates: "Dec 2007 - Aug 2009",
        location: null,
        roleTitle: "Information Technology Service Desk Team Lead",
      },
    ],
    headline: "Information Technology Leader",
    keywordGaps: [],
    reviewerNotes: [],
    skills: ["IT Service Management"],
    summary: "Builds reliable service delivery operations.",
  });

  expect(normalized.experienceSections).toHaveLength(1);
  expect(normalized.experienceSections[0].company).toBe("GE Capital");
});

test("removes clipped partial date ranges from source-derived roles", () => {
  const normalized = normalizeResumeContent({
    contact: {
      email: "candidate@example.com",
      linkedin: null,
      location: "Dubai",
      phone: null,
      website: null,
    },
    experienceBullets: [],
    experienceSections: [
      {
        bullets: ["Strengthened security controls and supported enterprise risk remediation."],
        company: "GE Capital",
        dates: "November 2008 - June 20",
        location: null,
        roleTitle: "Information Security Specialist",
      },
    ],
    headline: "Information Security Leader",
    keywordGaps: [],
    reviewerNotes: [],
    skills: ["Security Controls"],
    summary: "Builds reliable controls.",
  });

  expect(normalized.experienceSections[0].dates).toBeNull();
});

test("strips legacy generated filler from saved resume JSON", () => {
  const normalized = normalizeResumeContent({
    contact: {
      email: "candidate@example.com",
      linkedin: null,
      location: "Dubai",
      phone: null,
      website: null,
    },
    experienceBullets: [
      "Held Information Security Specialist at GE Capital (November 2008 - June 20). Add measurable scope and outcomes.",
      "Strengthened security controls and supported enterprise risk remediation.",
    ],
    experienceSections: [
      {
        bullets: [
          "Held Information Security Specialist at GE Capital (November 2008 - June 20). Add measurable scope and outcomes.",
        ],
        company: "GE Capital",
        dates: "November 2008 - June 20",
        location: "United States",
        roleTitle: "Information Security Specialist",
      },
    ],
    headline: "Information Security Leader",
    keywordGaps: [],
    reviewerNotes: [],
    skills: ["Security Controls"],
    summary: "Builds reliable controls.",
  });

  expect(JSON.stringify(normalized)).not.toMatch(/Add measurable scope and outcomes|Held Information Security Specialist/i);
  expect(normalized.experienceBullets).toEqual([
    "Strengthened security controls and supported enterprise risk remediation.",
  ]);
  expect(normalized.experienceSections[0]).toMatchObject({
    bullets: [],
    company: "GE Capital",
    dates: null,
    roleTitle: "Information Security Specialist",
  });
});

test("preserves user-deleted roles when saved resume content is normalized", () => {
  const normalized = normalizeResumeContent({
    contact: {
      email: "candidate@example.com",
      linkedin: null,
      location: "Dubai",
      phone: null,
      website: null,
    },
    experienceBullets: ["Led global services operations across portfolio, pricing, governance, and execution."],
    experienceSections: [
      {
        bullets: ["Led global services operations across portfolio, pricing, governance, and execution."],
        company: "AutomationCo",
        dates: "June 2022 - Present",
        location: "Dubai",
        roleTitle: "Global Vice President of Professional Services, GTM & Operations",
      },
    ],
    headline: "Enterprise Transformation Executive",
    keywordGaps: [],
    reviewerNotes: [],
    skills: ["Transformation"],
    summary: "Builds operating models and measurable value.",
  });

  expect(normalized.experienceSections).toHaveLength(1);
  expect(normalized.experienceSections.map((section) => section.company)).not.toContain("IndustrialCo");
  expect(normalized.experienceSections.map((section) => section.roleTitle)).not.toContain("Senior Audit Manager");
});

test("keeps optional resume sections off the draft unless evidence exists", () => {
  const minimal = normalizeResumeContent({
    contact: {
      email: null,
      linkedin: null,
      location: null,
      phone: null,
      website: null,
    },
    experienceBullets: ["Led transformation."],
    experienceSections: [],
    headline: "Enterprise Transformation Executive",
    keywordGaps: [],
    reviewerNotes: [],
    skills: ["Strategy"],
    summary: "Leads transformation.",
  });

  expect(minimal.specialProjects).toEqual([]);
  expect(minimal.languages).toEqual([]);
  expect(minimal.education).toEqual([]);

  const rich = normalizeResumeContent({
    ...minimal,
    education: [
      {
        credential: "Bachelor of Engineering",
        dates: "2002",
        institution: "University of Mumbai",
        location: "Mumbai",
      },
    ],
    languages: [{ name: "English", proficiency: "Native or Bilingual" }],
    specialProjects: [
      {
        bullets: ["Built a governance model for AI-enabled service delivery."],
        context: "UiPath",
        dates: "2024",
        name: "AI operating model",
      },
    ],
  });

  expect(rich.specialProjects).toHaveLength(1);
  expect(rich.languages).toHaveLength(1);
  expect(rich.education).toHaveLength(1);
});
