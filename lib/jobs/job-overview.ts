import "server-only";

import { analyzeJobFit, readUserFitContext, type JobFitAnalysis } from "@/lib/jobs/job-fit";
import { createClient } from "@/lib/supabase/server";

export type JobOverview = {
  recentJobs: {
    id: string;
    job_url: string;
    resolved_url: string | null;
    title: string | null;
    company: string | null;
    extracted_text: string | null;
    ingestion_status: string;
    failure_reason: string | null;
    review_status: string;
    created_at: string;
    fitSnapshot: {
      matchedKeywords: string[];
      missingKeywords: string[];
      score: number | null;
    };
    fitAnalysis: JobFitAnalysis;
  }[];
  summary: {
    identified: number;
    readyForReview: number;
    failed: number;
  };
};

export async function getJobOverview(userId: string): Promise<JobOverview> {
  const supabase = await createClient();
  const [{ data: jobs }, fitContext] = await Promise.all([
    supabase
      .from("job_ingestions")
      .select(
        "id, job_url, resolved_url, title, company, extracted_text, ingestion_status, failure_reason, review_status, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
    readUserFitContext(userId),
  ]);

  return {
    recentJobs: (jobs ?? []).map((job) => {
      const fitAnalysis = analyzeJobFit({
        jobText: job.extracted_text,
        masterResume: fitContext.masterResume,
        profileFacts: fitContext.profileFacts,
      });

      return {
        ...job,
        review_status: "review_status" in job ? String(job.review_status) : "needs_review",
        fitAnalysis,
        fitSnapshot: {
          matchedKeywords: fitAnalysis.matchedKeywords,
          missingKeywords: fitAnalysis.missingKeywords,
          score: fitAnalysis.score,
        },
      };
    }),
    summary: {
      identified: jobs?.length ?? 0,
      readyForReview:
        jobs?.filter(
          (job) =>
            job.ingestion_status === "succeeded" &&
            (!("review_status" in job) || job.review_status === "needs_review"),
        ).length ?? 0,
      failed: jobs?.filter((job) => job.ingestion_status === "failed").length ?? 0,
    },
  };
}
