import "server-only";

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
    created_at: string;
    fitSnapshot: {
      matchedKeywords: string[];
      missingKeywords: string[];
      score: number | null;
    };
  }[];
  summary: {
    identified: number;
    readyForReview: number;
    failed: number;
  };
};

export async function getJobOverview(userId: string): Promise<JobOverview> {
  const supabase = await createClient();
  const [{ data: jobs }, { data: facts }] = await Promise.all([
    supabase
      .from("job_ingestions")
      .select(
        "id, job_url, resolved_url, title, company, extracted_text, ingestion_status, failure_reason, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("profile_facts")
      .select("fact_value")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const profileKeywords = extractProfileKeywords(
    (facts ?? []).map((fact) => fact.fact_value),
  );

  return {
    recentJobs: (jobs ?? []).slice(0, 5).map((job) => ({
      ...job,
      fitSnapshot: calculateFitSnapshot(job.extracted_text, profileKeywords),
    })),
    summary: {
      identified: jobs?.length ?? 0,
      readyForReview:
        jobs?.filter((job) => job.ingestion_status === "succeeded").length ?? 0,
      failed: jobs?.filter((job) => job.ingestion_status === "failed").length ?? 0,
    },
  };
}

function calculateFitSnapshot(jobText: string | null, profileKeywords: string[]) {
  if (!jobText || profileKeywords.length === 0) {
    return {
      matchedKeywords: [],
      missingKeywords: [],
      score: null,
    };
  }

  const normalizedJobText = jobText.toLowerCase();
  const matchedKeywords = profileKeywords
    .filter((keyword) => normalizedJobText.includes(keyword.toLowerCase()))
    .slice(0, 8);
  const missingKeywords = profileKeywords
    .filter((keyword) => !normalizedJobText.includes(keyword.toLowerCase()))
    .slice(0, 8);

  return {
    matchedKeywords,
    missingKeywords,
    score: Math.round((matchedKeywords.length / Math.max(profileKeywords.length, 1)) * 100),
  };
}

function extractProfileKeywords(factValues: string[]) {
  const ignored = new Set([
    "and",
    "for",
    "from",
    "led",
    "the",
    "with",
    "work",
  ]);

  return Array.from(
    new Set(
      factValues.flatMap((value) =>
        value
          .split(/[,.;:/|()[\]\n-]+|\s{2,}/)
          .map((part) => part.trim())
          .filter((part) => part.length >= 4)
          .filter((part) => !ignored.has(part.toLowerCase()))
          .slice(0, 4),
      ),
    ),
  ).slice(0, 20);
}
