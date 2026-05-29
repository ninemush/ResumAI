"use client";

import { useState } from "react";
import { AlertTriangle, Download, FileText, Save, ShieldCheck, WandSparkles } from "lucide-react";
import { useRouter } from "next/navigation";

import type { ApplicationOverview } from "@/lib/applications/application-overview";

type ApplicationPanelProps = {
  overview: ApplicationOverview;
  showEmptyState?: boolean;
};

type ResumeContent = {
  experienceBullets: string[];
  headline: string;
  keywordGaps: string[];
  reviewerNotes: string[];
  skills: string[];
  summary: string;
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

export function ApplicationPanel({ overview, showEmptyState = false }: ApplicationPanelProps) {
  const router = useRouter();
  const [activeReview, setActiveReview] = useState<MaterialReview | null>(null);
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

      setMessage(payload.summary ?? "Generated targeted resume and cover-letter materials.");
      if (activeReview?.application.id === applicationId) {
        await loadReview(applicationId);
      }
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
        <h2>Follow-up tracker</h2>
      </div>

      <div className="application-stage-strip" aria-label="Application stage summary">
        {overview.summary.byStage.map((stage) => (
          <span key={stage.label}>
            <strong>{stage.value}</strong>
            {stage.label}
          </span>
        ))}
      </div>

      <div className="record-list application-record-list">
        {message ? <p className="system-note success">{message}</p> : null}
        {overview.recentApplications.length === 0 ? (
          <p className="empty-state">
            Applications will appear here after you approve logging a readable job post.
          </p>
        ) : null}
        {overview.recentApplications.map((application) => (
          <article className="record-row application-record" key={application.id}>
            <button
              className="record-main-button"
              onClick={() => loadReview(application.id)}
              type="button"
            >
              <span className="record-title">{application.jobTitle ?? "Application"}</span>
              <span className="record-meta">
                {application.companyName} · {formatStatus(application.status)} · Updated{" "}
                {formatDate(application.updatedAt)}
              </span>
              <span className="record-summary">
                {application.latestResumeHeadline ??
                  `Materials: resume ${application.latestResumeStatus ?? "not ready"}, cover letter ${application.latestCoverLetterStatus ?? "not ready"}`}
              </span>
            </button>

            <select
              aria-label={`Update ${application.companyName} application status`}
              className="status-select compact-status-select"
              disabled={pendingApplicationId === application.id}
              onChange={(event) => updateStatus(application.id, event.target.value)}
              value={application.status}
            >
              {applicationStatuses.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>

            <div className="record-actions">
              <button
                className="secondary-action compact-action"
                disabled={generatingApplicationId === application.id}
                onClick={() => generateMaterials(application.id)}
                type="button"
              >
                <WandSparkles size={14} aria-hidden="true" />
                {generatingApplicationId === application.id ? "Generating" : "Generate"}
              </button>
              <button
                className="secondary-action compact-action"
                disabled={loadingReviewApplicationId === application.id}
                onClick={() => loadReview(application.id)}
                type="button"
              >
                <FileText size={14} aria-hidden="true" />
                {loadingReviewApplicationId === application.id ? "Opening" : "Review"}
              </button>
            </div>

            <div className="application-timeline compact-timeline" aria-label="Application status history">
              <strong>Latest status activity</strong>
              {application.statusEvents.length > 0 ? (
                application.statusEvents.slice(0, 2).map((event) => (
                  <span key={`${event.createdAt}-${event.newStatus}`}>
                    {formatStatus(event.previousStatus ?? "draft")} {"->"}{" "}
                    {formatStatus(event.newStatus)}
                    <em>{formatDate(event.createdAt)} via {event.source}</em>
                  </span>
                ))
              ) : (
                <span>
                  {formatStatus(application.status)}
                  <em>Current status</em>
                </span>
              )}
            </div>
            {application.latestCoverLetterExcerpt ? (
              <p className="record-subnote">Cover letter: {application.latestCoverLetterExcerpt}</p>
            ) : null}
          </article>
        ))}
      </div>

      {activeReview ? (
        <section className="materials-review" aria-label="Application materials review">
          <div className="materials-review-header">
            <div>
              <p className="eyebrow">Material review</p>
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
                    ? "Export validated resume and cover-letter PDF/DOCX files"
                    : "Generate both resume and cover-letter materials before exporting"
                }
                type="button"
              >
                <Download size={15} aria-hidden="true" />
                {exportingApplicationId === activeReview.application.id ? "Exporting..." : "Export files"}
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
              <p>Materials are ready for PDF and DOCX export.</p>
            )}
          </div>

          {!resumeDraft || !activeReview.coverLetter ? (
            <p className="empty-state">Generate materials first, then this review area becomes editable.</p>
          ) : (
            <div className="materials-editor-grid">
              <label>
                Resume headline
                <input
                  value={resumeDraft.headline}
                  onChange={(event) =>
                    setResumeDraft({ ...resumeDraft, headline: event.target.value })
                  }
                />
              </label>
              <label>
                Resume summary
                <textarea
                  rows={5}
                  value={resumeDraft.summary}
                  onChange={(event) =>
                    setResumeDraft({ ...resumeDraft, summary: event.target.value })
                  }
                />
              </label>
              <label>
                Skills
                <textarea
                  rows={4}
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
                Experience bullets
                <textarea
                  rows={8}
                  value={resumeDraft.experienceBullets.join("\n")}
                  onChange={(event) =>
                    setResumeDraft({
                      ...resumeDraft,
                      experienceBullets: splitLines(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                Keyword gaps to verify
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
                Reviewer notes and risk checks
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

function formatExportStatus(status: MaterialReview["exportReadiness"]["status"]) {
  const labels: Record<MaterialReview["exportReadiness"]["status"], string> = {
    exported: "Files exported",
    missing_materials: "Materials incomplete",
    ready_to_export: "Ready for validated export",
  };

  return labels[status];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function splitLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim().replace(/^-+\s*/, ""))
    .filter(Boolean);
}
