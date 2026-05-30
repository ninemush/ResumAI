"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Download,
  ExternalLink,
  FileText,
  Save,
  ShieldCheck,
  WandSparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";

import type { ApplicationOverview } from "@/lib/applications/application-overview";
import type { ResumeContent } from "@/lib/resumes/resume-content";

type ApplicationPanelProps = {
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

type StageFilter = "All" | "Review" | "Applied" | "Interview" | "Selected" | "Closed";

export function ApplicationPanel({ overview, showEmptyState = false }: ApplicationPanelProps) {
  const router = useRouter();
  const [activeReview, setActiveReview] = useState<MaterialReview | null>(null);
  const [activeStageFilter, setActiveStageFilter] = useState<StageFilter>("All");
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

  const visibleApplications = overview.recentApplications.filter((application) =>
    applicationMatchesStage(application.status, activeStageFilter),
  );

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

      const exportResponse = await fetch(`/api/applications/${applicationId}/materials/export`, {
        method: "POST",
      });
      const exportPayload = await exportResponse.json();

      if (!exportResponse.ok) {
        setMessage(
          `${payload.summary ?? "Generated targeted resume and cover-letter materials."} ${
            exportPayload.error?.message ??
            "Review the drafts, then export PDF and DOCX files from the review panel."
          }`,
        );
        await loadReview(applicationId);
        router.refresh();
        return;
      }

      setActiveReview(exportPayload.review);
      setResumeDraft(exportPayload.review.resume?.content ?? null);
      setCoverLetterDraft(exportPayload.review.coverLetter?.content ?? "");
      setMessage("Generated, validated, and exported resume and cover-letter PDF/DOCX files.");
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
        <h2>Application pipeline</h2>
        <p>
          A compact record of every role you choose to pursue: stage, materials,
          and the next follow-up decision.
        </p>
      </div>

      {overview.recentApplications.length > 0 ? (
        <div className="record-filter-strip" aria-label="Application stage filters">
          <button
            aria-pressed={activeStageFilter === "All"}
            className={`record-filter-chip ${activeStageFilter === "All" ? "active" : ""}`}
            onClick={() => setActiveStageFilter("All")}
            type="button"
          >
            <strong>{overview.summary.total}</strong>
            <span>All</span>
          </button>
          {overview.summary.byStage.map((stage) => (
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
        {overview.recentApplications.length > 0 && visibleApplications.length === 0 ? (
          <p className="empty-state">No applications in this stage yet.</p>
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
            </button>

            <button
              className="record-main-button application-material-cell"
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
                {application.latestResumeHasPdf && application.latestResumeHasDocx ? (
                  <span className="material-pill ready">Resume files</span>
                ) : null}
                {application.latestCoverLetterHasPdf && application.latestCoverLetterHasDocx ? (
                  <span className="material-pill ready">Letter files</span>
                ) : null}
              </span>
            </button>

            <div className="application-stage-cell">
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
              <span>{formatLatestActivity(application)}</span>
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
                disabled={generatingApplicationId === application.id}
                onClick={() => generateMaterials(application.id)}
                type="button"
                title="Generate tailored resume and cover letter, then export PDF and DOCX files"
              >
                <WandSparkles size={14} aria-hidden="true" />
                {generatingApplicationId === application.id
                  ? "Generating files"
                  : application.latestResumeHasPdf &&
                      application.latestResumeHasDocx &&
                      application.latestCoverLetterHasPdf &&
                      application.latestCoverLetterHasDocx
                    ? "Regenerate files"
                    : "Generate files"}
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
    missing_materials: "Materials incomplete",
    ready_to_export: "Ready for validated export",
  };

  return labels[status];
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
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
