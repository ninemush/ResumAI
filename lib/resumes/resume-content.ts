import { z } from "zod";

export const resumeContentSchema = z.object({
  experienceBullets: z.array(z.string().trim().min(1).max(320)).max(14),
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
