import { z } from "zod";

export const resumeExperienceSectionSchema = z.object({
  bullets: z.array(z.string().trim().min(1).max(320)).max(7),
  company: z.string().trim().max(120).nullable().default(null),
  dates: z.string().trim().max(80).nullable().default(null),
  location: z.string().trim().max(120).nullable().default(null),
  roleTitle: z.string().trim().min(1).max(140),
});

export const resumeContentSchema = z.object({
  experienceBullets: z.array(z.string().trim().min(1).max(320)).max(14),
  experienceSections: z.array(resumeExperienceSectionSchema).max(8).default([]),
  headline: z.string().trim().min(1).max(220),
  keywordGaps: z.array(z.string().trim().min(1).max(140)).max(16),
  reviewerNotes: z.array(z.string().trim().min(1).max(260)).max(8),
  skills: z.array(z.string().trim().min(1).max(90)).max(24),
  summary: z.string().trim().min(1).max(1200),
});

export type ResumeContent = z.infer<typeof resumeContentSchema>;

export function parseResumeContent(value: unknown): ResumeContent {
  return resumeContentSchema.parse(value);
}
