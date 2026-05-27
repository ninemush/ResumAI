"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import {
  Camera,
  CheckCircle2,
  Circle,
  Compass,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { brand } from "@/lib/brand";
import type { ApplicationOverview } from "@/lib/applications/application-overview";
import type { JobOverview } from "@/lib/jobs/job-overview";
import type { ProfileOverview } from "@/lib/profile/profile-overview";
import { createClient } from "@/lib/supabase/browser";

type ProfileExplorerProps = {
  applicationOverview: ApplicationOverview;
  jobOverview: JobOverview;
  overview: ProfileOverview;
};

type ProfileDraft = {
  displayName: string;
  headline: string;
  photoStoragePath: string;
  summary: string;
  targetDirection: string;
  targetLevel: string;
};

const PROFILE_PHOTO_BUCKET = "profile-photos";
const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024;
const acceptedProfilePhotoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function ProfileExplorer({ applicationOverview, jobOverview, overview }: ProfileExplorerProps) {
  const router = useRouter();
  const profileName = overview.profile?.displayName ?? "Career profile";
  const headline =
    overview.profile?.headline ??
    "Add a resume, LinkedIn profile, portfolio, or a few notes to shape your direction.";
  const hasFacts = overview.factCount > 0;
  const profileGaps = readProfileGaps(overview);
  const pendingProfileApprovals = countPendingProfileApprovals(overview);
  const pendingReviewCount =
    pendingProfileApprovals +
    applicationOverview.summary.needsReview +
    jobOverview.summary.readyForReview;
  const nextMove = readNextMove({
    applicationOverview,
    jobOverview,
    overview,
    profileGaps,
  });
  const [draft, setDraft] = useState<ProfileDraft>({
    displayName: overview.profile?.displayName ?? "",
    headline: overview.profile?.headline ?? "",
    photoStoragePath: overview.profile?.photoStoragePath ?? "",
    summary: overview.profile?.summary ?? "",
    targetDirection: overview.profile?.targetDirection ?? "",
    targetLevel: overview.profile?.targetLevel ?? "",
  });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [factDrafts, setFactDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.values(overview.factsByType)
        .flat()
        .map((fact) => [fact.id, fact.fact_value]),
    ),
  );

  async function saveDraft() {
    setPendingId("profile");
    setMessage(null);

    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: draft.displayName,
          headline: draft.headline,
          photoStoragePath: draft.photoStoragePath,
          summary: draft.summary,
          targetDirection: draft.targetDirection,
          targetLevel: draft.targetLevel,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to save profile updates.");
        return;
      }

      setMessage("Saved your profile direction.");
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function uploadProfilePhoto(file: File | null) {
    if (!file) {
      return;
    }

    setPendingId("photo");
    setMessage(null);

    try {
      if (!acceptedProfilePhotoTypes.has(file.type)) {
        setMessage("Use a JPG, PNG, or WebP image for your profile photo.");
        return;
      }

      if (file.size > MAX_PROFILE_PHOTO_BYTES) {
        setMessage("Profile photos must be under 5 MB.");
        return;
      }

      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setMessage("Please sign in before adding a profile photo.");
        return;
      }

      const extension = readImageExtension(file.type);
      const storagePath = `${user.id}/profile-photo.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from(PROFILE_PHOTO_BUCKET)
        .upload(storagePath, file, {
          contentType: file.type,
          upsert: true,
        });

      if (uploadError) {
        setMessage(`I could not upload that photo: ${uploadError.message}`);
        return;
      }

      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoStoragePath: storagePath }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to save the profile photo.");
        return;
      }

      setDraft((currentDraft) => ({ ...currentDraft, photoStoragePath: storagePath }));
      setMessage("Profile photo saved. ATS-first resumes will still exclude it unless you choose a photo-compatible format.");
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function confirmFact(factId: string) {
    setPendingId(factId);
    setMessage(null);

    try {
      const response = await fetch(`/api/profile/facts/${factId}/confirm`, {
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to confirm that detail.");
        return;
      }

      setMessage("Confirmed. I will treat that as trusted profile evidence.");
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function updateFact(factId: string) {
    const value = factDrafts[factId]?.trim();

    if (!value) {
      setMessage("Add a profile detail before saving it.");
      return;
    }

    setPendingId(factId);
    setMessage(null);

    try {
      const response = await fetch(`/api/profile/facts/${factId}/confirm`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to save that detail.");
        return;
      }

      setMessage("Saved and confirmed that profile detail.");
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function dismissFact(factId: string) {
    setPendingId(factId);
    setMessage(null);

    try {
      const response = await fetch(`/api/profile/facts/${factId}/confirm`, {
        method: "DELETE",
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to remove that detail.");
        return;
      }

      setMessage("Removed that profile detail from trusted review.");
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function retrySourceExtraction(sourceId: string) {
    setPendingId(sourceId);
    setMessage(null);

    try {
      const response = await fetch(`/api/profile/sources/${sourceId}/extract`, {
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to retry that source.");
        return;
      }

      const savedFactCount = payload.intake?.savedFactCount ?? 0;
      setMessage(
        savedFactCount > 0
          ? `Source read. Saved ${savedFactCount} profile detail${savedFactCount === 1 ? "" : "s"} for review.`
          : "Source read. I did not find new profile details this time.",
      );
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function acknowledgeRecommendation(recommendationId: string) {
    setPendingId(recommendationId);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/profile/role-recommendations/${recommendationId}/acknowledge`,
        { method: "POST" },
      );
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to acknowledge that direction.");
        return;
      }

      setMessage("Direction acknowledged. I will use this as the working target.");
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  return (
    <main className="profile-pane" aria-labelledby="profile-title">
      <div className="profile-heading">
        <div className="pane-heading">
          <p className="eyebrow">Profile cockpit</p>
          <h1 id="profile-title">{profileName}</h1>
          <p>{headline}</p>
        </div>
        <div className="profile-heading-photo">
          <div className="profile-photo-preview large" aria-hidden="true">
            {overview.profile?.photoUrl ? (
              <Image
                alt=""
                height={88}
                src={overview.profile.photoUrl}
                unoptimized
                width={88}
              />
            ) : (
              <Camera size={30} />
            )}
          </div>
          <label
            className="profile-photo-icon-action"
            title={draft.photoStoragePath ? "Replace profile photo" : "Add profile photo"}
          >
            <Camera size={15} aria-hidden="true" />
            <span className="sr-only">
              {draft.photoStoragePath ? "Replace profile photo" : "Add profile photo"}
            </span>
            <input
              accept="image/jpeg,image/png,image/webp"
              disabled={pendingId === "photo"}
              onChange={(event) => uploadProfilePhoto(event.target.files?.[0] ?? null)}
              type="file"
            />
          </label>
        </div>
      </div>

      <section className="readiness-panel" aria-label="Profile readiness">
        <div>
          <span className="readiness-score">{overview.readinessScore}%</span>
          <p>Profile readiness</p>
        </div>
        <p>
          {hasFacts
            ? `${overview.factCount} profile details captured from ${overview.sourceCount} source${overview.sourceCount === 1 ? "" : "s"}. ${overview.confirmedFactCount} detail${overview.confirmedFactCount === 1 ? "" : "s"} confirmed.`
            : "Share a resume, LinkedIn or portfolio link, or a quick work-history note in the AI agent. Confirmed evidence will appear here as the profile takes shape."}
        </p>
      </section>

      <section className="profile-build-panel" aria-label="Profile build progress">
        <div className="section-heading">
          <p className="eyebrow">Profile build</p>
          <h2>What is ready, and what needs signal</h2>
        </div>
        <div className="profile-milestone-list">
          {overview.milestones.map((milestone) => (
            <article
              className={milestone.complete ? "complete" : undefined}
              key={milestone.key}
              title={milestone.detail}
            >
              {milestone.complete ? (
                <CheckCircle2 size={16} aria-hidden="true" />
              ) : (
                <Circle size={16} aria-hidden="true" />
              )}
              <div>
                <strong>{milestone.label}</strong>
                <span>{milestone.detail}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="next-action-panel" aria-label="Recommended next step">
        <div>
          <p className="eyebrow">Next best move</p>
          <h2>{nextMove.title}</h2>
          <p>{nextMove.body}</p>
        </div>
        <div className="next-action-support">
          {profileGaps.length > 0 ? (
            <>
              <span>Missing high-value signal</span>
              <div className="profile-gap-list">
                {profileGaps.map((gap) => (
                  <strong key={gap}>{gap}</strong>
                ))}
              </div>
            </>
          ) : (
            <>
              <span>Profile signal</span>
              <strong>Enough to start tailoring</strong>
            </>
          )}
        </div>
      </section>

      <section className="cockpit-panel" aria-label="Career cockpit">
        <CockpitMetric
          detail="Confirmed profile evidence improves recommendations and generated materials."
          label="Readiness"
          value={`${overview.readinessScore}%`}
        />
        <CockpitMetric
          detail={`${applicationOverview.summary.needsReview} application${applicationOverview.summary.needsReview === 1 ? "" : "s"} still need a decision or next action.`}
          label="Applications"
          value={applicationOverview.summary.total}
        />
        <CockpitMetric
          detail="Use this to keep follow-up conversations precise."
          label="Interviewing"
          value={applicationOverview.summary.interviewing}
        />
        <CockpitMetric
          detail={`${jobOverview.summary.readyForReview} readable job post${jobOverview.summary.readyForReview === 1 ? "" : "s"} ready for fit review.`}
          label="Jobs to review"
          value={jobOverview.summary.identified}
        />
        <CockpitMetric
          detail={`${pendingReviewCount} item${pendingReviewCount === 1 ? "" : "s"} need your confirmation, review, or approval before ${brand.name} treats them as trusted.`}
          label="Needs review"
          value={pendingReviewCount}
        />
        <div className="stage-progress-card">
          <div>
            <span>Application stages</span>
            <strong>
              {applicationOverview.summary.total === 0
                ? "No applications yet"
                : `${applicationOverview.summary.selected} selected`}
            </strong>
          </div>
          <div className="stage-progress" aria-label="Application status distribution">
            {applicationOverview.summary.byStage.map((stage) => (
              <span
                key={stage.label}
                title={`${stage.label}: ${stage.value}`}
              >
                <i
                  style={
                    {
                      "--stage-width": `${readStageWidth(
                        stage.value,
                        applicationOverview.summary.total,
                      )}%`,
                    } as CSSProperties & Record<"--stage-width", string>
                  }
                />
                <em>{stage.value}</em>
                {stage.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {message ? <p className="system-note success">{message}</p> : null}

      <section className="profile-editor-panel" aria-label="Profile direction editor">
        <div className="section-heading">
          <p className="eyebrow">Working profile</p>
          <h2>Your career signal</h2>
        </div>
        <div className="profile-editor-grid">
          <label>
            Name
            <input
              onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
              placeholder="Your name"
              value={draft.displayName}
            />
          </label>
          <label>
            Headline
            <input
              onChange={(event) => setDraft({ ...draft, headline: event.target.value })}
              placeholder="e.g. Product leader | Fintech platforms | GTM strategy"
              value={draft.headline}
            />
          </label>
          <label>
            Target direction
            <input
              onChange={(event) => setDraft({ ...draft, targetDirection: event.target.value })}
              placeholder="Role family, domain, or path"
              value={draft.targetDirection}
            />
          </label>
          <label>
            Target level
            <input
              onChange={(event) => setDraft({ ...draft, targetLevel: event.target.value })}
              placeholder="e.g. Senior Manager, Director, VP"
              value={draft.targetLevel}
            />
          </label>
          <label className="profile-summary-editor">
            Summary
            <textarea
              onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
              placeholder="A concise read on your experience, strengths, and direction."
              rows={5}
              value={draft.summary}
            />
          </label>
        </div>
        <button
          className="secondary-action profile-save-action"
          disabled={pendingId === "profile"}
          onClick={saveDraft}
          type="button"
        >
          <Save size={15} aria-hidden="true" />
          {pendingId === "profile" ? "Saving..." : "Save profile"}
        </button>
      </section>

      <section className="profile-summary-grid" aria-label="Profile summary">
        <div>
          <span>Tier</span>
          <strong>{overview.tierName ?? "No active tier"}</strong>
        </div>
        <div>
          <span>Status</span>
          <strong>{formatProfileStatus(overview.profile?.status)}</strong>
        </div>
        <div>
          <span>Target</span>
          <strong>{overview.profile?.targetDirection ?? "Still calibrating"}</strong>
        </div>
      </section>

      {overview.profile?.summary ||
      overview.profile?.targetDirection ||
      overview.profile?.targetLevel ? (
        <section className="profile-draft-panel" aria-label="Profile draft">
          <div className="section-heading">
            <p className="eyebrow">Current read</p>
            <h2>How I would position you</h2>
          </div>
          {overview.profile?.summary ? <p>{overview.profile.summary}</p> : null}
          <div className="draft-chips" aria-label="Draft direction">
            {overview.profile?.targetDirection ? (
              <span>
                <Compass size={15} aria-hidden="true" />
                {overview.profile.targetDirection}
              </span>
            ) : null}
            {overview.profile?.targetLevel ? (
              <span>
                <Sparkles size={15} aria-hidden="true" />
                {overview.profile.targetLevel}
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      {overview.roleRecommendations.length > 0 ? (
        <section className="roles-panel" aria-label="Role recommendations">
          <div className="section-heading">
            <p className="eyebrow">Role paths</p>
            <h2>Directions worth considering</h2>
          </div>
          <div className="role-list">
            {overview.roleRecommendations.map((recommendation) => (
              <article className="role-card" key={recommendation.id}>
                <div className="role-card-header">
                  <div>
                    <h3>{recommendation.role_family}</h3>
                    {recommendation.seniority_level ? (
                      <p>{recommendation.seniority_level}</p>
                    ) : null}
                  </div>
                  {recommendation.confidence !== null ? (
                    <span>{Math.round(recommendation.confidence * 100)}%</span>
                  ) : null}
                </div>
                {recommendation.role_titles.length > 0 ? (
                  <div className="keyword-row">
                    {recommendation.role_titles.map((title) => (
                      <span key={title}>{title}</span>
                    ))}
                  </div>
                ) : null}
                <p>{recommendation.rationale}</p>
                {recommendation.open_questions.length > 0 ? (
                  <ul>
                    {recommendation.open_questions.map((question) => (
                      <li key={question}>{question}</li>
                    ))}
                  </ul>
                ) : null}
                <button
                  className="secondary-action"
                  disabled={pendingId === recommendation.id || recommendation.user_acknowledged}
                  onClick={() => acknowledgeRecommendation(recommendation.id)}
                  type="button"
                >
                  {recommendation.user_acknowledged ? (
                    <CheckCircle2 size={15} aria-hidden="true" />
                  ) : null}
                  {recommendation.user_acknowledged
                    ? "Acknowledged"
                    : pendingId === recommendation.id
                      ? "Saving..."
                      : "Use as direction"}
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {overview.recentSources.length > 0 ? (
        <section className="sources-panel" aria-label="Recent profile sources">
          <div className="section-heading">
            <p className="eyebrow">Recent sources</p>
            <h2>What you have added</h2>
          </div>
          <div className="source-list">
            {overview.recentSources.map((source) => (
              <article className="source-row" key={source.id}>
                <div>
                  <h3>{source.original_filename ?? formatSourceUrl(source.source_url)}</h3>
                  <p>{formatSourceType(source.source_type)}</p>
                  {source.failure_reason ? (
                    <p className="source-failure">{formatFailureReason(source.failure_reason)}</p>
                  ) : null}
                  <p>{formatSourceGuidance(source)}</p>
                </div>
                <div className="source-actions">
                  <span className={`source-pill ${source.extraction_status}`}>
                    {source.extraction_status.replace("_", " ")}
                  </span>
                  {["failed", "pending"].includes(source.extraction_status) ? (
                    <button
                      className="secondary-action compact-action"
                      disabled={pendingId === source.id}
                      onClick={() => retrySourceExtraction(source.id)}
                      title="Retry source extraction"
                      type="button"
                    >
                      <RefreshCw size={14} aria-hidden="true" />
                      {pendingId === source.id ? "Retrying..." : "Retry"}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="facts-panel" aria-label="Captured profile facts">
        <div className="section-heading">
          <p className="eyebrow">Captured details</p>
          <h2>What {brand.name} knows so far</h2>
        </div>
        {hasFacts ? (
          <div className="fact-groups">
            {Object.entries(overview.factsByType).map(([type, facts]) => (
              <article className="fact-group" key={type}>
                <h3>{type}</h3>
                <ul>
                  {facts.map((fact) => (
                    <li key={fact.id}>
                      <textarea
                        aria-label={`Edit ${type} detail`}
                        disabled={pendingId === fact.id}
                        onChange={(event) =>
                          setFactDrafts((currentDrafts) => ({
                            ...currentDrafts,
                            [fact.id]: event.target.value,
                          }))
                        }
                        rows={3}
                        value={factDrafts[fact.id] ?? fact.fact_value}
                      />
                      <div className="fact-review-actions">
                        {fact.user_confirmed ? (
                          <span className="fact-confirmed-label">
                            <CheckCircle2 size={15} aria-hidden="true" />
                            Confirmed
                          </span>
                        ) : (
                          <button
                            className="fact-confirm-button"
                            disabled={pendingId === fact.id}
                            onClick={() => confirmFact(fact.id)}
                            type="button"
                          >
                            {pendingId === fact.id ? "Saving..." : "Confirm"}
                          </button>
                        )}
                        <button
                          className="fact-confirm-button"
                          disabled={
                            pendingId === fact.id ||
                            (factDrafts[fact.id] ?? fact.fact_value).trim() === fact.fact_value
                          }
                          onClick={() => updateFact(fact.id)}
                          type="button"
                        >
                          Save edit
                        </button>
                        <button
                          className="fact-delete-button"
                          disabled={pendingId === fact.id}
                          onClick={() => dismissFact(fact.id)}
                          title="Remove this captured detail"
                          type="button"
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">
            Confirmed profile evidence will appear here after you share a source or note.
          </p>
        )}
      </section>
    </main>
  );
}

function readStageWidth(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.max(8, Math.round((value / total) * 100));
}

function readProfileGaps(overview: ProfileOverview) {
  const gaps: string[] = [];

  if (!overview.profile?.summary) {
    gaps.push("Sharp profile summary");
  }

  if (!overview.profile?.targetDirection) {
    gaps.push("Target role direction");
  }

  if (!overview.profile?.targetLevel) {
    gaps.push("Target level");
  }

  if (overview.confirmedFactCount === 0) {
    gaps.push("Confirmed proof points");
  }

  if (overview.sourceCount === 0) {
    gaps.push("Resume or profile source");
  }

  return gaps.slice(0, 4);
}

function countPendingProfileApprovals(overview: ProfileOverview) {
  const unconfirmedFacts = Object.values(overview.factsByType)
    .flat()
    .filter((fact) => !fact.user_confirmed).length;
  const unacknowledgedRecommendations = overview.roleRecommendations.filter(
    (recommendation) => !recommendation.user_acknowledged,
  ).length;

  return unconfirmedFacts + unacknowledgedRecommendations;
}

function readNextMove({
  applicationOverview,
  jobOverview,
  overview,
  profileGaps,
}: {
  applicationOverview: ApplicationOverview;
  jobOverview: JobOverview;
  overview: ProfileOverview;
  profileGaps: string[];
}) {
  if (overview.factCount === 0) {
    return {
      title: "Start with the raw material",
      body: `Drop a resume, paste LinkedIn or a portfolio, or tell ${brand.name} what you have done. One useful source is enough to begin building your profile.`,
    };
  }

  if (countPendingProfileApprovals(overview) > 0) {
    return {
      title: "Confirm what is true",
      body: `Review the captured details below and confirm the ones ${brand.name} should trust. This keeps recommendations and generated resumes grounded.`,
    };
  }

  if (profileGaps.length > 0) {
    return {
      title: "Fill the gaps hiring teams notice",
      body: `The profile is taking shape. Next, add ${formatList(profileGaps.map((gap) => gap.toLowerCase()))} so ${brand.name} can position you with more confidence.`,
    };
  }

  if (jobOverview.summary.readyForReview > 0) {
    return {
      title: "Review the role fit",
      body: "You have a readable job post ready. Review fit, gaps, and tradeoffs before generating materials.",
    };
  }

  if (applicationOverview.summary.needsReview > 0) {
    return {
      title: "Finish the application record",
      body: "You have an application waiting for a next action. Generate materials, update status, or decide whether to proceed.",
    };
  }

  return {
    title: "Ready for a job link",
    body: `Paste a role you are considering into ${brand.name}. It will compare the posting against your profile and help decide whether it is worth pursuing.`,
  };
}

function CockpitMetric({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: number | string;
}) {
  return (
    <article className="cockpit-metric" title={detail}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function formatList(items: string[]) {
  if (items.length <= 1) {
    return items[0] ?? "";
  }

  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function formatProfileStatus(status: string | undefined) {
  const statusLabels: Record<string, string> = {
    draft: "Taking shape",
    profile_ready: "Ready to tailor",
    needs_review: "Needs your review",
  };

  if (!status) {
    return "Taking shape";
  }

  return statusLabels[status] ?? status.replaceAll("_", " ");
}

function formatSourceType(sourceType: string) {
  if (sourceType === "docx") return "Word document";
  if (sourceType === "pdf") return "PDF";
  if (sourceType === "txt") return "Text file";
  if (sourceType === "linkedin") return "LinkedIn profile";
  if (sourceType === "portfolio") return "Portfolio link";

  return sourceType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatSourceUrl(sourceUrl: string | null) {
  if (!sourceUrl) return "Profile source";

  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return "Profile link";
  }
}

function formatFailureReason(reason: string) {
  const friendlyMessages: Record<string, string> = {
    DOCX_TEXT_EMPTY: "No readable text found.",
    PDF_TEXT_EMPTY: "No selectable text found. OCR will be needed.",
    PDF_PAGE_LIMIT_EXCEEDED: "Too many pages for the current parser limit.",
    PDF_FILE_TOO_LARGE: "PDF exceeds the current parser size limit.",
    TEXT_FILE_TOO_LARGE: "Text file exceeds the current parser size limit.",
    IMAGE_OCR_FILE_TOO_LARGE: "Image exceeds the current OCR size limit.",
    IMAGE_OCR_TEXT_EMPTY: "No readable text found in the image.",
    IMAGE_OCR_UNSUPPORTED_MIME_TYPE: "OCR supports JPG, PNG, and WebP images.",
  };

  return friendlyMessages[reason] ?? "Extraction needs another attempt.";
}

function formatSourceGuidance(source: ProfileOverview["recentSources"][number]) {
  if (source.extraction_status === "succeeded") {
    return "Read into your profile evidence.";
  }

  if (source.extraction_status === "processing") {
    return "Currently being read. This can take a moment for larger files.";
  }

  if (source.extraction_status === "pending") {
    return "Saved, but not read yet. Retry when you are ready.";
  }

  if (source.source_type === "linkedin" && source.extraction_status === "failed") {
    return "LinkedIn may block public reads. Retry, paste profile text, or upload a PDF/screenshot export.";
  }

  if (source.extraction_status === "failed") {
    return "Saved, but extraction failed. Retry or provide the content another way.";
  }

  return "Saved as profile source.";
}

function readImageExtension(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}
