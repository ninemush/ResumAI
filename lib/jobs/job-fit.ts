import "server-only";

import { z } from "zod";

import { brand } from "@/lib/brand";
import type { EvidenceBasedFitAnalysis } from "@/lib/jobs/evidence-based-fit";
import { parseResumeContent, type ResumeContent } from "@/lib/resumes/resume-content";
import { createClient } from "@/lib/supabase/server";

export const jobFitRequestSchema = z.object({
  jobId: z.string().uuid(),
});

export type JobFitAnalysis = {
  matchedKeywords: string[];
  missingKeywords: string[];
  questions: string[];
  recommendation: "strong_match" | "possible_match" | "weak_match" | "needs_profile";
  risks: string[];
  score: number | null;
  senioritySignals: string[];
  summary: string;
  evidenceBased?: EvidenceBasedFitAnalysis;
  fitBand?: "Strong fit" | "Plausible fit" | "Stretch" | "Poor fit" | "Needs more profile evidence";
};

type ProfileFact = {
  fact_type: string;
  fact_value: string;
  user_confirmed?: boolean;
};

const ignoredTerms = new Set([
  "about",
  "ability",
  "across",
  "also",
  "and",
  "are",
  "based",
  "business",
  "candidate",
  "company",
  "experience",
  "from",
  "have",
  "including",
  "looking",
  "management",
  "more",
  "role",
  "team",
  "that",
  "the",
  "this",
  "with",
  "work",
  "will",
  "years",
]);

const fitSignalGroups = [
  {
    label: "AI and automation",
    terms: ["ai", "artificial intelligence", "automation", "machine learning", "ml", "genai", "workflow"],
  },
  {
    label: "Transformation and change",
    terms: ["transformation", "change", "operating model", "modernization", "turnaround", "strategy"],
  },
  {
    label: "Operations and delivery",
    terms: ["operations", "delivery", "service delivery", "process", "efficiency", "capacity", "program"],
  },
  {
    label: "GTM and commercial",
    terms: ["gtm", "go-to-market", "sales", "revenue", "pipeline", "growth", "commercial", "pricing"],
  },
  {
    label: "Customer and services",
    terms: ["customer", "client", "professional services", "success", "retention", "adoption", "service"],
  },
  {
    label: "Technology and data",
    terms: ["data", "analytics", "cloud", "platform", "api", "integration", "architecture", "technology"],
  },
  {
    label: "Risk and governance",
    terms: ["risk", "governance", "compliance", "security", "controls", "audit", "regulatory"],
  },
  {
    label: "Executive leadership",
    terms: ["executive", "leadership", "stakeholder", "board", "vp", "director", "head", "global", "regional"],
  },
];

export async function analyzeJobFitForJobId(
  input: z.input<typeof jobFitRequestSchema>,
): Promise<JobFitAnalysis> {
  const parsed = jobFitRequestSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { data: job, error: jobError } = await supabase
    .from("job_ingestions")
    .select("id, extracted_text, ingestion_status")
    .eq("id", parsed.jobId)
    .eq("user_id", user.id)
    .single();

  if (jobError || !job) {
    throw new Error("JOB_NOT_FOUND");
  }

  if (job.ingestion_status !== "succeeded" || !job.extracted_text) {
    throw new Error("JOB_NOT_READY");
  }

  const context = await readUserFitContext(user.id);

  return analyzeJobFit({
    jobText: job.extracted_text,
    masterResume: context.masterResume,
    profileFacts: context.profileFacts,
  });
}

export async function readUserFitContext(userId: string) {
  const supabase = await createClient();
  const [{ data: facts, error: factsError }, { data: latestResume, error: resumeError }] =
    await Promise.all([
      supabase
        .from("profile_facts")
        .select("fact_type, fact_value, user_confirmed")
        .eq("user_id", userId)
        .order("user_confirmed", { ascending: false })
        .order("confidence", { ascending: false })
        .limit(80),
      supabase
        .from("generated_resumes")
        .select("content_json")
        .eq("user_id", userId)
        .eq("resume_type", "master")
        .is("application_id", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (factsError) {
    throw new Error("PROFILE_FACTS_READ_FAILED");
  }

  if (resumeError) {
    throw new Error("MASTER_RESUME_READ_FAILED");
  }

  return {
    masterResume: parseOptionalResumeContent(latestResume?.content_json),
    profileFacts: facts ?? [],
  };
}

export function analyzeJobFit({
  jobText,
  masterResume,
  profileFacts,
}: {
  jobText: string | null;
  masterResume: ResumeContent | null;
  profileFacts: ProfileFact[];
}): JobFitAnalysis {
  if (!jobText) {
    return buildEmptyFit("No job-post detail is available yet.");
  }

  const candidateKeywords = extractCandidateKeywords({ masterResume, profileFacts });
  const jobKeywords = extractJobKeywords(jobText);
  const candidateText = buildCandidateText({ masterResume, profileFacts });
  const candidateSignalGroups = readSignalGroups(candidateText);
  const jobSignalGroups = readSignalGroups(jobText);

  if (candidateKeywords.length === 0) {
    return buildEmptyFit(`Add profile context before ${brand.name} can give a fair fit read.`);
  }

  const normalizedCandidateTerms = candidateKeywords.map(normalizeKeyword);
  const matchedKeywords = jobKeywords
    .filter((keyword) => matchesAnyCandidateKeyword(keyword, normalizedCandidateTerms))
    .slice(0, 10);
  const missingKeywords = jobKeywords
    .filter((keyword) => !matchesAnyCandidateKeyword(keyword, normalizedCandidateTerms))
    .slice(0, 10);
  const keywordScore = Math.round((matchedKeywords.length / Math.max(jobKeywords.length, 1)) * 100);
  const signalScore = Math.round(
    (candidateSignalGroups.filter((signal) => jobSignalGroups.includes(signal)).length /
      Math.max(jobSignalGroups.length, 1)) *
      100,
  );
  const score = Math.max(
    keywordScore,
    Math.round(keywordScore * 0.45 + signalScore * 0.55),
  );
  const senioritySignals = readSenioritySignals(jobText);
  const recommendation = readRecommendation({ profileFacts, score, signalScore });
  const risks = readFitRisks({
    jobKeywords,
    masterResume,
    missingKeywords,
    profileFacts,
    score,
  });
  const questions = readFitQuestions({
    missingKeywords,
    senioritySignals,
    signalGaps: jobSignalGroups.filter((signal) => !candidateSignalGroups.includes(signal)),
  });

  return {
    matchedKeywords,
    missingKeywords,
    questions,
    recommendation,
    risks,
    score,
    senioritySignals,
    summary: buildFitSummary({
      matchedKeywords,
      recommendation,
      score,
      alignmentThemes: candidateSignalGroups.filter((signal) => jobSignalGroups.includes(signal)),
    }),
  };
}

function buildEmptyFit(summary: string): JobFitAnalysis {
  return {
    matchedKeywords: [],
    missingKeywords: [],
    questions: ["Share a resume, profile, or role-history note before deciding whether to proceed."],
    recommendation: "needs_profile",
    risks: ["Not enough trusted profile context to assess this role."],
    score: null,
    senioritySignals: [],
    summary,
  };
}

function extractCandidateKeywords({
  masterResume,
  profileFacts,
}: {
  masterResume: ResumeContent | null;
  profileFacts: ProfileFact[];
}) {
  const resumeTerms = masterResume
    ? [
        masterResume.headline,
        masterResume.summary,
        ...masterResume.skills,
        ...masterResume.experienceBullets,
      ]
    : [];
  const factTerms = profileFacts
    .flatMap((fact) => [fact.fact_value]);

  return uniqueKeywords([...resumeTerms, ...factTerms].flatMap(extractTerms)).slice(0, 60);
}

function buildCandidateText({
  masterResume,
  profileFacts,
}: {
  masterResume: ResumeContent | null;
  profileFacts: ProfileFact[];
}) {
  return [
    masterResume?.headline,
    masterResume?.summary,
    ...(masterResume?.skills ?? []),
    ...(masterResume?.experienceBullets ?? []),
    ...profileFacts.map((fact) => fact.fact_value),
  ]
    .filter(Boolean)
    .join("\n");
}

function extractJobKeywords(jobText: string) {
  const normalized = jobText.toLowerCase();
  const explicitTerms = [
    "agile",
    "analytics",
    "api",
    "automation",
    "budget",
    "cloud",
    "crm",
    "data",
    "finance",
    "governance",
    "leadership",
    "machine learning",
    "marketing",
    "operations",
    "platform",
    "product",
    "program",
    "project",
    "python",
    "risk",
    "sales",
    "security",
    "sql",
    "stakeholder",
    "strategy",
    "transformation",
  ].filter((term) => normalized.includes(term));

  return uniqueKeywords([...explicitTerms, ...extractTerms(jobText)]).slice(0, 24);
}

function extractTerms(text: string) {
  const phraseMatches = text.match(/\b[A-Za-z][A-Za-z+#/.-]*(?:\s+[A-Za-z][A-Za-z+#/.-]*){0,2}\b/g) ?? [];

  return phraseMatches
    .map((term) => term.trim().replace(/\s+/g, " "))
    .filter((term) => term.length >= 4 && term.length <= 40)
    .filter((term) => !ignoredTerms.has(term.toLowerCase()))
    .filter((term) => !/^\d+$/.test(term));
}

function readRecommendation({
  profileFacts,
  score,
  signalScore,
}: {
  profileFacts: ProfileFact[];
  score: number;
  signalScore: number;
}): JobFitAnalysis["recommendation"] {
  if (profileFacts.length < 3) {
    return "needs_profile";
  }

  if (signalScore >= 65 && score >= 35) return "strong_match";
  if (score >= 55) return "strong_match";
  if (score >= 28) return "possible_match";
  return "weak_match";
}

function readFitRisks({
  jobKeywords,
  masterResume,
  missingKeywords,
  profileFacts,
  score,
}: {
  jobKeywords: string[];
  masterResume: ResumeContent | null;
  missingKeywords: string[];
  profileFacts: ProfileFact[];
  score: number;
}) {
  const risks: string[] = [];

  if (profileFacts.length < 3) {
    risks.push("The profile has too little role evidence for a confident fit call.");
  }

  if (!masterResume) {
    risks.push("No master resume exists yet, so fit is based on saved profile details for now.");
  }

  if (score < 28 && jobKeywords.length > 0) {
    risks.push("The current profile evidence does not mirror many of the job's visible keywords.");
  }

  if (missingKeywords.length > 0) {
    risks.push(`Potential gaps to verify: ${missingKeywords.slice(0, 4).join(", ")}.`);
  }

  return risks.slice(0, 4);
}

function readFitQuestions({
  missingKeywords,
  senioritySignals,
  signalGaps,
}: {
  missingKeywords: string[];
  senioritySignals: string[];
  signalGaps: string[];
}) {
  const questions: string[] = [];

  if (signalGaps.length > 0) {
    questions.push(`Can we substantiate ${signalGaps.slice(0, 2).join(" and ")} with real examples?`);
  }

  if (missingKeywords.length > 0) {
    questions.push(`Do you have credible examples involving ${missingKeywords.slice(0, 3).join(", ")}?`);
  }

  if (senioritySignals.length > 0) {
    questions.push("What scope, team size, budget, or decision authority can we prove for this level?");
  }

  questions.push("Do you want to log this as an application and generate tailored materials?");

  return questions.slice(0, 3);
}

function readSenioritySignals(jobText: string) {
  const normalized = jobText.toLowerCase();

  return [
    "director",
    "executive",
    "lead",
    "manager",
    "principal",
    "senior",
    "strategy",
    "stakeholder",
  ]
    .filter((signal) => normalized.includes(signal))
    .slice(0, 6);
}

function buildFitSummary({
  alignmentThemes,
  matchedKeywords,
  recommendation,
  score,
}: {
  alignmentThemes: string[];
  matchedKeywords: string[];
  recommendation: JobFitAnalysis["recommendation"];
  score: number;
}) {
  const label = {
    needs_profile: "needs more profile evidence",
    possible_match: "could be worth a closer look",
    strong_match: "looks promising",
    weak_match: "looks like a stretch right now",
  }[recommendation];
  const alignmentText =
    alignmentThemes.length > 0
      ? ` Strongest alignment themes: ${alignmentThemes.slice(0, 3).join(", ")}.`
      : "";
  const matchText =
    matchedKeywords.length > 0
      ? ` Matched areas include ${matchedKeywords.slice(0, 4).join(", ")}.`
      : "";

  return `Match is ${score}% and ${label}.${alignmentText}${matchText}`;
}

function readSignalGroups(text: string) {
  const normalized = normalizeKeyword(text);

  return fitSignalGroups
    .filter((group) => group.terms.some((term) => normalized.includes(normalizeKeyword(term))))
    .map((group) => group.label);
}

function matchesAnyCandidateKeyword(keyword: string, normalizedCandidateTerms: string[]) {
  const normalizedKeyword = normalizeKeyword(keyword);

  return normalizedCandidateTerms.some((candidateTerm) => {
    if (candidateTerm === normalizedKeyword) {
      return true;
    }

    if (candidateTerm.length >= 6 && normalizedKeyword.includes(candidateTerm)) {
      return true;
    }

    if (normalizedKeyword.length >= 6 && candidateTerm.includes(normalizedKeyword)) {
      return true;
    }

    return significantTokens(normalizedKeyword).some((token) =>
      significantTokens(candidateTerm).includes(token),
    );
  });
}

function significantTokens(value: string) {
  return value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 5 && !ignoredTerms.has(token));
}

function uniqueKeywords(values: string[]) {
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const value of values) {
    const normalized = normalizeKeyword(value);

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    keywords.push(value.trim());
  }

  return keywords;
}

function normalizeKeyword(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9+#/.-]+/g, " ").trim();
}

function parseOptionalResumeContent(value: unknown) {
  if (!value) {
    return null;
  }

  try {
    return parseResumeContent(value);
  } catch {
    return null;
  }
}
