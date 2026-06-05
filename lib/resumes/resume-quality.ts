import "server-only";

import {
  normalizeResumeContent,
  parseResumeContent,
  type ResumeContent,
} from "@/lib/resumes/resume-content";

export type ResumeQualityReport = {
  changed: boolean;
  changedSections: string[];
  removed: {
    certifications: number;
    education: number;
    experienceBullets: number;
    experienceSections: number;
    languages: number;
    specialProjects: number;
    specialProjectBullets: number;
  };
};

const emptyRemovedReport: ResumeQualityReport["removed"] = {
  certifications: 0,
  education: 0,
  experienceBullets: 0,
  experienceSections: 0,
  languages: 0,
  specialProjects: 0,
  specialProjectBullets: 0,
};

export function sanitizeResumeContent(value: unknown): {
  content: ResumeContent;
  report: ResumeQualityReport;
} {
  const parsed = parseResumeContent(value);
  const content = normalizeResumeContent(parsed);
  const report = buildResumeQualityReport(parsed, content);

  return { content, report };
}

export function buildResumeQualityReport(
  before: ResumeContent,
  after: ResumeContent,
): ResumeQualityReport {
  const changedSections: string[] = [];

  for (const section of [
    "contact",
    "headline",
    "summary",
    "skills",
    "experienceSections",
    "experienceBullets",
    "specialProjects",
    "languages",
    "education",
    "certifications",
    "keywordGaps",
    "reviewerNotes",
  ] satisfies (keyof ResumeContent)[]) {
    if (JSON.stringify(before[section]) !== JSON.stringify(after[section])) {
      changedSections.push(section);
    }
  }

  const removed = {
    ...emptyRemovedReport,
    certifications: countRemoved(before.certifications, after.certifications),
    education: countRemoved(before.education, after.education),
    experienceBullets: countRemoved(before.experienceBullets, after.experienceBullets),
    experienceSections: countRemoved(before.experienceSections, after.experienceSections),
    languages: countRemoved(before.languages, after.languages),
    specialProjects: countRemoved(before.specialProjects, after.specialProjects),
    specialProjectBullets: Math.max(
      0,
      before.specialProjects.reduce((sum, item) => sum + item.bullets.length, 0) -
        after.specialProjects.reduce((sum, item) => sum + item.bullets.length, 0),
    ),
  };

  return {
    changed: changedSections.length > 0,
    changedSections,
    removed,
  };
}

function countRemoved(before: unknown[], after: unknown[]) {
  return Math.max(0, before.length - after.length);
}
