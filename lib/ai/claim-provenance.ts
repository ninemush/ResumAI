import { normalizeResumeContent, type ResumeContent } from "@/lib/resumes/resume-content";

export type ClaimEvidenceInput = {
  confidence?: number | null;
  evidenceText?: string | null;
  label?: string | null;
  sourceIds?: string[] | null;
  status?: string | null;
  text: string | null | undefined;
  userConfirmed?: boolean | null;
};

export type CoverLetterClaimRisk = {
  category:
    | "credential"
    | "education"
    | "employer"
    | "location"
    | "numeric_achievement"
    | "salary"
    | "seniority"
    | "title"
    | "work_eligibility";
  severity: "high";
  text: string;
};

const supportedStatuses = new Set(["user_confirmed", "source_supported"]);

export function buildSupportedEvidenceCorpus(inputs: ClaimEvidenceInput[]) {
  return normalizeCorpus(
    inputs
      .filter(isTrustedEvidenceInput)
      .map((input) => [input.label, input.evidenceText, input.text].filter(Boolean).join(" ")),
  );
}

function isTrustedEvidenceInput(input: ClaimEvidenceInput) {
  if (input.userConfirmed) {
    return true;
  }

  if (input.status === "source_excerpt") {
    return true;
  }

  if (!supportedStatuses.has(input.status ?? "")) {
    return false;
  }

  if (!isHighImpactEvidenceInput(input)) {
    return true;
  }

  return hasStrongHighImpactEvidence(input);
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

export function reviewCoverLetterClaimProvenance({
  coverLetter,
  evidenceCorpus,
}: {
  coverLetter: string;
  evidenceCorpus: string;
}) {
  const risks = dedupeCoverLetterRisks(
    splitCoverLetterClaims(coverLetter).flatMap((claim) =>
      classifyUnsupportedCoverLetterClaim(claim, evidenceCorpus),
    ),
  );

  return {
    claimRisks: risks,
    reviewerNotes: risks.map((risk) => `Verify ${formatRiskCategory(risk.category)} before export: ${risk.text}`),
  };
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

function isHighImpactEvidenceInput(input: ClaimEvidenceInput) {
  const value = [input.label, input.text].filter(Boolean).join(" ");

  return /\b(title|role|employer|company|date|education|degree|credential|certification|license|location|work authorization|visa|citizenship|seniority|salary|compensation|clearance|director|manager|lead|principal|senior)\b/i.test(
    value,
  ) || /\b\d+(?:[%.,]|\b)|\b(?:million|billion|thousand|k|m)\b/i.test(value);
}

function hasStrongHighImpactEvidence(input: ClaimEvidenceInput) {
  if (typeof input.evidenceText === "string" && input.evidenceText.trim().length >= 20) {
    return true;
  }

  if (typeof input.confidence === "number" && input.confidence >= 0.82) {
    return true;
  }

  return false;
}

function splitCoverLetterClaims(coverLetter: string) {
  return coverLetter
    .split(/(?<=[.!?])\s+|\n+/)
    .map((claim) => claim.trim())
    .filter((claim) => claim.length >= 12)
    .slice(0, 60);
}

function classifyUnsupportedCoverLetterClaim(
  claim: string,
  evidenceCorpus: string,
): CoverLetterClaimRisk[] {
  if (isSupportedClaim(claim, evidenceCorpus)) {
    return [];
  }

  const risks: CoverLetterClaimRisk[] = [];
  const riskPatterns: Array<[CoverLetterClaimRisk["category"], RegExp]> = [
    ["work_eligibility", /\b(work authorization|work authori[sz]ed|eligible to work|visa|citizenship|clearance|sponsorship)\b/i],
    ["salary", /\b(salary|compensation|pay range|remuneration|bonus|commission)\b/i],
    ["numeric_achievement", /\b\d+(?:[%.,]|\b)|\b(?:million|billion|thousand|k|m)\b/i],
    ["credential", /\b(certified|certification|credential|license|licensed|aws|azure|gcp|salesforce|pmp|cpa|cfa)\b/i],
    ["education", /\b(mba|bachelor|master'?s|phd|degree|university|college|school)\b/i],
    ["seniority", /\b(senior|lead|principal|director|head of|chief|vp|vice president|manager|executive)\b/i],
    ["title", /\b(?:as|role as|title of|served as|worked as|position as)\s+(?:an?\s+)?[A-Z]?[a-z]+(?:\s+[A-Z]?[a-z]+){0,5}\b/i],
    ["employer", /\b(?:at|for|with)\s+[A-Z][A-Za-z0-9&.,' -]{2,80}\b/],
    ["location", /\b(?:based in|located in|relocated to|across)\s+[A-Z][A-Za-z ,'-]{2,80}\b/],
  ];

  for (const [category, pattern] of riskPatterns) {
    if (pattern.test(claim)) {
      risks.push({
        category,
        severity: "high",
        text: claim.slice(0, 220),
      });
    }
  }

  return risks;
}

function dedupeCoverLetterRisks(risks: CoverLetterClaimRisk[]) {
  const seen = new Set<string>();
  return risks.filter((risk) => {
    const key = `${risk.category}:${risk.text}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function formatRiskCategory(category: CoverLetterClaimRisk["category"]) {
  return category.replace(/_/g, " ");
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
