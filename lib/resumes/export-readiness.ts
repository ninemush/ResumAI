import { getBlockingExportRisks } from "@/lib/applications/export-gates";
import type { ResumeContent } from "@/lib/resumes/resume-content";

export type ResumeExportChecklistStatus = "ready" | "warning" | "blocked";

export type ResumeExportChecklistItem = {
  detail: string;
  id: string;
  label: string;
  status: ResumeExportChecklistStatus;
};

export type ResumeOptionalSectionId =
  | "highlights"
  | "specialProjects"
  | "languages"
  | "education"
  | "certifications";

export type ResumeOptionalSectionState = {
  count: number;
  id: ResumeOptionalSectionId;
  label: string;
};

export function buildResumeExportChecklist({
  missingEvidence,
  resume,
}: {
  missingEvidence?: string[];
  resume: ResumeContent | null;
}): ResumeExportChecklistItem[] {
  if (!resume) {
    return [
      {
        detail: "Create a master resume before preparing PDF or DOCX files.",
        id: "resume-draft",
        label: "Resume draft",
        status: "blocked",
      },
    ];
  }

  const blockingRisks = getBlockingExportRisks(resume);
  const roleMeta = countRoleMetadataGaps(resume);
  const optionalSections = getResumeOptionalSectionStates(resume);
  const populatedOptionalSections = optionalSections.filter((section) => section.count > 0);
  const reviewerPromptCount =
    (missingEvidence?.filter(Boolean).length ?? 0) +
    resume.keywordGaps.filter(Boolean).length +
    resume.reviewerNotes.filter(Boolean).length;

  return [
    {
      detail:
        resume.summary.trim() && resume.headline.trim() && resume.skills.length > 0
          ? "Headline, summary, and core skills are present."
          : "Add a headline, summary, and core skills before export.",
      id: "core-content",
      label: "Core content",
      status: resume.summary.trim() && resume.headline.trim() && resume.skills.length > 0 ? "ready" : "blocked",
    },
    {
      detail:
        resume.experienceSections.length > 0
          ? roleMeta.total === 0
            ? "Role timeline includes company, date, and location details."
            : `${roleMeta.total} role metadata item${roleMeta.total === 1 ? "" : "s"} should be reviewed before export.`
          : "Add at least one role with bullets before export.",
      id: "role-timeline",
      label: "Role timeline",
      status: resume.experienceSections.length === 0 ? "blocked" : roleMeta.total === 0 ? "ready" : "warning",
    },
    {
      detail:
        blockingRisks.length > 0
          ? `${blockingRisks.length} high-impact claim${blockingRisks.length === 1 ? "" : "s"} ${blockingRisks.length === 1 ? "needs" : "need"} acknowledgement.`
          : reviewerPromptCount > 0
            ? `${reviewerPromptCount} refinement prompt${reviewerPromptCount === 1 ? "" : "s"} remain open.`
            : "No open evidence prompts are shown for this draft.",
      id: "claim-review",
      label: "Evidence review",
      status: blockingRisks.length > 0 ? "blocked" : reviewerPromptCount > 0 ? "warning" : "ready",
    },
    {
      detail:
        populatedOptionalSections.length > 0
          ? `Included: ${populatedOptionalSections.map((section) => section.label).join(", ")}.`
          : "No optional sections are populated yet.",
      id: "optional-sections",
      label: "Optional sections",
      status: populatedOptionalSections.length > 0 ? "ready" : "warning",
    },
  ];
}

export function getResumeOptionalSectionStates(resume: ResumeContent | null): ResumeOptionalSectionState[] {
  return [
    {
      count: resume?.experienceBullets.filter(Boolean).length ?? 0,
      id: "highlights",
      label: "Selected Highlights",
    },
    {
      count: resume?.specialProjects.filter((item) => item.name.trim() || item.bullets.some(Boolean)).length ?? 0,
      id: "specialProjects",
      label: "Special Projects",
    },
    {
      count: resume?.languages.filter((item) => item.name.trim()).length ?? 0,
      id: "languages",
      label: "Languages",
    },
    {
      count:
        resume?.education.filter((item) => item.institution.trim() || item.credential?.trim()).length ?? 0,
      id: "education",
      label: "Education",
    },
    {
      count: resume?.certifications.filter((item) => item.name.trim()).length ?? 0,
      id: "certifications",
      label: "Certifications",
    },
  ];
}

function countRoleMetadataGaps(resume: ResumeContent) {
  return resume.experienceSections.reduce(
    (counts, section) => {
      if (!section.company?.trim()) counts.company += 1;
      if (!section.dates?.trim()) counts.dates += 1;
      if (!section.location?.trim()) counts.location += 1;
      counts.total = counts.company + counts.dates + counts.location;
      return counts;
    },
    { company: 0, dates: 0, location: 0, total: 0 },
  );
}
