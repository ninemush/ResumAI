import { normalizeResumeContent, type ResumeContent } from "@/lib/resumes/resume-content";

export type ClaimEvidenceInput = {
  label?: string | null;
  status?: string | null;
  text: string | null | undefined;
  userConfirmed?: boolean | null;
};

const supportedStatuses = new Set(["user_confirmed", "source_supported"]);

export function buildSupportedEvidenceCorpus(inputs: ClaimEvidenceInput[]) {
  return normalizeCorpus(
    inputs
      .filter(
        (input) =>
          input.userConfirmed ||
          supportedStatuses.has(input.status ?? "") ||
          input.status === "source_excerpt",
      )
      .map((input) => [input.label, input.text].filter(Boolean).join(" ")),
  );
}

export function reviewResumeClaimProvenance({
  evidenceCorpus,
  resume,
}: {
  evidenceCorpus: string;
  resume: ResumeContent;
}) {
  const notes: string[] = [];
  const reviewed = normalizeResumeContent({
    ...resume,
    experienceSections: resume.experienceSections
      .map((section) => ({
        ...section,
        company: retainNullableClaim(section.company, evidenceCorpus, notes, "employer"),
        dates: retainNullableClaim(section.dates, evidenceCorpus, notes, "role dates"),
        roleTitle: retainRequiredClaim(section.roleTitle, evidenceCorpus, notes, "role title"),
        bullets: section.bullets.filter((bullet) =>
          retainBulletClaim(bullet, evidenceCorpus, notes),
        ),
      }))
      .filter(
        (section) =>
          section.roleTitle &&
          (section.bullets.length > 0 || Boolean(section.company || section.dates)),
      ),
    specialProjects: resume.specialProjects
      .map((project) => ({
        ...project,
        context: retainNullableClaim(project.context, evidenceCorpus, notes, "project context"),
        dates: retainNullableClaim(project.dates, evidenceCorpus, notes, "project dates"),
        name: retainRequiredClaim(project.name, evidenceCorpus, notes, "project"),
        bullets: project.bullets.filter((bullet) =>
          retainBulletClaim(bullet, evidenceCorpus, notes),
        ),
      }))
      .filter((project) => project.name && project.bullets.length > 0),
    languages: resume.languages.filter((language) => {
      const supported = isSupportedClaim(language.name, evidenceCorpus);
      if (!supported) notes.push(`Verify language before export: ${language.name}`);
      return supported;
    }),
    education: resume.education.filter((item) => {
      const supported = isSupportedClaim(item.institution, evidenceCorpus);
      if (!supported) notes.push(`Verify education before export: ${item.institution}`);
      return supported;
    }),
    certifications: resume.certifications.filter((item) => {
      const supported = isSupportedClaim(item.name, evidenceCorpus);
      if (!supported) notes.push(`Verify credential before export: ${item.name}`);
      return supported;
    }),
    reviewerNotes: [...resume.reviewerNotes, ...dedupeNotes(notes)].slice(0, 8),
  });

  return reviewed;
}

function retainNullableClaim(
  value: string | null,
  evidenceCorpus: string,
  notes: string[],
  label: string,
) {
  if (!value || isSupportedClaim(value, evidenceCorpus)) {
    return value;
  }

  notes.push(`Verify ${label} before export: ${value}`);
  return null;
}

function retainRequiredClaim(
  value: string,
  evidenceCorpus: string,
  notes: string[],
  label: string,
) {
  if (isSupportedClaim(value, evidenceCorpus)) {
    return value;
  }

  notes.push(`Verify ${label} before export: ${value}`);
  return "";
}

function retainBulletClaim(bullet: string, evidenceCorpus: string, notes: string[]) {
  if (!requiresEvidence(bullet) || isSupportedClaim(bullet, evidenceCorpus)) {
    return true;
  }

  notes.push(`Verify unsupported achievement before export: ${bullet.slice(0, 180)}`);
  return false;
}

function requiresEvidence(value: string) {
  return /\b(\d+[%\w]*|managed|led|owned|launched|built|delivered|reduced|increased|improved|saved|grew|certified|degree|mba|bachelor|master|phd|sql|python|salesforce|sap|aws|azure|gcp)\b/i.test(
    value,
  );
}

function isSupportedClaim(value: string, evidenceCorpus: string) {
  const normalized = normalizeText(value);

  if (normalized.length < 3) {
    return true;
  }

  if (evidenceCorpus.includes(normalized)) {
    return true;
  }

  const tokens = normalized.split(" ").filter((token) => token.length > 2);
  if (tokens.length <= 2) {
    return tokens.every((token) => evidenceCorpus.includes(token));
  }

  const supportedTokenCount = tokens.filter((token) => evidenceCorpus.includes(token)).length;
  return supportedTokenCount / tokens.length >= 0.72;
}

function normalizeCorpus(values: string[]) {
  return normalizeText(values.join(" "));
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#.%/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeNotes(notes: string[]) {
  return Array.from(new Set(notes));
}
