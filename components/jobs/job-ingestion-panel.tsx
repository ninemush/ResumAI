"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, Loader2 } from "lucide-react";

import type { JobOverview } from "@/lib/jobs/job-overview";

type JobIngestionPanelProps = {
  overview: JobOverview;
};

type JobStatus = {
  tone: "success" | "error" | "info";
  message: string;
};

export function JobIngestionPanel({ overview }: JobIngestionPanelProps) {
  const router = useRouter();
  const [jobUrl, setJobUrl] = useState("");
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedUrl = jobUrl.trim();

    if (!trimmedUrl) {
      return;
    }

    setIsSubmitting(true);
    setStatus({ tone: "info", message: "Reading the job post..." });

    const response = await fetch("/api/jobs/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobUrl: trimmedUrl }),
    });
    const payload = await response.json();

    setIsSubmitting(false);

    if (!response.ok) {
      setStatus({
        tone: "error",
        message: payload.error?.message ?? "Unable to ingest that job post.",
      });
      return;
    }

    setJobUrl("");
    setStatus({
      tone: "success",
      message: `Job post saved with ${payload.job?.extractedTextLength ?? 0} characters of extracted text.`,
    });
    router.refresh();
  }

  return (
    <section className="jobs-panel" aria-label="Job post ingestion">
      <div className="section-heading">
        <p className="eyebrow">Job post</p>
        <h2>Add a role to evaluate</h2>
      </div>

      <form className="job-link-form" onSubmit={handleSubmit}>
        <BriefcaseBusiness size={18} aria-hidden="true" />
        <input
          disabled={isSubmitting}
          onChange={(event) => setJobUrl(event.target.value)}
          placeholder="Paste a public job posting URL"
          type="url"
          value={jobUrl}
        />
        <button disabled={isSubmitting || !jobUrl.trim()} type="submit">
          {isSubmitting ? <Loader2 className="spin" size={16} /> : "Ingest"}
        </button>
      </form>

      {status ? <p className={`source-status ${status.tone}`}>{status.message}</p> : null}

      {overview.recentJobs.length > 0 ? (
        <div className="job-list">
          {overview.recentJobs.map((job) => (
            <article className="job-row" key={job.id}>
              <div>
                <h3>{job.title ?? formatJobUrl(job.job_url)}</h3>
                <p>{job.company ?? formatJobUrl(job.resolved_url ?? job.job_url)}</p>
                {job.fitSnapshot.score !== null ? (
                  <p>
                    Fit snapshot: {job.fitSnapshot.score}% based on current profile
                    keywords.
                  </p>
                ) : null}
                {job.fitSnapshot.matchedKeywords.length > 0 ? (
                  <div className="keyword-row" aria-label="Matched profile keywords">
                    {job.fitSnapshot.matchedKeywords.map((keyword) => (
                      <span key={keyword}>{keyword}</span>
                    ))}
                  </div>
                ) : null}
                {job.failure_reason ? (
                  <p className="source-failure">{formatFailureReason(job.failure_reason)}</p>
                ) : null}
              </div>
              <span className={`source-pill ${job.ingestion_status}`}>
                {job.ingestion_status.replace("_", " ")}
              </span>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-state">
          Paste a public job posting link to test ingestion. Match analysis comes next.
        </p>
      )}
    </section>
  );
}

function formatJobUrl(jobUrl: string) {
  try {
    return new URL(jobUrl).hostname.replace(/^www\./, "");
  } catch {
    return "Job post";
  }
}

function formatFailureReason(reason: string) {
  const friendlyMessages: Record<string, string> = {
    JOB_FETCH_FAILED: "The page could not be fetched.",
    JOB_PAGE_TOO_LARGE: "The page is too large for the current ingest limit.",
    JOB_TEXT_TOO_SHORT: "Not enough job-post text was found.",
    JOB_UNSUPPORTED_CONTENT_TYPE: "The link did not return a readable job page.",
    JOB_URL_BLOCKED: "This URL is blocked for safety.",
  };

  return friendlyMessages[reason] ?? "Ingestion needs another attempt.";
}
