import { z } from "zod";

export const CAREER_PROFILE_SCHEMA_VERSION = "career-profile.v1";
export const PROFILE_SOURCE_ANALYSIS_SCHEMA_VERSION = "profile-source-analysis.v1";

export const careerProfileEvidenceSchema = z.object({
  confidence: z.number().min(0).max(1).nullable().default(null),
  excerpt: z.string().trim().max(1200).nullable().default(null),
  factId: z.string().uuid().nullable().default(null),
  sourceId: z.string().uuid().nullable().default(null),
  sourceLabel: z.string().trim().max(240).nullable().default(null),
  sourceType: z.string().trim().max(80).nullable().default(null),
});

export const careerProfileConflictSchema = z.object({
  field: z.string().trim().max(120),
  incomingValue: z.string().trim().max(1000).nullable(),
  existingValue: z.string().trim().max(1000).nullable(),
  reason: z.string().trim().max(500),
  evidence: z.array(careerProfileEvidenceSchema).default([]),
});

export const careerProfileExtraSectionSchema = z.object({
  title: z.string().trim().max(160),
  items: z.array(z.string().trim().max(1200)).default([]),
  evidence: z.array(careerProfileEvidenceSchema).default([]),
});

const optionalText = z.string().trim().max(2000).nullable().default(null);
const textList = z.array(z.string().trim().min(1).max(500)).default([]);

export const parsedProfileSourceSchema = z.object({
  contact: z
    .object({
      email: optionalText,
      phone: optionalText,
      linkedin: optionalText,
      location: optionalText,
      website: optionalText,
    })
    .default({
      email: null,
      linkedin: null,
      location: null,
      phone: null,
      website: null,
    }),
  identity: z
    .object({
      fullName: optionalText,
      currentTitle: optionalText,
    })
    .default({
      currentTitle: null,
      fullName: null,
    }),
  headline: optionalText,
  summaries: textList,
  targetDirection: optionalText,
  targetLevel: optionalText,
  roles: z
    .array(
      z.object({
        achievements: textList,
        company: optionalText,
        dates: optionalText,
        evidence: z.array(careerProfileEvidenceSchema).default([]),
        location: optionalText,
        responsibilities: textList,
        title: z.string().trim().max(240),
      }),
    )
    .default([]),
  achievements: textList,
  metrics: textList,
  skills: textList,
  tools: textList,
  domains: textList,
  education: textList,
  certifications: textList,
  languages: textList,
  projects: textList,
  publications: textList,
  awards: textList,
  volunteering: textList,
  recommendations: textList,
  testimonials: textList,
  extraSections: z.array(careerProfileExtraSectionSchema).default([]),
  conflicts: z.array(careerProfileConflictSchema).default([]),
  openQuestions: textList,
  evidence: z.array(careerProfileEvidenceSchema).default([]),
});

export const canonicalCareerProfileSchema = z.object({
  contact: parsedProfileSourceSchema.shape.contact,
  identity: parsedProfileSourceSchema.shape.identity,
  headline: optionalText,
  summaries: textList,
  targetDirection: optionalText,
  targetLevel: optionalText,
  roleChronology: parsedProfileSourceSchema.shape.roles,
  responsibilities: textList,
  achievements: textList,
  metrics: textList,
  skills: textList,
  tools: textList,
  domains: textList,
  education: textList,
  certifications: textList,
  languages: textList,
  projects: textList,
  publications: textList,
  awards: textList,
  volunteering: textList,
  recommendations: textList,
  testimonials: textList,
  extraSections: z.array(careerProfileExtraSectionSchema).default([]),
  conflicts: z.array(careerProfileConflictSchema).default([]),
  openQuestions: textList,
  evidence: z.array(careerProfileEvidenceSchema).default([]),
});

export type ParsedProfileSource = z.infer<typeof parsedProfileSourceSchema>;
export type CanonicalCareerProfile = z.infer<typeof canonicalCareerProfileSchema>;
export type CareerProfileConflict = z.infer<typeof careerProfileConflictSchema>;
export type CareerProfileEvidence = z.infer<typeof careerProfileEvidenceSchema>;
export type CareerProfileExtraSection = z.infer<typeof careerProfileExtraSectionSchema>;

export function createEmptyCanonicalCareerProfile(): CanonicalCareerProfile {
  return canonicalCareerProfileSchema.parse({});
}
