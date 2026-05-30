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
});
