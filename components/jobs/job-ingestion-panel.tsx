"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleHelp, ExternalLink, Sparkles } from "lucide-react";
import type { JobOverview } from "@/lib/jobs/job-overview";

type JobIngestionPanelProps = {
  overview: JobOverview;
  showEmptyState?: boolean;
};

const jobFilters = ["All", "Ready", "Accepted", "Rejected", "Needs attention"] as const;

type JobFilter = (typeof jobFilters)[number];

export function JobIngestionPanel({ overview, showEmptyState = false }: JobIngestionPanelProps) {
  const router = useRouter();
  const [activeJobFilter, setActiveJobFilter] = useState<JobFilter>("All");
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (overview.recentJobs.length === 0 && !showEmptyState) {
    return null;
  }

  const visibleJobs = overview.recentJobs.filter((job) => jobMatchesFilter(job, activeJobFilter));
  const filterCounts = buildJobFilterCounts(overview.recentJobs);

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

      const applicationId = payload.application?.id;

      if (!applicationId) {
        setMessage(
          payload.created
            ? "Application logged. Next we should generate targeted materials."
            : "That application was already logged.",
        );
        router.refresh();
        return;
      }

      const materialResult = await generateAndExportMaterials(applicationId);

      setMessage(
        payload.created
          ? `Application logged. ${materialResult}`
          : `That application was already logged. ${materialResult}`,
      );
      router.refresh();
    } finally {
      setPendingJobId(null);
    }
  }

  async function generateAndExportMaterials(applicationId: string) {
    const materialResponse = await fetch(`/api/applications/${applicationId}/materials`, {
      method: "POST",
    });
    const materialPayload = await materialResponse.json();

    if (!materialResponse.ok) {
      return materialPayload.error?.message ?? "Targeted materials could not be generated yet.";
    }

    const exportResponse = await fetch(`/api/applications/${applicationId}/materials/export`, {
      method: "POST",
    });
    const exportPayload = await exportResponse.json();

    if (!exportResponse.ok) {
      return `${materialPayload.summary ?? "Targeted materials generated."} ${exportPayload.error?.message ?? "Export needs another attempt from Applications."}`;
    }

    return `${materialPayload.summary ?? "Targeted materials generated."} Validated PDF and DOCX files are ready in Applications and Artifacts.`;
  }

  async function updateReviewStatus(jobId: string, reviewStatus: "accepted" | "rejected") {
    setPendingJobId(jobId);
    setMessage(null);

    try {
      const response = await fetch(`/api/jobs/${jobId}/review-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewStatus }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to update that job.");
        return;
      }

      setMessage(
        reviewStatus === "accepted"
          ? "Saved as a role worth pursuing."
          : "Removed from the active review lane.",
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
        <p>
          A focused queue of roles Pramania has read, scored, and kept ready for your decision.
        </p>
      </div>

      <div className="record-filter-strip" aria-label="Job review filters">
        {jobFilters.map((filter) => (
          <button
            aria-pressed={activeJobFilter === filter}
            className={`record-filter-chip ${activeJobFilter === filter ? "active" : ""}`}
            key={filter}
            onClick={() => setActiveJobFilter(filter)}
            type="button"
          >
            <strong>{filterCounts[filter]}</strong>
            <span>{filter}</span>
          </button>
        ))}
      </div>

      <div className="record-list job-record-list">
        {message ? <p className="system-note success">{message}</p> : null}
        {overview.recentJobs.length === 0 ? (
          <p className="empty-state">
            Paste a public job post into Pramania to start a fit review.
          </p>
        ) : null}
        {overview.recentJobs.length > 0 && visibleJobs.length === 0 ? (
          <p className="empty-state">No roles match this filter yet.</p>
        ) : null}
        {visibleJobs.map((job) => (
          <article className="record-row job-record" key={job.id}>
            <button
              className="record-main-button"
              onClick={() => setExpandedJobId(expandedJobId === job.id ? null : job.id)}
              type="button"
            >
              <span className="record-title">{job.title ?? formatJobUrl(job.job_url)}</span>
              <span className="record-meta">
                {job.company ?? formatJobUrl(job.resolved_url ?? job.job_url)} · Added{" "}
                <time dateTime={job.created_at}>{formatShortDate(job.created_at)}</time>
              </span>
              {job.fitSnapshot.score !== null ? (
                <span className="record-summary">{job.fitAnalysis.summary}</span>
              ) : null}
            </button>

            <div className="record-date-column">
              <span>{formatReviewStatus(job.review_status)}</span>
              <strong>{formatIngestionStatus(job.ingestion_status)}</strong>
            </div>

            <div className="record-status-stack">
              {job.fitSnapshot.score !== null ? (
                <span className="fit-score-pill">{job.fitSnapshot.score}% fit</span>
              ) : null}
            </div>

            <div className="record-actions">
              <button
                className="secondary-action compact-action"
                onClick={() => setExpandedJobId(expandedJobId === job.id ? null : job.id)}
                type="button"
              >
                {expandedJobId === job.id ? "Hide" : "Details"}
              </button>
              <a
                className="secondary-action compact-action"
                href={job.resolved_url ?? job.job_url}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink size={14} aria-hidden="true" />
                Open
              </a>
              {job.ingestion_status === "succeeded" ? (
                <button
                  className="secondary-action compact-action"
                  disabled={pendingJobId === job.id}
                  onClick={() => logApplication(job.id)}
                  title="Log this job, generate targeted materials, and export validated PDF/DOCX files when possible"
                  type="button"
                >
                  <Sparkles size={14} aria-hidden="true" />
                  {pendingJobId === job.id ? "Working" : "Apply"}
                </button>
              ) : null}
            </div>

            {expandedJobId === job.id ? (
              <div className="record-detail-panel">
                <div className="fit-review-grid compact-fit-grid" aria-label="Fit review details">
                  <FitBucket
                    icon="match"
                    items={job.fitAnalysis.matchedKeywords}
                    label="Aligned"
                    placeholder="Pramania has not found clear alignment yet."
                  />
                  <FitBucket
                    icon="risk"
                    items={job.fitAnalysis.missingKeywords}
                    label="Gaps to Validate"
                    placeholder="No obvious gaps from the readable post."
                  />
                  <FitBucket
                    icon="question"
                    items={job.fitAnalysis.questions}
                    label="Decision Questions"
                    placeholder="No follow-up questions yet."
                  />
                </div>
                <div className="record-action-strip">
                  <button
                    className="secondary-action compact-action"
                    disabled={pendingJobId === job.id}
                    onClick={() => updateReviewStatus(job.id, "rejected")}
                    title="Remove this role from active review"
                    type="button"
                  >
                    Reject
                  </button>
                  <button
                    className="secondary-action compact-action"
                    disabled={pendingJobId === job.id}
                    onClick={() => updateReviewStatus(job.id, "accepted")}
                    title="Keep this role as worth pursuing"
                    type="button"
                  >
                    Accept
                  </button>
                </div>
                {job.failure_reason ? (
                  <p className="source-failure">{formatFailureReason(job.failure_reason)}</p>
                ) : null}
                <div className="job-description-preview">
                  <strong>Readable job-post excerpt</strong>
                  <p>{job.extracted_text?.slice(0, 1400) ?? "No readable job text available."}</p>
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function formatReviewStatus(status: string) {
  const labels: Record<string, string> = {
    accepted: "accepted",
    needs_review: "needs review",
    rejected: "rejected",
  };

  return labels[status] ?? "needs review";
}

function formatIngestionStatus(status: string) {
  const labels: Record<string, string> = {
    failed: "Needs attention",
    pending: "Queued",
    processing: "Reading",
    succeeded: "Ready",
  };

  return labels[status] ?? status.replace("_", " ");
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

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
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

function jobMatchesFilter(job: JobOverview["recentJobs"][number], filter: JobFilter) {
  if (filter === "All") {
    return true;
  }

  if (filter === "Ready") {
    return job.ingestion_status === "succeeded" && job.review_status === "needs_review";
  }

  if (filter === "Accepted") {
    return job.review_status === "accepted";
  }

  if (filter === "Rejected") {
    return job.review_status === "rejected";
  }

  return job.ingestion_status === "failed";
}

function buildJobFilterCounts(jobs: JobOverview["recentJobs"]) {
  return jobFilters.reduce<Record<JobFilter, number>>(
    (counts, filter) => {
      counts[filter] = jobs.filter((job) => jobMatchesFilter(job, filter)).length;
      return counts;
    },
    {
      Accepted: 0,
      All: 0,
      "Needs attention": 0,
      Ready: 0,
      Rejected: 0,
    },
  );
}
