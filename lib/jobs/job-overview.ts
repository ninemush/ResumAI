import "server-only";

import { buildEvidenceBasedFitAnalysis } from "@/lib/jobs/evidence-based-fit";
import { analyzeJobFit, readUserFitContext, type JobFitAnalysis } from "@/lib/jobs/job-fit";
import { createClient } from "@/lib/supabase/server";

export type JobOverview = {
  recentJobs: {
    id: string;
    job_url: string | null;
    resolved_url: string | null;
    title: string | null;
    company: string | null;
    extracted_text: string | null;
    ingestion_status: string;
    failure_reason: string | null;
    review_status: string;
    archived_at: string | null;
    created_at: string;
    fitSnapshot: {
      matchedKeywords: string[];
      missingKeywords: string[];
      score: number | null;
    };
    fitAnalysis: JobFitAnalysis;
  }[];
  summary: {
    active: number;
    archived: number;
    identified: number;
    readyForReview: number;
    failed: number;
  };
};

type RawJob = {
  archived_at?: string | null;
  company: string | null;
  created_at: string;
  extracted_text: string | null;
  failure_reason: string | null;
  id: string;
  ingestion_status: string;
  job_url: string | null;
  resolved_url: string | null;
  review_status?: string | null;
  title: string | null;
};

export async function getJobOverview(userId: string): Promise<JobOverview> {
  const [jobs, fitContext] = await Promise.all([
    readJobs(userId),
    readUserFitContext(userId),
  ]);
  const activeJobs = jobs.filter((job) => !job.archived_at);

  return {
    recentJobs: jobs.map((job) => {
      const fitAnalysis = enrichFitAnalysis(analyzeJobFit({
        jobText: job.extracted_text,
        masterResume: fitContext.masterResume,
        profileFacts: fitContext.profileFacts,
      }));

      return {
        ...job,
        archived_at: job.archived_at ?? null,
        review_status: job.review_status ? String(job.review_status) : "needs_review",
        fitAnalysis,
        fitSnapshot: {
          matchedKeywords: fitAnalysis.matchedKeywords,
          missingKeywords: fitAnalysis.missingKeywords,
          score: fitAnalysis.score,
        },
      };
    }),
    summary: {
      active: activeJobs.length,
      archived: jobs.length - activeJobs.length,
      identified: activeJobs.length,
      readyForReview: activeJobs.filter(
        (job) =>
          job.ingestion_status === "succeeded" &&
          (!("review_status" in job) || job.review_status === "needs_review"),
      ).length,
      failed: activeJobs.filter((job) => job.ingestion_status === "failed").length,
    },
  };
}

async function readJobs(userId: string): Promise<RawJob[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_ingestions")
    .select(
      "id, job_url, resolved_url, title, company, extracted_text, ingestion_status, failure_reason, review_status, archived_at, created_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (!error) {
    return data ?? [];
  }

  if (!error.message.toLowerCase().includes("archived_at")) {
    throw new Error("JOB_OVERVIEW_READ_FAILED");
  }

  const fallback = await supabase
    .from("job_ingestions")
    .select(
      "id, job_url, resolved_url, title, company, extracted_text, ingestion_status, failure_reason, review_status, created_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (fallback.error) {
    throw new Error("JOB_OVERVIEW_READ_FAILED");
  }

  return (fallback.data ?? []).map((job) => ({ ...job, archived_at: null }));
}

function enrichFitAnalysis(fitAnalysis: JobFitAnalysis): JobFitAnalysis {
  const evidenceBased = buildEvidenceBasedFitAnalysis(fitAnalysis);

  return {
    ...fitAnalysis,
    evidenceBased,
    fitBand: mapFitBand(evidenceBased.recommendation),
  };
}

function mapFitBand(recommendation: ReturnType<typeof buildEvidenceBasedFitAnalysis>["recommendation"]) {
  if (recommendation === "apply") return "Strong fit";
  if (recommendation === "network_first") return "Plausible fit";
  if (recommendation === "stretch") return "Stretch";
  if (recommendation === "skip") return "Poor fit";
  return "Needs more profile evidence";
}
