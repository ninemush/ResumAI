"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ClipboardPaste,
  CircleHelp,
  ExternalLink,
  Link2,
  RefreshCcw,
  Send,
  Sparkles,
} from "lucide-react";
import type { JobOverview } from "@/lib/jobs/job-overview";
import { brand } from "@/lib/brand";
import { createIdempotencyHeaders } from "@/lib/billing/idempotency";

type JobIngestionPanelProps = {
  overview: JobOverview;
  showEmptyState?: boolean;
};

const jobFilters = ["All", "Ready", "Accepted", "Rejected", "Needs attention"] as const;

type JobFilter = (typeof jobFilters)[number];
type ArchiveView = "active" | "archived";

export function JobIngestionPanel({ overview, showEmptyState = false }: JobIngestionPanelProps) {
  const router = useRouter();
  const [activeJobFilter, setActiveJobFilter] = useState<JobFilter>("All");
  const [archiveView, setArchiveView] = useState<ArchiveView>("active");
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [jobUrl, setJobUrl] = useState("");
  const [jobText, setJobText] = useState("");
  const [isIngestingJob, setIsIngestingJob] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (overview.recentJobs.length === 0 && !showEmptyState) {
    return null;
  }

  const jobsInArchiveView = overview.recentJobs.filter((job) =>
    archiveView === "archived" ? Boolean(job.archived_at) : !job.archived_at,
  );
  const visibleJobs = jobsInArchiveView.filter((job) => jobMatchesFilter(job, activeJobFilter));
  const filterCounts = buildJobFilterCounts(jobsInArchiveView);

  async function ingestJobFromUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedUrl = jobUrl.trim();

    if (!trimmedUrl) {
      setMessage("Paste a public job URL before adding it to review.");
      return;
    }

    setIsIngestingJob(true);
    setMessage(null);

    try {
      const response = await fetch("/api/jobs/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...createIdempotencyHeaders("jobIngest:jobs-panel"),
        },
        body: JSON.stringify({ jobUrl: trimmedUrl }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to read that job post.");
        return;
      }

      setJobUrl("");
      setMessage(
        payload.job?.title
          ? `Added ${payload.job.title} for fit review. Open the row to decide whether to pursue it.`
          : "Added that job for fit review. Open the row to decide whether to pursue it.",
      );
      router.refresh();
    } finally {
      setIsIngestingJob(false);
    }
  }

  function moveJobTextToChat() {
    const text = jobText.trim();

    if (!text) {
      setMessage("Paste the job description text first, then send it to chat for review.");
      return;
    }

    window.dispatchEvent(
      new CustomEvent("pramania:conversation-draft", {
        detail: {
          focus: true,
          source: "job-description-fallback",
          text: `Evaluate this pasted job description against my profile. If it is worth pursuing, help me save it as a job decision:\n\n${text}`,
        },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("pramania:focus-chat", {
        detail: {
          reason: "job-description-fallback",
        },
      }),
    );
    setMessage(`I moved the pasted job text into chat so ${brand.name} can review it with your profile context.`);
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

      setMessage(
        payload.created
          ? "Application logged as a draft pursuit. Open Applications to generate and preview the packet when you are ready."
          : "That application was already logged. Open Applications to preview or generate its packet.",
      );
      router.refresh();
    } finally {
      setPendingJobId(null);
    }
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

  async function updateArchiveState(jobId: string, archived: boolean) {
    setPendingJobId(jobId);
    setMessage(null);

    try {
      const response = await fetch(`/api/jobs/${jobId}/archive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to update that job.");
        return;
      }

      setMessage(archived ? "Archived that role. It is out of the active queue." : "Restored that role to active review.");
      router.refresh();
    } finally {
      setPendingJobId(null);
    }
  }

  return (
    <section className="jobs-panel" aria-label="Recent job posts">
      <div className="section-heading">
        <p className="eyebrow">Jobs</p>
        <h2>Role decisions</h2>
        <p>
          A focused queue of roles {brand.name} has read. Open a row to see fit,
          tradeoffs, and whether it is worth turning into tailored materials.
        </p>
      </div>

      <section className="job-add-panel" aria-label="Add a job for review">
        <form className="job-url-form" onSubmit={ingestJobFromUrl}>
          <label>
            <Link2 size={16} aria-hidden="true" />
            <span className="sr-only">Public job URL</span>
            <input
              inputMode="url"
              onChange={(event) => setJobUrl(event.target.value)}
              placeholder="Paste a public job URL"
              value={jobUrl}
            />
          </label>
          <button disabled={isIngestingJob || !jobUrl.trim()} type="submit">
            <Send size={15} aria-hidden="true" />
            {isIngestingJob ? "Reading..." : "Review fit"}
          </button>
        </form>
        <div className="job-text-fallback">
          <label>
            <ClipboardPaste size={16} aria-hidden="true" />
            <span>Unreadable posting or private page</span>
            <textarea
              onChange={(event) => setJobText(event.target.value)}
              placeholder="Paste job description text here, then send it to chat for profile-aware review."
              rows={2}
              value={jobText}
            />
          </label>
          <button
            className="secondary-action compact-action"
            disabled={!jobText.trim()}
            onClick={moveJobTextToChat}
            type="button"
          >
            Send pasted text to chat
          </button>
        </div>
      </section>

      {overview.recentJobs.length > 0 ? (
        <div className="record-list-controls">
          <div className="record-view-toggle" aria-label="Job archive view">
            <button
              aria-pressed={archiveView === "active"}
              className={`record-view-button ${archiveView === "active" ? "active" : ""}`}
              onClick={() => setArchiveView("active")}
              type="button"
            >
              Active <strong>{overview.summary.active}</strong>
            </button>
            <button
              aria-pressed={archiveView === "archived"}
              className={`record-view-button ${archiveView === "archived" ? "active" : ""}`}
              onClick={() => setArchiveView("archived")}
              type="button"
            >
              Archived <strong>{overview.summary.archived}</strong>
            </button>
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
        </div>
      ) : null}

      <div className="record-list job-record-list">
        {message ? <p className="system-note success">{message}</p> : null}
        {overview.recentJobs.length === 0 ? (
          <div className="record-empty-panel">
            <Sparkles size={18} aria-hidden="true" />
            <div>
              <strong>No job decisions yet</strong>
              <p>Paste a public job post into {brand.name}. It will read the role, compare it with your profile, and help you decide whether to apply.</p>
            </div>
          </div>
        ) : null}
        {overview.recentJobs.length > 0 && jobsInArchiveView.length === 0 ? (
          <p className="empty-state">
            {archiveView === "archived"
              ? "No archived roles yet."
              : "No active roles right now. Archived roles are still available from the Archived view."}
          </p>
        ) : null}
        {jobsInArchiveView.length > 0 && visibleJobs.length === 0 ? (
          <p className="empty-state">No roles match this filter yet.</p>
        ) : null}
        {visibleJobs.map((job) => (
          <article className="record-row job-record decision-card" key={job.id}>
            <button
              className="record-main-button"
              onClick={() => setExpandedJobId(expandedJobId === job.id ? null : job.id)}
              title="Open the fit review for this role"
              type="button"
            >
              <span className="record-title">{job.title ?? formatJobUrl(job.job_url)}</span>
              <span className="record-meta">
                {job.company ?? formatJobUrl(job.resolved_url ?? job.job_url)} · Added{" "}
                <time dateTime={job.created_at}>{formatShortDate(job.created_at)}</time>
              </span>
              <span className="record-summary">
                {job.fitSnapshot.score !== null
                  ? job.fitAnalysis.summary
                  : `Open the role once ${brand.name} has enough job-post detail.`}
              </span>
            </button>

            <div className="record-date-column">
              <span>{formatReviewStatus(job.review_status)}</span>
              <strong>{formatIngestionStatus(job.ingestion_status)}</strong>
            </div>

            <div className="record-status-stack">
              {job.fitSnapshot.score !== null ? (
                <span className="fit-score-pill">{job.fitSnapshot.score}% match</span>
              ) : null}
              <span className="record-next-action">{readJobNextAction(job)}</span>
            </div>

            <div className="record-actions">
              {!job.archived_at && job.ingestion_status === "succeeded" && job.review_status === "accepted" ? (
                <button
                  className="secondary-action compact-action compact-action-primary"
                  disabled={pendingJobId === job.id}
                  onClick={() => logApplication(job.id)}
                  title="Create a draft application record before generating role-specific materials"
                  type="button"
                >
                  <Sparkles size={14} aria-hidden="true" />
                  {pendingJobId === job.id
                    ? "Preparing"
                    : "Save to pursue"}
                </button>
              ) : (
                <button
                  className="secondary-action compact-action compact-action-primary"
                  onClick={() => setExpandedJobId(expandedJobId === job.id ? null : job.id)}
                  type="button"
                >
                  {job.review_status === "needs_review" ? "Review" : expandedJobId === job.id ? "Hide" : "Details"}
                </button>
              )}
            </div>

            {expandedJobId === job.id ? (
              <div className="record-detail-panel">
                <div className="fit-review-grid compact-fit-grid" aria-label="Fit review details">
                  <FitBucket
                    icon="match"
                    items={job.fitAnalysis.matchedKeywords}
                    label="Aligned"
                    placeholder={`${brand.name} has not found clear alignment yet.`}
                  />
                  <FitBucket
                    icon="risk"
                    items={job.fitAnalysis.missingKeywords}
                    label="Gaps to Validate"
                    placeholder="No obvious gaps from the available post detail."
                  />
                  <FitBucket
                    icon="question"
                    items={job.fitAnalysis.questions}
                    label="Decision Questions"
                    placeholder="No follow-up questions yet."
                  />
                </div>
                <div className="record-action-strip">
                  <a
                    className="secondary-action compact-action"
                    href={job.resolved_url ?? job.job_url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLink size={14} aria-hidden="true" />
                    Open post
                  </a>
                  {job.archived_at ? (
                    <button
                      className="secondary-action compact-action"
                      disabled={pendingJobId === job.id}
                      onClick={() => updateArchiveState(job.id, false)}
                      title="Move this role back to the active queue"
                      type="button"
                    >
                      <RefreshCcw size={14} aria-hidden="true" />
                      Restore
                    </button>
                  ) : (
                    <>
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
                      <button
                        className="secondary-action compact-action"
                        disabled={pendingJobId === job.id}
                        onClick={() => updateArchiveState(job.id, true)}
                        title="Archive this role"
                        type="button"
                      >
                        <Archive size={14} aria-hidden="true" />
                        Archive
                      </button>
                    </>
                  )}
                </div>
                {job.failure_reason ? (
                  <p className="source-failure">{formatFailureReason(job.failure_reason)}</p>
                ) : null}
                <div className="job-description-preview">
                  <strong>Job-post excerpt</strong>
                  <p>{job.extracted_text?.slice(0, 1400) ?? "No job-post detail is available yet."}</p>
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function readJobNextAction(job: JobOverview["recentJobs"][number]) {
  if (job.archived_at) {
    return "Restore if you want to revisit this role.";
  }

  if (job.ingestion_status === "failed") {
    return "Try a clearer public job post.";
  }

  if (job.ingestion_status !== "succeeded") {
    return `Wait for ${brand.name} to finish reading.`;
  }

  if (job.review_status === "accepted") {
    return "Create application packet.";
  }

  if (job.review_status === "rejected") {
    return "Archive or restore for review.";
  }

  return "Review fit, then accept or reject.";
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
    failed: "Couldn’t read",
    pending: "Reading",
    processing: "Reading",
    succeeded: "Ready",
  };

  return labels[status] ?? "Needs cleaner link";
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
    JOB_POSTING_UNAVAILABLE: "The specific post now opens a board or unavailable-posting page.",
    JOB_TEXT_TOO_SHORT: "Not enough job-post text was found.",
    JOB_UNSUPPORTED_CONTENT_TYPE: "The link did not return enough job-post detail.",
    JOB_URL_BLOCKED: "This URL is blocked for safety.",
  };

  return friendlyMessages[reason] ?? "This job post needs another read attempt.";
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
