import type { JobOverview } from "@/lib/jobs/job-overview";

type JobIngestionPanelProps = {
  overview: JobOverview;
};

export function JobIngestionPanel({ overview }: JobIngestionPanelProps) {
  if (overview.recentJobs.length === 0) {
    return null;
  }

  return (
    <section className="jobs-panel" aria-label="Recent job posts">
      <div className="section-heading">
        <p className="eyebrow">Jobs</p>
        <h2>Roles under review</h2>
      </div>

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
