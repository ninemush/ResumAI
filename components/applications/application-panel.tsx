"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Archive,
  Download,
  ExternalLink,
  FileText,
  RefreshCcw,
  Save,
  ShieldCheck,
  WandSparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";

import type { ApplicationOverview } from "@/lib/applications/application-overview";
import type { ResumeContent } from "@/lib/resumes/resume-content";

type ApplicationPanelProps = {
  initialStageFilter?: StageFilter;
  overview: ApplicationOverview;
  showEmptyState?: boolean;
};

type MaterialReview = {
  application: {
    companyName: string;
    id: string;
    jobTitle: string | null;
    jobUrl: string;
    status: string;
  };
  coverLetter: {
    content: string;
    docxDownloadUrl: string | null;
    id: string;
    pdfDownloadUrl: string | null;
    status: string;
    updatedAt: string;
  } | null;
  exportReadiness: {
    canExport: boolean;
    status: "exported" | "missing_materials" | "ready_to_export";
    warnings: string[];
  };
  resume: {
    content: ResumeContent;
    docxDownloadUrl: string | null;
    id: string;
    pdfDownloadUrl: string | null;
    status: string;
    updatedAt: string;
  } | null;
};

const applicationStatuses = [
  { value: "draft", label: "Draft" },
  { value: "applied", label: "Applied" },
  { value: "no_reply", label: "No reply" },
  { value: "rejected", label: "Rejected" },
  { value: "interview_in_progress", label: "Interview in progress" },
  { value: "interviewed_not_selected", label: "Interviewed, not selected" },
  { value: "interviewed_selected", label: "Interviewed, selected" },
  { value: "withdrawn", label: "Withdrawn" },
];

export type StageFilter = "All" | "Review" | "Applied" | "Interview" | "Selected" | "Closed";
type ArchiveView = "active" | "archived";

export function ApplicationPanel({
  initialStageFilter = "All",
  overview,
  showEmptyState = false,
}: ApplicationPanelProps) {
  const router = useRouter();
  const [activeReview, setActiveReview] = useState<MaterialReview | null>(null);
  const [archiveView, setArchiveView] = useState<ArchiveView>("active");
  const [activeStageFilter, setActiveStageFilter] = useState<StageFilter>(initialStageFilter);
  const [coverLetterDraft, setCoverLetterDraft] = useState("");
  const [resumeDraft, setResumeDraft] = useState<ResumeContent | null>(null);
  const [exportingApplicationId, setExportingApplicationId] = useState<string | null>(null);
  const [generatingApplicationId, setGeneratingApplicationId] = useState<string | null>(null);
  const [loadingReviewApplicationId, setLoadingReviewApplicationId] = useState<string | null>(null);
  const [pendingApplicationId, setPendingApplicationId] = useState<string | null>(null);
  const [savingApplicationId, setSavingApplicationId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (overview.recentApplications.length === 0 && !showEmptyState) {
    return null;
  }

  const applicationsInArchiveView = overview.recentApplications.filter((application) =>
    archiveView === "archived" ? Boolean(application.archivedAt) : !application.archivedAt,
  );
  const visibleApplications = applicationsInArchiveView.filter((application) =>
    applicationMatchesStage(application.status, activeStageFilter),
  );
  const stageCounts = buildStageFilterCounts(applicationsInArchiveView);

  async function updateStatus(applicationId: string, status: string) {
    setPendingApplicationId(applicationId);
    setMessage(null);

    try {
      const response = await fetch(`/api/applications/${applicationId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to update application status.");
        return;
      }

      setMessage(`Updated ${payload.application?.companyName ?? "application"} to ${formatStatus(status)}.`);
      router.refresh();
    } finally {
      setPendingApplicationId(null);
    }
  }

  async function updateArchiveState(applicationId: string, archived: boolean) {
    setPendingApplicationId(applicationId);
    setMessage(null);

    try {
      const response = await fetch(`/api/applications/${applicationId}/archive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to update application archive state.");
        return;
      }

      if (activeReview?.application.id === applicationId && archived) {
        setActiveReview(null);
        setResumeDraft(null);
        setCoverLetterDraft("");
      }

      setMessage(
        archived
          ? "Archived that application. It is no longer shown with your current roles."
          : "Restored that application to your current roles.",
      );
      router.refresh();
    } finally {
      setPendingApplicationId(null);
    }
  }

  async function generateMaterials(applicationId: string) {
    setGeneratingApplicationId(applicationId);
    setMessage(null);

    try {
      const response = await fetch(`/api/applications/${applicationId}/materials`, {
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to generate materials.");
        return;
      }

      const exportResponse = await fetch(`/api/applications/${applicationId}/materials/export`, {
        method: "POST",
      });
      const exportPayload = await exportResponse.json();

      if (!exportResponse.ok) {
        setMessage(
          `${payload.summary ?? "Created role-specific resume and cover-letter drafts."} ${
            exportPayload.error?.message ??
            "Open the packet, review the drafts, then download PDF and DOCX files."
          }`,
        );
        await loadReview(applicationId);
        router.refresh();
        return;
      }

      setActiveReview(exportPayload.review);
      setResumeDraft(exportPayload.review.resume?.content ?? null);
      setCoverLetterDraft(exportPayload.review.coverLetter?.content ?? "");
      setMessage("Created and prepared downloadable resume and cover-letter PDF/DOCX files.");
      router.refresh();
    } finally {
      setGeneratingApplicationId(null);
    }
  }

  async function loadReview(applicationId: string) {
    setLoadingReviewApplicationId(applicationId);
    setMessage(null);

    try {
      const response = await fetch(`/api/applications/${applicationId}/materials`);
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to load materials.");
        return;
      }

      setActiveReview(payload.review);
      setResumeDraft(payload.review.resume?.content ?? null);
      setCoverLetterDraft(payload.review.coverLetter?.content ?? "");
    } finally {
      setLoadingReviewApplicationId(null);
    }
  }

  async function saveReview() {
    if (!activeReview || !resumeDraft) {
      return;
    }

    setSavingApplicationId(activeReview.application.id);
    setMessage(null);

    try {
      const response = await fetch(`/api/applications/${activeReview.application.id}/materials`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coverLetter: coverLetterDraft,
          resume: resumeDraft,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to save materials.");
        return;
      }

      setActiveReview(payload.review);
      setResumeDraft(payload.review.resume?.content ?? null);
      setCoverLetterDraft(payload.review.coverLetter?.content ?? "");
      setMessage("Saved material edits. Exports were reset so downloads match the latest content.");
      router.refresh();
    } finally {
      setSavingApplicationId(null);
    }
  }

  async function exportFiles() {
    if (!activeReview) {
      return;
    }

    setExportingApplicationId(activeReview.application.id);
    setMessage(null);

    try {
      const response = await fetch(`/api/applications/${activeReview.application.id}/materials/export`, {
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to export files.");
        return;
      }

      setActiveReview(payload.review);
      setResumeDraft(payload.review.resume?.content ?? null);
      setCoverLetterDraft(payload.review.coverLetter?.content ?? "");
      setMessage("PDF and DOCX files exported and stored securely.");
      router.refresh();
    } finally {
      setExportingApplicationId(null);
    }
  }

  return (
    <section className="applications-panel" aria-label="Tracked applications">
      <div className="section-heading">
        <p className="eyebrow">Applications</p>
        <h2>Roles you’re pursuing</h2>
        <p>
          A compact record of every role you choose to pursue: stage, materials,
          and the next follow-up decision.
        </p>
      </div>

      {overview.recentApplications.length > 0 ? (
        <div className="record-list-controls">
          <div className="record-view-toggle" aria-label="Application archive view">
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
          <div className="record-filter-strip" aria-label="Application stage filters">
            <button
              aria-pressed={activeStageFilter === "All"}
              className={`record-filter-chip ${activeStageFilter === "All" ? "active" : ""}`}
              onClick={() => setActiveStageFilter("All")}
              type="button"
            >
              <strong>{stageCounts.All}</strong>
              <span>All</span>
            </button>
            {stageCounts.byStage.map((stage) => (
              <button
                aria-pressed={activeStageFilter === stage.label}
                className={`record-filter-chip ${activeStageFilter === stage.label ? "active" : ""}`}
                key={stage.label}
                onClick={() => setActiveStageFilter(stage.label as StageFilter)}
                type="button"
              >
                <strong>{stage.value}</strong>
                <span>{stage.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="record-list application-record-list">
        {message ? <p className="system-note success">{message}</p> : null}
        {overview.recentApplications.length === 0 ? (
          <div className="record-empty-panel">
            <FileText size={18} aria-hidden="true" />
            <div>
              <strong>No applications logged yet</strong>
              <p>When you approve a role, it will appear here with its stage, tailored materials, and follow-up history.</p>
            </div>
          </div>
        ) : null}
        {overview.recentApplications.length > 0 && applicationsInArchiveView.length === 0 ? (
          <p className="empty-state">
            {archiveView === "archived"
              ? "No archived applications yet."
              : "No active applications right now. Archived applications are still available from the Archived view."}
          </p>
        ) : null}
        {applicationsInArchiveView.length > 0 && visibleApplications.length === 0 ? (
          <p className="empty-state">No applications in this stage yet.</p>
        ) : null}
        {visibleApplications.length > 0 ? (
          <div className="record-table-header application-record-header" aria-hidden="true">
            <span>Role</span>
            <span>Materials</span>
            <span>Stage</span>
            <span>Actions</span>
          </div>
        ) : null}
        {visibleApplications.map((application) => (
          <article className="record-row application-record compact-application-row" key={application.id}>
            <button
              className="record-main-button application-title-cell"
              onClick={() => loadReview(application.id)}
              title="Open tailored materials and application details"
              type="button"
            >
              <span className="record-title">{cleanDisplayText(application.jobTitle ?? "Application")}</span>
              <span className="record-meta">
                {cleanDisplayText(application.companyName)} · Updated {formatShortDate(application.updatedAt)}
              </span>
              <span className="record-subtle-line">
                {formatLatestActivity(application)}
              </span>
            </button>

            <div className="application-material-cell">
              <button
                className="record-main-button"
                onClick={() => loadReview(application.id)}
                title="Open tailored resume and cover letter"
                type="button"
              >
                <span className="record-summary">
                  {application.latestResumeHeadline
                    ? cleanDisplayText(application.latestResumeHeadline)
                    : "Materials not fully ready"}
                </span>
                <span className="record-material-row">
                  <span className={materialPillClass(application.latestResumeStatus)}>
                    Resume {formatMaterialStatus(application.latestResumeStatus)}
                  </span>
                  <span className={materialPillClass(application.latestCoverLetterStatus)}>
                    Letter {formatMaterialStatus(application.latestCoverLetterStatus)}
                  </span>
                </span>
              </button>
              {application.latestResumePdfUrl ||
              application.latestResumeDocxUrl ||
              application.latestCoverLetterPdfUrl ||
              application.latestCoverLetterDocxUrl ? (
                <span className="record-download-row">
                  {application.latestResumePdfUrl ? (
                    <a href={application.latestResumePdfUrl} rel="noreferrer" target="_blank">
                      Resume PDF
                    </a>
                  ) : null}
                  {application.latestResumeDocxUrl ? (
                    <a href={application.latestResumeDocxUrl} rel="noreferrer" target="_blank">
                      Resume DOCX
                    </a>
                  ) : null}
                  {application.latestCoverLetterPdfUrl ? (
                    <a href={application.latestCoverLetterPdfUrl} rel="noreferrer" target="_blank">
                      Letter PDF
                    </a>
                  ) : null}
                  {application.latestCoverLetterDocxUrl ? (
                    <a href={application.latestCoverLetterDocxUrl} rel="noreferrer" target="_blank">
                      Letter DOCX
                    </a>
                  ) : null}
                </span>
              ) : null}
            </div>

            <div className="application-stage-cell">
              <select
                aria-label={`Update ${application.companyName} application status`}
                className="status-select compact-status-select"
                disabled={pendingApplicationId === application.id || Boolean(application.archivedAt)}
                onChange={(event) => updateStatus(application.id, event.target.value)}
                title={application.archivedAt ? "Restore this application before changing its stage" : undefined}
                value={application.status}
              >
                {applicationStatuses.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
              <span>{formatStatus(application.status)}</span>
            </div>

            <div className="record-actions">
              <a
                className="secondary-action compact-action"
                href={application.jobUrl}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink size={14} aria-hidden="true" />
                Job
              </a>
              <button
                className="secondary-action compact-action"
                disabled={generatingApplicationId === application.id || Boolean(application.archivedAt)}
                onClick={() => generateMaterials(application.id)}
                type="button"
                title={
                  application.archivedAt
                    ? "Restore this application before generating materials"
                    : "Create a role-specific resume and cover letter, then export PDF and DOCX files"
                }
              >
                <WandSparkles size={14} aria-hidden="true" />
                {generatingApplicationId === application.id
                  ? "Creating"
                  : application.latestResumeHasPdf &&
                      application.latestResumeHasDocx &&
                      application.latestCoverLetterHasPdf &&
                      application.latestCoverLetterHasDocx
                    ? "Regenerate"
                    : "Create packet"}
              </button>
              <button
                className="secondary-action compact-action"
                disabled={loadingReviewApplicationId === application.id}
                onClick={() => loadReview(application.id)}
                type="button"
              >
                <FileText size={14} aria-hidden="true" />
                {loadingReviewApplicationId === application.id ? "Opening" : "Open packet"}
              </button>
              <button
                className="secondary-action compact-action"
                disabled={pendingApplicationId === application.id}
                onClick={() => updateArchiveState(application.id, !application.archivedAt)}
                title={
                  application.archivedAt
                    ? "Move this application back to current roles"
                    : "Archive this application"
                }
                type="button"
              >
                {application.archivedAt ? (
                  <RefreshCcw size={14} aria-hidden="true" />
                ) : (
                  <Archive size={14} aria-hidden="true" />
                )}
                {application.archivedAt ? "Restore" : "Archive"}
              </button>
            </div>
          </article>
        ))}
      </div>

      {activeReview ? (
        <section className="materials-review" aria-label="Application materials review">
          <div className="materials-review-header">
            <div>
              <p className="eyebrow">Application packet</p>
              <h2>
                {activeReview.application.jobTitle ?? "Application"} at{" "}
                {activeReview.application.companyName}
              </h2>
            </div>
            <div className="review-actions">
              <button
                className="secondary-action"
                disabled={!resumeDraft || savingApplicationId === activeReview.application.id}
                onClick={saveReview}
                type="button"
              >
                <Save size={15} aria-hidden="true" />
                {savingApplicationId === activeReview.application.id ? "Saving..." : "Save"}
              </button>
              <button
                className="secondary-action"
                disabled={
                  !activeReview.exportReadiness.canExport ||
                  exportingApplicationId === activeReview.application.id
                }
                onClick={exportFiles}
                title={
                  activeReview.exportReadiness.canExport
                    ? "Download resume and cover-letter PDF/DOCX files"
                    : "Create both resume and cover-letter drafts before downloading"
                }
                type="button"
              >
                <Download size={15} aria-hidden="true" />
                {exportingApplicationId === activeReview.application.id ? "Preparing..." : "Download files"}
              </button>
            </div>
          </div>

          <div className={`material-readiness ${activeReview.exportReadiness.status}`}>
            <strong>
              <ShieldCheck size={15} aria-hidden="true" />
              {formatExportStatus(activeReview.exportReadiness.status)}
            </strong>
            {activeReview.exportReadiness.warnings.length > 0 ? (
              <ul>
                {activeReview.exportReadiness.warnings.map((warning) => (
                  <li key={warning}>
                    <AlertTriangle size={14} aria-hidden="true" />
                    {warning}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Files are ready for PDF and DOCX download.</p>
            )}
          </div>

          {!resumeDraft || !activeReview.coverLetter ? (
            <p className="empty-state">Create the packet first, then this review area becomes editable.</p>
          ) : (
            <div className="materials-review-layout">
              <section className="material-document-editor" aria-label="Targeted resume editor">
                <div className="material-document-heading">
                  <p className="eyebrow">Targeted resume</p>
                  <label>
                    Headline
                    <input
                      value={resumeDraft.headline}
                      onChange={(event) =>
                        setResumeDraft({ ...resumeDraft, headline: event.target.value })
                      }
                    />
                  </label>
                </div>
                <label>
                  Professional summary
                  <textarea
                    rows={5}
                    value={resumeDraft.summary}
                    onChange={(event) =>
                      setResumeDraft({ ...resumeDraft, summary: event.target.value })
                    }
                  />
                </label>
                <label>
                  Core skills
                  <textarea
                    rows={3}
                    value={resumeDraft.skills.join("\n")}
                    onChange={(event) =>
                      setResumeDraft({
                        ...resumeDraft,
                        skills: splitLines(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Experience and impact bullets
                  <textarea
                    rows={10}
                    value={readResumeExperienceDraft(resumeDraft)}
                    onChange={(event) =>
                      setResumeDraft({
                        ...resumeDraft,
                        experienceBullets: splitLines(event.target.value),
                        experienceSections: [],
                      })
                    }
                  />
                </label>
              </section>

              <aside className="material-review-notes" aria-label="Review notes">
                <label>
                  Gaps to verify
                  <textarea
                    rows={5}
                    value={resumeDraft.keywordGaps.join("\n")}
                    onChange={(event) =>
                      setResumeDraft({
                        ...resumeDraft,
                        keywordGaps: splitLines(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Reviewer notes
                  <textarea
                    rows={5}
                    value={resumeDraft.reviewerNotes.join("\n")}
                    onChange={(event) =>
                      setResumeDraft({
                        ...resumeDraft,
                        reviewerNotes: splitLines(event.target.value),
                      })
                    }
                  />
                </label>
              </aside>

              <label className="cover-letter-editor">
                Cover letter
                <textarea
                  rows={12}
                  value={coverLetterDraft}
                  onChange={(event) => setCoverLetterDraft(event.target.value)}
                />
              </label>
            </div>
          )}

          {activeReview.resume?.pdfDownloadUrl ||
          activeReview.resume?.docxDownloadUrl ||
          activeReview.coverLetter?.pdfDownloadUrl ||
          activeReview.coverLetter?.docxDownloadUrl ? (
            <div className="download-row" aria-label="Material downloads">
              {activeReview.resume?.pdfDownloadUrl ? (
                <a href={activeReview.resume.pdfDownloadUrl} rel="noreferrer" target="_blank">
                  Resume PDF
                </a>
              ) : null}
              {activeReview.resume?.docxDownloadUrl ? (
                <a href={activeReview.resume.docxDownloadUrl} rel="noreferrer" target="_blank">
                  Resume DOCX
                </a>
              ) : null}
              {activeReview.coverLetter?.pdfDownloadUrl ? (
                <a href={activeReview.coverLetter.pdfDownloadUrl} rel="noreferrer" target="_blank">
                  Cover letter PDF
                </a>
              ) : null}
              {activeReview.coverLetter?.docxDownloadUrl ? (
                <a href={activeReview.coverLetter.docxDownloadUrl} rel="noreferrer" target="_blank">
                  Cover letter DOCX
                </a>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

function formatStatus(status: string) {
  return applicationStatuses.find((item) => item.value === status)?.label ?? status.replaceAll("_", " ");
}

function formatLatestActivity(
  application: ApplicationOverview["recentApplications"][number],
) {
  const latestEvent = application.statusEvents[0];
  if (!latestEvent) {
    return `Created ${formatShortDate(application.createdAt)}`;
  }

  return `${formatStatus(latestEvent.newStatus)} · ${formatShortDate(latestEvent.createdAt)}`;
}

function formatMaterialStatus(status: string | null) {
  if (!status) {
    return "needs generation";
  }

  const labels: Record<string, string> = {
    draft: "draft",
    exported: "exported",
    failed: "needs review",
    ready: "ready",
  };

  return labels[status] ?? status.replaceAll("_", " ");
}

function materialPillClass(status: string | null) {
  if (status === "exported" || status === "ready") {
    return "material-pill ready";
  }

  if (status === "failed") {
    return "material-pill warning";
  }

  return "material-pill";
}

function formatExportStatus(status: MaterialReview["exportReadiness"]["status"]) {
  const labels: Record<MaterialReview["exportReadiness"]["status"], string> = {
    exported: "Files exported",
    missing_materials: "Packet incomplete",
    ready_to_export: "Ready to download",
  };

  return labels[status];
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function buildStageFilterCounts(applications: ApplicationOverview["recentApplications"]) {
  const byStage = (["Review", "Applied", "Interview", "Selected", "Closed"] as const).map(
    (stage) => ({
      label: stage,
      value: applications.filter((application) => applicationMatchesStage(application.status, stage)).length,
    }),
  );

  return {
    All: applications.length,
    byStage,
  };
}

function cleanDisplayText(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim().replace(/^-+\s*/, ""))
    .filter(Boolean);
}

function readResumeExperienceDraft(resume: ResumeContent) {
  if (resume.experienceSections.length > 0) {
    return resume.experienceSections
      .map((section) => {
        const heading = [section.roleTitle, section.company].filter(Boolean).join(" · ");
        const dates = [section.dates, section.location].filter(Boolean).join(" · ");
        const bullets = section.bullets.map((bullet) => `- ${bullet}`).join("\n");

        return [heading, dates, bullets].filter(Boolean).join("\n");
      })
      .join("\n\n");
  }

  return resume.experienceBullets.map((bullet) => `- ${bullet}`).join("\n");
}

function applicationMatchesStage(status: string, stage: StageFilter) {
  if (stage === "All") {
    return true;
  }

  const stageStatuses: Record<Exclude<StageFilter, "All">, Set<string>> = {
    Applied: new Set(["applied", "no_reply"]),
    Closed: new Set(["rejected", "interviewed_not_selected", "withdrawn"]),
    Interview: new Set([
      "interview_in_progress",
      "interviewed_not_selected",
      "interviewed_selected",
    ]),
    Review: new Set(["draft"]),
    Selected: new Set(["interviewed_selected"]),
  };

  return stageStatuses[stage].has(status);
}
