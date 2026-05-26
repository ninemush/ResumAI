"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleHelp, Sparkles } from "lucide-react";
import type { JobOverview } from "@/lib/jobs/job-overview";

type JobIngestionPanelProps = {
  overview: JobOverview;
  showEmptyState?: boolean;
};

export function JobIngestionPanel({ overview, showEmptyState = false }: JobIngestionPanelProps) {
  const router = useRouter();
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (overview.recentJobs.length === 0 && !showEmptyState) {
    return null;
  }

  async function logApplication(jobId: string) {
    setPendingJobId(jobId);
    setMessage(null);

    try {
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIngestionId: jobId, status: "draft" }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to log that application.");
        return;
      }

      setMessage(
        payload.created
          ? "Application logged. Next we should generate targeted materials."
          : "That application was already logged.",
      );
      router.refresh();
    } finally {
      setPendingJobId(null);
    }
  }

  return (
    <section className="jobs-panel" aria-label="Recent job posts">
      <div className="section-heading">
        <p className="eyebrow">Jobs</p>
        <h2>Roles under review</h2>
      </div>

      <div className="job-list">
        {message ? <p className="system-note success">{message}</p> : null}
        {overview.recentJobs.length === 0 ? (
          <p className="empty-state">
            Paste a public job post into Pramania to start a fit review.
          </p>
        ) : null}
        {overview.recentJobs.map((job) => (
          <article className="job-row" key={job.id}>
            <div>
              <h3>{job.title ?? formatJobUrl(job.job_url)}</h3>
              <p>{job.company ?? formatJobUrl(job.resolved_url ?? job.job_url)}</p>
              {job.fitSnapshot.score !== null ? (
                <p>
                  Fit review: {job.fitAnalysis.summary}
                </p>
              ) : null}
              <div className="fit-review-grid" aria-label="Fit review details">
                <FitBucket
                  icon="match"
                  items={job.fitAnalysis.matchedKeywords}
                  label="Matched"
                  placeholder="No matched signals yet"
                />
                <FitBucket
                  icon="risk"
                  items={job.fitAnalysis.missingKeywords}
                  label="Gaps"
                  placeholder="No obvious gaps"
                />
                <FitBucket
                  icon="question"
                  items={job.fitAnalysis.questions}
                  label="Questions"
                  placeholder="No questions yet"
                />
              </div>
              {job.failure_reason ? (
                <p className="source-failure">{formatFailureReason(job.failure_reason)}</p>
              ) : null}
            </div>
            <span className={`source-pill ${job.ingestion_status}`}>
              {job.ingestion_status.replace("_", " ")}
            </span>
            {job.ingestion_status === "succeeded" ? (
              <button
                className="secondary-action"
                disabled={pendingJobId === job.id}
                onClick={() => logApplication(job.id)}
                title="Log this job as an application before generating tailored materials"
                type="button"
              >
                <Sparkles size={15} aria-hidden="true" />
                {pendingJobId === job.id ? "Logging..." : "Proceed"}
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function FitBucket({
  icon,
  items,
  label,
  placeholder,
}: {
  icon: "match" | "question" | "risk";
  items: string[];
  label: string;
  placeholder: string;
}) {
  const Icon = icon === "match" ? CheckCircle2 : icon === "risk" ? AlertTriangle : CircleHelp;

  return (
    <div className={`fit-bucket ${icon}`}>
      <strong>
        <Icon size={14} aria-hidden="true" />
        {label}
      </strong>
      {items.length > 0 ? (
        <div className="keyword-row">
          {items.slice(0, 6).map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      ) : (
        <p>{placeholder}</p>
      )}
    </div>
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
