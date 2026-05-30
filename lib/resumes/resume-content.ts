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
  const experienceSections = value.experienceSections
    .map((section) => ({
      bullets: section.bullets.map((bullet) => cleanResumeText(bullet, 320)).filter(Boolean).slice(0, 7),
      company: cleanNullableText(section.company, 120),
      dates: cleanNullableText(section.dates, 80),
      location: cleanNullableText(section.location, 120),
      roleTitle: stripResumeUiLabels(cleanResumeText(section.roleTitle, 140)) || "Role",
    }))
    .filter((section) => section.bullets.length > 0 || section.roleTitle !== "Role")
    .slice(0, MAX_RESUME_EXPERIENCE_SECTIONS);
  const experienceBullets = value.experienceBullets
    .map((bullet) => cleanResumeText(bullet, 320))
    .filter(Boolean)
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

function cleanNullableText(value: string | null, maxLength: number) {
  const cleanValue = cleanResumeText(value ?? "", maxLength);
  return cleanValue || null;
}

function cleanResumeText(value: string, maxLength = 320) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
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
