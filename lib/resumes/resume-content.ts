import { z } from "zod";

export const MAX_RESUME_EXPERIENCE_SECTIONS = 12;

export const resumeExperienceSectionSchema = z.object({
  bullets: z.array(z.string().trim().min(1).max(320)).max(7),
  company: z.string().trim().max(120).nullable().default(null),
  dates: z.string().trim().max(80).nullable().default(null),
  location: z.string().trim().max(120).nullable().default(null),
  roleTitle: z.string().trim().min(1).max(140),
});

export const resumeContactSchema = z.object({
  email: z.string().trim().max(160).nullable().default(null),
  linkedin: z.string().trim().max(240).nullable().default(null),
  location: z.string().trim().max(160).nullable().default(null),
  phone: z.string().trim().max(80).nullable().default(null),
  website: z.string().trim().max(240).nullable().default(null),
});

export const emptyResumeContact = {
  email: null,
  linkedin: null,
  location: null,
  phone: null,
  website: null,
} satisfies z.infer<typeof resumeContactSchema>;

export const resumeContentSchema = z.object({
  contact: resumeContactSchema.default(emptyResumeContact),
  experienceBullets: z.array(z.string().trim().min(1).max(320)).max(14),
  experienceSections: z.array(resumeExperienceSectionSchema).max(MAX_RESUME_EXPERIENCE_SECTIONS).default([]),
  headline: z.string().trim().min(1).max(220),
  keywordGaps: z.array(z.string().trim().min(1).max(140)).max(16),
  reviewerNotes: z.array(z.string().trim().min(1).max(260)).max(8),
  skills: z.array(z.string().trim().min(1).max(90)).max(24),
  summary: z.string().trim().min(1).max(1200),
});

export type ResumeContent = z.infer<typeof resumeContentSchema>;
export type ResumeContact = z.infer<typeof resumeContactSchema>;

export function parseResumeContent(value: unknown): ResumeContent {
  return resumeContentSchema.parse(value);
}

export function normalizeResumeContent(value: ResumeContent): ResumeContent {
  const experienceSections = dedupeResumeExperienceSections(
    value.experienceSections
    .map((section) => ({
      bullets: section.bullets
        .map((bullet) => cleanResumeText(bullet, 320))
        .filter((bullet) => bullet && !looksLikeRecommendationOrTestimonial(bullet))
        .slice(0, 7),
      company: cleanResumeCompany(section.company),
      dates: cleanResumeDateRange(section.dates),
      location: cleanNullableText(section.location, 120),
      roleTitle: stripResumeUiLabels(cleanResumeText(section.roleTitle, 140)) || "Role",
    }))
    .filter((section) => section.bullets.length > 0 || section.roleTitle !== "Role")
    .filter((section) => !looksLikeRecommendationExperienceSection(section)),
  )
    .slice(0, MAX_RESUME_EXPERIENCE_SECTIONS);
  const experienceBullets = value.experienceBullets
    .map((bullet) => cleanResumeText(bullet, 320))
    .filter((bullet) => bullet && !looksLikeRecommendationOrTestimonial(bullet))
    .slice(0, 14);

  return resumeContentSchema.parse({
    contact: {
      email: cleanNullableText(value.contact?.email ?? null, 160),
      linkedin: cleanNullableText(value.contact?.linkedin ?? null, 240),
      location: cleanNullableText(value.contact?.location ?? null, 160),
      phone: cleanNullableText(value.contact?.phone ?? null, 80),
      website: cleanNullableText(value.contact?.website ?? null, 240),
    },
    experienceBullets:
      experienceBullets.length > 0
        ? experienceBullets
        : experienceSections.flatMap((section) => section.bullets).slice(0, 8),
    experienceSections,
    headline: cleanResumeHeadline(value.headline),
    keywordGaps: value.keywordGaps.map((gap) => cleanResumeText(gap, 140)).filter(Boolean).slice(0, 16),
    reviewerNotes: value.reviewerNotes.map((note) => cleanResumeText(note, 260)).filter(Boolean).slice(0, 8),
    skills: value.skills.map((skill) => cleanResumeText(skill, 90)).filter(Boolean).slice(0, 24),
    summary: stripResumeUiLabels(cleanResumeText(value.summary, 1200)),
  });
}

export function dedupeResumeExperienceSections(
  sections: ResumeContent["experienceSections"],
): ResumeContent["experienceSections"] {
  const deduped: ResumeContent["experienceSections"] = [];

  for (const section of sections) {
    const existingIndex = deduped.findIndex((existing) =>
      looksLikeSameExperienceSection(existing, section),
    );

    if (existingIndex === -1) {
      deduped.push(section);
      continue;
    }

    const existing = deduped[existingIndex];
    deduped[existingIndex] = {
      bullets: mergeUniqueResumeBullets(existing.bullets, section.bullets).slice(0, 7),
      company: existing.company || section.company,
      dates: existing.dates || section.dates,
      location: existing.location || section.location,
      roleTitle:
        existing.roleTitle.length >= section.roleTitle.length
          ? existing.roleTitle
          : section.roleTitle,
    };
  }

  return deduped;
}

export function looksLikeEmploymentTypeLabel(value: string | null | undefined) {
  return /^(?:full[-\s]?time|part[-\s]?time|contract|contractor|freelance|self[-\s]?employed|internship|temporary|temp|consultant|apprenticeship|seasonal)$/i.test(
    (value ?? "").trim(),
  );
}

export function cleanResumeDateRange(value: string | null | undefined) {
  const cleanValue = cleanNullableText(value ?? null, 80);

  if (!cleanValue) {
    return null;
  }

  if (/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(?:19|20)(?!\d)\b/i.test(cleanValue)) {
    return null;
  }

  return cleanValue;
}

function cleanNullableText(value: string | null, maxLength: number) {
  const cleanValue = cleanResumeText(value ?? "", maxLength);
  return cleanValue || null;
}

function cleanResumeCompany(value: string | null | undefined) {
  const cleanValue = cleanNullableText(stripResumeUiLabels(value ?? ""), 120);

  if (!cleanValue || looksLikeEmploymentTypeLabel(cleanValue)) {
    return null;
  }

  return cleanValue;
}

function cleanResumeText(value: string, maxLength = 320) {
  return value
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function mergeUniqueResumeBullets(left: string[], right: string[]) {
  const bullets: string[] = [];

  for (const bullet of [...left, ...right]) {
    const normalized = normalizeComparableText(bullet);

    if (
      !normalized ||
      bullets.some((existing) => {
        const existingNormalized = normalizeComparableText(existing);
        return (
          existingNormalized === normalized ||
          existingNormalized.includes(normalized.slice(0, 80)) ||
          normalized.includes(existingNormalized.slice(0, 80))
        );
      })
    ) {
      continue;
    }

    bullets.push(bullet);
  }

  return bullets;
}

function looksLikeSameExperienceSection(
  left: ResumeContent["experienceSections"][number],
  right: ResumeContent["experienceSections"][number],
) {
  const leftCompany = normalizeComparableCompany(left.company);
  const rightCompany = normalizeComparableCompany(right.company);
  const companyMatches =
    !leftCompany ||
    !rightCompany ||
    leftCompany === rightCompany ||
    leftCompany.includes(rightCompany) ||
    rightCompany.includes(leftCompany);

  if (!companyMatches) {
    return false;
  }

  const datesCompatible = datesOverlapOrMissing(left.dates, right.dates);
  const roleSimilarity = tokenSimilarity(left.roleTitle, right.roleTitle);
  const bulletsOverlap = haveSimilarResumeBullets(left.bullets, right.bullets);

  if (datesCompatible && roleSimilarity >= 0.58) {
    return true;
  }

  if (datesCompatible && roleSimilarity >= 0.44 && bulletsOverlap) {
    return true;
  }

  return roleSimilarity >= 0.82 && Boolean(leftCompany && rightCompany);
}

function haveSimilarResumeBullets(left: string[], right: string[]) {
  return left.some((leftBullet) =>
    right.some((rightBullet) => {
      const leftComparable = normalizeComparableText(leftBullet);
      const rightComparable = normalizeComparableText(rightBullet);

      return (
        leftComparable.length > 40 &&
        rightComparable.length > 40 &&
        (leftComparable.includes(rightComparable.slice(0, 80)) ||
          rightComparable.includes(leftComparable.slice(0, 80)) ||
          tokenSimilarity(leftComparable, rightComparable) >= 0.62)
      );
    }),
  );
}

function normalizeComparableCompany(value: string | null | undefined) {
  if (looksLikeEmploymentTypeLabel(value)) {
    return "";
  }

  return normalizeComparableText(value ?? "");
}

function datesOverlapOrMissing(left: string | null, right: string | null) {
  const leftYears = extractYears(left);
  const rightYears = extractYears(right);

  if (leftYears.length === 0 || rightYears.length === 0) {
    return true;
  }

  return leftYears[0] === rightYears[0] && leftYears.at(-1) === rightYears.at(-1);
}

function extractYears(value: string | null) {
  return Array.from(new Set(value?.match(/\b(?:19|20)\d{2}\b/g) ?? []));
}

function tokenSimilarity(left: string, right: string) {
  const leftTokens = new Set(readComparableTokens(left));
  const rightTokens = new Set(readComparableTokens(right));

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / Math.min(leftTokens.size, rightTokens.size);
}

function readComparableTokens(value: string) {
  const stopWords = new Set([
    "and",
    "at",
    "for",
    "global",
    "of",
    "the",
  ]);

  return normalizeComparableText(value)
    .split(" ")
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function normalizeComparableText(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(senior|sr|vice|vp|president|director|lead|leader|head)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanResumeHeadline(value: string) {
  const normalized = stripResumeUiLabels(cleanResumeText(value, 220)).replace(/\s*\|\s*/g, " / ");
  const segments = normalized.split(/\s+\/\s+/).filter(Boolean);

  if (segments.length <= 2) {
    return normalized.slice(0, 140);
  }

  return segments.slice(0, 2).join(" / ").slice(0, 140);
}

function stripResumeUiLabels(value: string) {
  return value
    .replace(/^(?:draft|final|saved)\s*[:\-–—]\s*/i, "")
    .replace(/^(?:master\s+ats\s+resume|ats\s+master\s+resume|master\s+resume)\s*[:\-–—]?\s*/i, "")
    .trim();
}

function looksLikeRecommendationExperienceSection(
  section: Pick<ResumeContent["experienceSections"][number], "bullets" | "company" | "dates" | "roleTitle">,
) {
  const combined = [section.roleTitle, section.company, section.dates, ...section.bullets]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const roleAndCompany = [section.roleTitle, section.company].filter(Boolean).join(" ");

  if (
    looksLikeRecommendationOrTestimonial(
      combined,
    )
  ) {
    return true;
  }

  if (/^\*|\*$/.test(section.roleTitle.trim())) {
    return true;
  }

  if (
    looksLikePersonName(roleAndCompany) ||
    looksLikePersonName(section.company ?? "")
  ) {
    return true;
  }

  return false;
}

function looksLikeRecommendationOrTestimonial(value: string) {
  return /\b(recommendation|recommendations received|testimonial|endorsement|reference|worked with|worked directly with|had the pleasure|same team|reported to|colleague|managed me|direct report|recommend(?:ed)?\b|he is an?|she is an?|pleasure to share|excellent professional|best of the new generation)\b/i.test(
    value,
  );
}

function looksLikePersonName(value: string) {
  const words = value.trim().split(/\s+/);

  return (
    words.length >= 2 &&
    words.length <= 5 &&
    words.every((word) => /^[A-Z][a-z.'-]+$/.test(word)) &&
    !/\b(Inc|LLC|Ltd|Limited|Group|Company|Corp|Corporation|Capital|Services|Technologies|Technology|Systems|Bank|University)\b/.test(
      value,
    )
  );
}
