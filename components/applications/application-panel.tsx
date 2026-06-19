"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CalendarClock,
  Download,
  Eye,
  ExternalLink,
  FileText,
  Pencil,
  RefreshCcw,
  Save,
  Search,
  ShieldCheck,
  WandSparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { useTrustDialog } from "@/components/ui/trust-dialog";
import type { ApplicationOverview } from "@/lib/applications/application-overview";
import { CREDIT_COSTS, formatCreditCost } from "@/lib/billing/credit-catalog";
import {
  clearInFlightOperationId,
  createIdempotencyHeaders,
  getInFlightOperationId,
} from "@/lib/billing/idempotency";
import type { ResumeContent } from "@/lib/resumes/resume-content";

type ApplicationPanelProps = {
  initialStageFilter?: StageFilter;
  overview: ApplicationOverview;
  showEmptyState?: boolean;
};

type MaterialReview = {
  application: {
    companyName: string;
    displayName: string | null;
    id: string;
    jobTitle: string | null;
    jobUrl: string;
    status: string;
  };
  coverLetter: {
    claimRisks: {
      category:
        | "credential"
        | "education"
        | "employer"
        | "location"
        | "numeric_achievement"
        | "salary"
        | "seniority"
        | "title"
        | "work_eligibility";
      severity: "high";
      text: string;
    }[];
    content: string;
    docxDownloadUrl: string | null;
    id: string;
    pdfDownloadUrl: string | null;
    reviewerNotes: string[];
    status: string;
    updatedAt: string;
  } | null;
  exportReadiness: {
    blockingRisks: {
      category: "cover_letter_claim" | "keyword_gap" | "reviewer_note";
      severity: "high" | "medium";
      text: string;
    }[];
    canExport: boolean;
    claimReviewAcknowledged: boolean;
    requiresClaimReview: boolean;
    status: "export_failed" | "export_pending" | "exported" | "missing_materials" | "ready_to_export";
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

export type StageFilter = "All" | "Review" | "Draft" | "Applied" | "Interview" | "Selected" | "Closed" | "Archived";
type ArchiveView = "active" | "archived";
type MaterialReviewMode = "preview" | "edit";
type ApplicationSort = "recent" | "oldest" | "needs_action";
type ApplicationPlanDraft = {
  contactChannel: string;
  contactName: string;
  followUpAt: string;
  nextAction: string;
  notes: string;
  priority: "low" | "normal" | "high";
};

const emptyPlanDraft: ApplicationPlanDraft = {
  contactChannel: "",
  contactName: "",
  followUpAt: "",
  nextAction: "",
  notes: "",
  priority: "normal",
};

export function ApplicationPanel({
  initialStageFilter = "All",
  overview,
  showEmptyState = false,
}: ApplicationPanelProps) {
  const router = useRouter();
  const [activeReview, setActiveReview] = useState<MaterialReview | null>(null);
  const [activeReviewMode, setActiveReviewMode] = useState<MaterialReviewMode>("preview");
  const [archiveView, setArchiveView] = useState<ArchiveView>("active");
  const [activeStageFilter, setActiveStageFilter] = useState<StageFilter>(initialStageFilter);
  const [applicationQuery, setApplicationQuery] = useState("");
  const [applicationSort, setApplicationSort] = useState<ApplicationSort>("recent");
  const [coverLetterDraft, setCoverLetterDraft] = useState("");
  const [resumeDraft, setResumeDraft] = useState<ResumeContent | null>(null);
  const [claimReviewAcknowledged, setClaimReviewAcknowledged] = useState(false);
  const [exportingApplicationId, setExportingApplicationId] = useState<string | null>(null);
  const [editingPlanApplicationId, setEditingPlanApplicationId] = useState<string | null>(null);
  const [expandedApplicationId, setExpandedApplicationId] = useState<string | null>(null);
  const [generatingApplicationId, setGeneratingApplicationId] = useState<string | null>(null);
  const [loadingReviewApplicationId, setLoadingReviewApplicationId] = useState<string | null>(null);
  const [pendingApplicationId, setPendingApplicationId] = useState<string | null>(null);
  const [savingApplicationId, setSavingApplicationId] = useState<string | null>(null);
  const [planDraft, setPlanDraft] = useState<ApplicationPlanDraft>(emptyPlanDraft);
  const [message, setMessage] = useState<string | null>(null);
  const { confirm, TrustDialog } = useTrustDialog();
  const paidOperationIdsRef = useRef<Record<string, string | undefined>>({});

  if (overview.recentApplications.length === 0 && !showEmptyState) {
    return null;
  }

  const effectiveArchiveView = activeStageFilter === "Archived" ? "archived" : archiveView;
  const applicationsInArchiveView = overview.recentApplications.filter((application) =>
    effectiveArchiveView === "archived" ? Boolean(application.archivedAt) : !application.archivedAt,
  );
  const visibleApplications = sortApplications(
    applicationsInArchiveView
      .filter((application) => applicationMatchesStage(application, activeStageFilter))
      .filter((application) => applicationMatchesSearch(application, applicationQuery)),
    applicationSort,
  );
  const stageCounts = buildStageFilterCounts(overview.recentApplications);
  const activeReviewClaimAckSatisfied = Boolean(
    !activeReview?.exportReadiness.requiresClaimReview ||
      activeReview.exportReadiness.claimReviewAcknowledged ||
      claimReviewAcknowledged,
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

  function openPlanEditor(application: ApplicationOverview["recentApplications"][number]) {
    setEditingPlanApplicationId((current) => (current === application.id ? null : application.id));
    setPlanDraft({
      contactChannel: application.contactChannel ?? "",
      contactName: application.contactName ?? "",
      followUpAt: formatDateInputValue(application.followUpAt),
      nextAction: application.nextAction ?? "",
      notes: application.notes ?? "",
      priority: application.priority ?? "normal",
    });
    setMessage(null);
  }

  async function saveApplicationPlan(applicationId: string) {
    setPendingApplicationId(applicationId);
    setMessage(null);

    try {
      const response = await fetch(`/api/applications/${applicationId}/plan`, {
        body: JSON.stringify(planDraft),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to update application plan.");
        return;
      }

      setEditingPlanApplicationId(null);
      setMessage("Saved the application follow-up plan.");
      router.refresh();
    } finally {
      setPendingApplicationId(null);
    }
  }

  async function generateMaterials(applicationId: string) {
    if (
      !(await confirm({
        confirmLabel: "Use credits",
        consequence: "If a current packet already exists, the server reuses it and no new credits should be consumed.",
        description: "This will produce a tailored resume and cover letter draft for this application.",
        impact: `Credit impact: ${formatCreditCost(CREDIT_COSTS.applicationMaterialsGenerate)}.`,
        intent: "paid",
        title: "Generate application materials?",
      }))
    ) {
      return;
    }

    setGeneratingApplicationId(applicationId);
    setMessage(null);
    const operationScope = `applicationMaterialsGenerate:${applicationId}:applications-panel`;

    try {
      const response = await fetch(`/api/applications/${applicationId}/materials`, {
        headers: createIdempotencyHeaders(
          operationScope,
          getInFlightOperationId(paidOperationIdsRef, operationScope),
        ),
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to generate materials.");
        return;
      }

      const review = await fetchMaterialReview(applicationId);

      if (review) {
        setActiveReview(review);
        setActiveReviewMode("preview");
        setResumeDraft(review.resume?.content ?? null);
        setCoverLetterDraft(review.coverLetter?.content ?? "");
      }

      setMessage(
        `${payload.summary ?? "Created role-specific resume and cover-letter drafts."} Preview the packet before preparing downloads.`,
      );
      router.refresh();
    } finally {
      clearInFlightOperationId(paidOperationIdsRef, operationScope);
      setGeneratingApplicationId(null);
    }
  }

  async function fetchMaterialReview(applicationId: string) {
    const response = await fetch(`/api/applications/${applicationId}/materials`);
    const payload = await response.json();

    if (!response.ok) {
      setMessage(payload.error?.message ?? "Unable to load materials.");
      return null;
    }

    return payload.review as MaterialReview;
  }

  async function loadReview(applicationId: string) {
    setLoadingReviewApplicationId(applicationId);
    setMessage(null);

    try {
      const review = await fetchMaterialReview(applicationId);

      if (!review) {
        return;
      }

      setActiveReview(review);
      setActiveReviewMode("preview");
      setResumeDraft(review.resume?.content ?? null);
      setCoverLetterDraft(review.coverLetter?.content ?? "");
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
      setActiveReviewMode("preview");
      setClaimReviewAcknowledged(false);
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

    if (
      !(await confirm({
        confirmLabel: "Use credits",
        consequence: "If files are already validated, the server reuses them and no new credits should be consumed.",
        description: "This will produce validated PDF and DOCX files for the tailored resume and cover letter.",
        impact: `Credit impact: ${formatCreditCost(CREDIT_COSTS.applicationMaterialsExport)}.`,
        intent: "paid",
        title: "Prepare application files?",
      }))
    ) {
      return;
    }

    setExportingApplicationId(activeReview.application.id);
    setMessage(null);
    const operationScope = `applicationMaterialsExport:${activeReview.application.id}:applications-panel`;

    try {
      const response = await fetch(`/api/applications/${activeReview.application.id}/materials/export`, {
        body: JSON.stringify({
          acknowledgeClaimReview:
            activeReview.exportReadiness.requiresClaimReview && claimReviewAcknowledged,
        }),
        headers: {
          ...createIdempotencyHeaders(
            operationScope,
            getInFlightOperationId(paidOperationIdsRef, operationScope),
          ),
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to export files.");
        return;
      }

      setActiveReview(payload.review);
      setActiveReviewMode("preview");
      setClaimReviewAcknowledged(false);
      setResumeDraft(payload.review.resume?.content ?? null);
      setCoverLetterDraft(payload.review.coverLetter?.content ?? "");
      setMessage("PDF and DOCX files are prepared. You can download them from this packet.");
      router.refresh();
    } finally {
      clearInFlightOperationId(paidOperationIdsRef, operationScope);
      setExportingApplicationId(null);
    }
  }

  return (
    <section className="applications-panel" aria-label="Tracked applications">
      <TrustDialog />
      <div className="section-heading">
        <p className="eyebrow">Applications</p>
        <h2>Roles you’re pursuing</h2>
        <p>
          A compact record of every role you choose to pursue: stage, materials,
          and the next follow-up decision.
        </p>
      </div>

      {overview.recentApplications.length > 0 ? (
        <div className="record-search-sort-row application-primary-controls" aria-label="Application search and sort">
          <label className="record-search-field">
            <Search size={15} aria-hidden="true" />
            <input
              onChange={(event) => setApplicationQuery(event.target.value)}
              placeholder="Search role, company, stage"
              value={applicationQuery}
            />
          </label>
          <select
            aria-label="Sort applications"
            className="record-sort-select"
            onChange={(event) => setApplicationSort(event.target.value as ApplicationSort)}
            value={applicationSort}
          >
            <option value="recent">Recently updated</option>
            <option value="oldest">Oldest first</option>
            <option value="needs_action">Needs action first</option>
          </select>
        </div>
      ) : null}

      {overview.recentApplications.length > 0 ? (
        <div className="record-list-controls">
          <div className="record-view-toggle" aria-label="Application archive view">
            <button
              aria-pressed={effectiveArchiveView === "active"}
              className={`record-view-button ${effectiveArchiveView === "active" ? "active" : ""}`}
              onClick={() => {
                setArchiveView("active");
                if (activeStageFilter === "Archived") setActiveStageFilter("All");
              }}
              type="button"
            >
              Active <strong>{overview.summary.active}</strong>
            </button>
            <button
              aria-pressed={effectiveArchiveView === "archived"}
              className={`record-view-button ${effectiveArchiveView === "archived" ? "active" : ""}`}
              onClick={() => {
                setArchiveView("archived");
                setActiveStageFilter("Archived");
              }}
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
            {effectiveArchiveView === "archived"
              ? "No archived applications yet."
              : "No active applications right now. Archived applications are still available from the Archived view."}
          </p>
        ) : null}
        {applicationsInArchiveView.length > 0 && visibleApplications.length === 0 ? (
          <p className="empty-state">No applications in this stage yet.</p>
        ) : null}
        {visibleApplications.map((application) => (
          <div className="application-record-shell" key={application.id}>
            <article className="record-row application-record compact-application-row decision-card">
              <button
                className="record-main-button application-title-cell"
                onClick={() =>
                  setExpandedApplicationId(expandedApplicationId === application.id ? null : application.id)
                }
                title="Open application details"
                type="button"
              >
                <span className="record-title">{cleanDisplayText(application.jobTitle ?? "Application")}</span>
                <span className="record-meta">
                  {cleanDisplayText(application.companyName)} · Updated {formatShortDate(application.updatedAt)}
                </span>
                <span className="record-summary application-next-line">
                  {formatLatestActivity(application)} · Next: {readApplicationNextAction(application)}
                  {formatFollowUpBadge(application) ? ` · ${formatFollowUpBadge(application)}` : ""}
                  {isStaleApplication(application) ? " · Needs follow-up" : ""}
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
              {hasApplicationPacket(application) ? (
                <button
                  className="secondary-action compact-action compact-action-primary"
                  disabled={loadingReviewApplicationId === application.id}
                  onClick={() => loadReview(application.id)}
                  type="button"
                >
                  <Eye size={14} aria-hidden="true" />
                  {loadingReviewApplicationId === application.id ? "Opening" : "Preview packet"}
                </button>
              ) : (
                <button
                  className="secondary-action compact-action compact-action-primary"
                  disabled={generatingApplicationId === application.id || Boolean(application.archivedAt)}
                  onClick={() => generateMaterials(application.id)}
                  type="button"
                  title={
                    application.archivedAt
                      ? "Restore this application before generating materials"
                      : "Create a role-specific resume and cover letter for preview"
                  }
                >
                  <WandSparkles size={14} aria-hidden="true" />
                  {generatingApplicationId === application.id
                    ? "Creating"
                    : "Create packet"}
                </button>
              )}
            </div>
              {expandedApplicationId === application.id ? (
                <div className="record-detail-panel application-detail-actions">
                  <div className="application-detail-summary">
                    <strong>{readApplicationNextAction(application)}</strong>
                    <span>
                      {formatFollowUpBadge(application) ??
                        (application.followUpAt ? `Follow up ${formatShortDate(application.followUpAt)}` : "No follow-up date set")}
                    </span>
                  </div>
                  <div className="record-action-strip">
                    <a
                      className="secondary-action compact-action"
                      href={application.jobUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <ExternalLink size={14} aria-hidden="true" />
                      Job post
                    </a>
                    <button
                      className="secondary-action compact-action"
                      disabled={pendingApplicationId === application.id || Boolean(application.archivedAt)}
                      onClick={() => openPlanEditor(application)}
                      title={
                        application.archivedAt
                          ? "Restore this application before editing its follow-up plan"
                          : "Plan the next follow-up"
                      }
                      type="button"
                    >
                      <CalendarClock size={14} aria-hidden="true" />
                      Plan follow-up
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
                </div>
              ) : null}
            </article>
            {editingPlanApplicationId === application.id ? (
              <form
                className="application-plan-editor"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveApplicationPlan(application.id);
                }}
              >
                <label>
                  <span>Next action</span>
                  <input
                    maxLength={180}
                    onChange={(event) => setPlanDraft({ ...planDraft, nextAction: event.target.value })}
                    placeholder="Follow up with recruiter, prep interview notes..."
                    value={planDraft.nextAction}
                  />
                </label>
                <label>
                  <span>Follow-up date</span>
                  <input
                    onChange={(event) => setPlanDraft({ ...planDraft, followUpAt: event.target.value })}
                    type="date"
                    value={planDraft.followUpAt}
                  />
                </label>
                <label>
                  <span>Contact</span>
                  <input
                    maxLength={160}
                    onChange={(event) => setPlanDraft({ ...planDraft, contactName: event.target.value })}
                    placeholder="Recruiter or hiring manager"
                    value={planDraft.contactName}
                  />
                </label>
                <label>
                  <span>Contact channel</span>
                  <input
                    maxLength={160}
                    onChange={(event) => setPlanDraft({ ...planDraft, contactChannel: event.target.value })}
                    placeholder="Email, LinkedIn, referral..."
                    value={planDraft.contactChannel}
                  />
                </label>
                <label>
                  <span>Priority</span>
                  <select
                    onChange={(event) =>
                      setPlanDraft({
                        ...planDraft,
                        priority: event.target.value as ApplicationPlanDraft["priority"],
                      })
                    }
                    value={planDraft.priority}
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label className="application-plan-notes">
                  <span>Notes</span>
                  <textarea
                    maxLength={1200}
                    onChange={(event) => setPlanDraft({ ...planDraft, notes: event.target.value })}
                    placeholder="Interview details, compensation/location notes, recruiter context, or no-reply history."
                    rows={3}
                    value={planDraft.notes}
                  />
                </label>
                <div className="application-plan-actions">
                  <button
                    className="secondary-action compact-action"
                    onClick={() => setEditingPlanApplicationId(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="secondary-action compact-action compact-action-primary"
                    disabled={pendingApplicationId === application.id}
                    type="submit"
                  >
                    <Save size={14} aria-hidden="true" />
                    {pendingApplicationId === application.id ? "Saving..." : "Save plan"}
                  </button>
                </div>
              </form>
            ) : null}
          </div>
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
              <div className="packet-mode-toggle" aria-label="Packet view mode">
                <button
                  aria-pressed={activeReviewMode === "preview"}
                  className={activeReviewMode === "preview" ? "active" : ""}
                  onClick={() => setActiveReviewMode("preview")}
                  type="button"
                >
                  <Eye size={14} aria-hidden="true" />
                  Preview
                </button>
                <button
                  aria-pressed={activeReviewMode === "edit"}
                  className={activeReviewMode === "edit" ? "active" : ""}
                  onClick={() => setActiveReviewMode("edit")}
                  type="button"
                >
                  <Pencil size={14} aria-hidden="true" />
                  Edit
                </button>
              </div>
              <button
                className="secondary-action"
                disabled={
                  activeReviewMode !== "edit" ||
                  !resumeDraft ||
                  savingApplicationId === activeReview.application.id
                }
                onClick={saveReview}
                type="button"
              >
                <Save size={15} aria-hidden="true" />
                {savingApplicationId === activeReview.application.id ? "Saving..." : "Save"}
              </button>
              <button
                className="secondary-action"
                disabled={
                  (!activeReview.exportReadiness.canExport &&
                    !activeReview.exportReadiness.requiresClaimReview) ||
                  !activeReviewClaimAckSatisfied ||
                  activeReview.exportReadiness.status === "exported" ||
                  activeReview.exportReadiness.status === "export_pending" ||
                  exportingApplicationId === activeReview.application.id
                }
                onClick={exportFiles}
                title={
                  activeReview.exportReadiness.status === "exported"
                    ? "Files are already prepared. Use the links below."
                    : activeReview.exportReadiness.canExport
                      ? "Prepare resume and cover-letter PDF/DOCX files after previewing and acknowledging high-impact review items. This costs 1 credit."
                    : "Create both resume and cover-letter drafts before downloading"
                }
                type="button"
              >
                <Download size={15} aria-hidden="true" />
                {exportingApplicationId === activeReview.application.id
                  ? "Preparing..."
                  : activeReview.exportReadiness.status === "exported"
                    ? "Files prepared"
                    : activeReview.exportReadiness.status === "export_pending"
                      ? "Preparing..."
                    : "Prepare downloads"}
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
              <p>
                {activeReview.exportReadiness.status === "exported"
                  ? "Files are prepared. Opening these links does not prepare a new export."
                  : "Previewing and editing this packet costs 0 credits. Preparing PDF/DOCX downloads costs 1 credit."}
              </p>
            )}
          </div>

          {activeReview.exportReadiness.requiresClaimReview ? (
            <div className="material-readiness claim-review-required">
              <strong>
                <AlertTriangle size={15} aria-hidden="true" />
                Review resume and cover-letter facts before export
              </strong>
              <ul>
                {activeReview.exportReadiness.blockingRisks.map((risk) => (
                  <li key={`${risk.category}-${risk.text}`}>
                    <AlertTriangle size={14} aria-hidden="true" />
                    {risk.text}
                  </li>
                ))}
              </ul>
              <label className="inline-checkbox">
                <input
                  checked={claimReviewAcknowledged}
                  onChange={(event) => setClaimReviewAcknowledged(event.target.checked)}
                  type="checkbox"
                />
                I reviewed these items and want to prepare the final PDF/DOCX files.
              </label>
            </div>
          ) : null}

          {!resumeDraft || !activeReview.coverLetter ? (
            <p className="empty-state">Create the packet first, then this review area becomes editable.</p>
          ) : activeReviewMode === "preview" ? (
            <PacketPreview
              application={activeReview.application}
              coverLetter={coverLetterDraft}
              coverLetterNotes={activeReview.coverLetter.reviewerNotes}
              resume={resumeDraft}
            />
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

function readApplicationNextAction(
  application: ApplicationOverview["recentApplications"][number],
) {
  if (application.nextAction) {
    return application.nextAction;
  }

  if (application.archivedAt) {
    return "Restore if this role becomes active again";
  }

  if (!hasApplicationPacket(application)) {
    return "Create tailored materials";
  }

  if (!application.latestResumeHasPdf || !application.latestCoverLetterHasPdf) {
    return "Export files";
  }

  if (application.status === "draft") {
    return "Apply or update stage";
  }

  if (application.status === "applied" || application.status === "no_reply") {
    return "Plan follow-up";
  }

  if (application.status === "interview_in_progress") {
    return "Track interview loop";
  }

  return "Keep status current";
}

function formatDateInputValue(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function formatFollowUpBadge(
  application: ApplicationOverview["recentApplications"][number],
) {
  if (!application.followUpAt) {
    return null;
  }

  const date = new Date(application.followUpAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const prefix = date.getTime() <= Date.now() ? "Due" : "Follow up";
  return `${prefix} ${formatShortDate(application.followUpAt)}`;
}

function applicationMatchesSearch(
  application: ApplicationOverview["recentApplications"][number],
  query: string,
) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  return [
    application.companyName,
    application.jobTitle,
    application.status,
    application.latestResumeHeadline,
  ]
    .filter(Boolean)
    .some((value) => value?.toLowerCase().includes(normalizedQuery));
}

function sortApplications(
  applications: ApplicationOverview["recentApplications"],
  sort: ApplicationSort,
) {
  return [...applications].sort((left, right) => {
    if (sort === "needs_action") {
      return Number(isNeedsActionApplication(right)) - Number(isNeedsActionApplication(left));
    }

    const leftTime = new Date(left.updatedAt).getTime();
    const rightTime = new Date(right.updatedAt).getTime();

    return sort === "oldest" ? leftTime - rightTime : rightTime - leftTime;
  });
}

function isNeedsActionApplication(
  application: ApplicationOverview["recentApplications"][number],
) {
  return !hasApplicationPacket(application) || isStaleApplication(application);
}

function isStaleApplication(
  application: ApplicationOverview["recentApplications"][number],
) {
  if (!["applied", "no_reply", "interview_in_progress"].includes(application.status)) {
    return false;
  }

  if (application.followUpAt) {
    const followUpTime = new Date(application.followUpAt).getTime();
    return !Number.isNaN(followUpTime) && followUpTime <= Date.now();
  }

  const updatedAt = new Date(application.updatedAt).getTime();
  const daysSinceUpdate = (Date.now() - updatedAt) / (24 * 60 * 60 * 1000);

  return daysSinceUpdate >= 14;
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

function hasApplicationPacket(application: ApplicationOverview["recentApplications"][number]) {
  return Boolean(application.latestResumeStatus || application.latestCoverLetterStatus);
}

function formatExportStatus(status: MaterialReview["exportReadiness"]["status"]) {
  const labels: Record<MaterialReview["exportReadiness"]["status"], string> = {
    export_failed: "Export needs review",
    export_pending: "Export in progress",
    exported: "Files exported",
    missing_materials: "Packet incomplete",
    ready_to_export: "Preview ready",
  };

  return labels[status];
}

function PacketPreview({
  application,
  coverLetter,
  coverLetterNotes,
  resume,
}: {
  application: MaterialReview["application"];
  coverLetter: string;
  coverLetterNotes: string[];
  resume: ResumeContent;
}) {
  const experienceSections = resume.experienceSections;
  const coverLetterParagraphs = coverLetter
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <div className="packet-preview-grid">
      <article className="packet-preview-document" aria-label="Resume preview">
        <div className="packet-preview-kicker">Resume preview</div>
        <header className="packet-preview-resume-header">
          <h3>{application.displayName ?? resume.headline}</h3>
          {application.displayName ? <p>{resume.headline}</p> : null}
          {formatResumeContactLine(resume) ? (
            <small>{formatResumeContactLine(resume)}</small>
          ) : null}
        </header>
        <p>{resume.summary}</p>
        {resume.skills.length > 0 ? (
          <div className="packet-preview-skills" aria-label="Resume skills">
            {resume.skills.map((skill) => (
              <span key={skill}>{skill}</span>
            ))}
          </div>
        ) : null}
        {resume.experienceBullets.length > 0 ? (
          <div className="packet-preview-section">
            <h4>Selected highlights</h4>
            <ul>
              {resume.experienceBullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {experienceSections.length > 0 ? (
          <div className="packet-preview-section">
            <h4>Professional experience</h4>
            {experienceSections.map((section) => (
              <section key={`${section.roleTitle}-${section.company ?? ""}-${section.dates ?? ""}`}>
                <div>
                  <strong>{section.roleTitle}</strong>
                  {[section.company, section.location, section.dates].filter(Boolean).length > 0 ? (
                    <small>{[section.company, section.location, section.dates].filter(Boolean).join(" · ")}</small>
                  ) : null}
                </div>
                <ul>
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : null}
        {resume.specialProjects.length > 0 ? (
          <div className="packet-preview-section">
            <h4>Special projects</h4>
            {resume.specialProjects.map((project) => (
              <section key={`${project.name}-${project.context ?? ""}-${project.dates ?? ""}`}>
                <div>
                  <strong>{project.name}</strong>
                  {[project.context, project.dates].filter(Boolean).length > 0 ? (
                    <small>{[project.context, project.dates].filter(Boolean).join(" · ")}</small>
                  ) : null}
                </div>
                <ul>
                  {project.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : null}
        {resume.languages.length > 0 ? (
          <div className="packet-preview-section">
            <h4>Languages</h4>
            <ul>
              {resume.languages.map((language) => (
                <li key={`${language.name}-${language.proficiency ?? ""}`}>
                  {[language.name, language.proficiency].filter(Boolean).join(" · ")}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {resume.education.length > 0 ? (
          <div className="packet-preview-section">
            <h4>Education</h4>
            <ul>
              {resume.education.map((item) => (
                <li key={`${item.institution}-${item.credential ?? ""}`}>
                  {[item.credential, item.institution, item.location, item.dates].filter(Boolean).join(" · ")}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {resume.certifications.length > 0 ? (
          <div className="packet-preview-section">
            <h4>Certifications</h4>
            <ul>
              {resume.certifications.map((item) => (
                <li key={`${item.name}-${item.issuer ?? ""}`}>
                  {[item.name, item.issuer, item.date].filter(Boolean).join(" · ")}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {resume.keywordGaps.length > 0 || resume.reviewerNotes.length > 0 ? (
          <div className="packet-preview-section packet-preview-review">
            <h4>Review before export</h4>
            <ul>
              {[...resume.keywordGaps, ...resume.reviewerNotes].map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </article>
      <article className="packet-preview-document" aria-label="Cover letter preview">
        <div className="packet-preview-kicker">Cover letter preview</div>
        <h3>
          {application.companyName}
          {application.jobTitle ? ` · ${application.jobTitle}` : ""}
        </h3>
        <div className="packet-preview-letter">
          {coverLetterParagraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        {coverLetterNotes.length > 0 ? (
          <div className="packet-preview-section packet-preview-review">
            <h4>Cover letter review</h4>
            <ul>
              {coverLetterNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </article>
    </div>
  );
}

function formatResumeContactLine(resume: ResumeContent) {
  return [
    resume.contact.email,
    resume.contact.phone,
    resume.contact.linkedin,
    resume.contact.website,
    resume.contact.location,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function buildStageFilterCounts(applications: ApplicationOverview["recentApplications"]) {
  const byStage = (["Review", "Draft", "Applied", "Interview", "Selected", "Closed", "Archived"] as const).map(
    (stage) => ({
      label: stage,
      value: applications.filter((application) => applicationMatchesStage(application, stage)).length,
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

function applicationMatchesStage(
  application: ApplicationOverview["recentApplications"][number],
  stage: StageFilter,
) {
  if (stage === "All") {
    return true;
  }

  if (stage === "Archived") {
    return Boolean(application.archivedAt);
  }

  if (stage === "Review") {
    return !application.archivedAt && isNeedsActionApplication(application);
  }

  const stageStatuses: Record<Exclude<StageFilter, "All" | "Archived" | "Review">, Set<string>> = {
    Applied: new Set(["applied", "no_reply"]),
    Closed: new Set(["rejected", "interviewed_not_selected", "withdrawn"]),
    Draft: new Set(["draft"]),
    Interview: new Set([
      "interview_in_progress",
      "interviewed_not_selected",
      "interviewed_selected",
    ]),
    Selected: new Set(["interviewed_selected"]),
  };

  return stageStatuses[stage].has(application.status);
}
