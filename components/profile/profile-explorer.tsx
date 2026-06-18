"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import {
  Camera,
  CheckCircle2,
  ClipboardPaste,
  Compass,
  FileUp,
  Link2,
  Pencil,
  Send,
  Save,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { useTrustDialog } from "@/components/ui/trust-dialog";
import { brand } from "@/lib/brand";
import type { WorkspaceNavigationTarget } from "@/components/app-shell/workspace-layout";
import type { ApplicationOverview } from "@/lib/applications/application-overview";
import type { ArtifactOverview } from "@/lib/artifacts/artifact-overview";
import type { JobOverview } from "@/lib/jobs/job-overview";
import type { MasterResumeOverview } from "@/lib/resumes/master-resume";
import type { ProfileOverview } from "@/lib/profile/profile-overview";
import { createClient } from "@/lib/supabase/browser";

type ProfileExplorerProps = {
  applicationOverview: ApplicationOverview;
  artifactOverview: ArtifactOverview;
  jobOverview: JobOverview;
  masterResumeOverview: MasterResumeOverview;
  onNavigate: (target: WorkspaceNavigationTarget) => void;
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

type HomeNextMove = {
  actionLabel: string;
  body: string;
  prompt?: string;
  target: WorkspaceNavigationTarget;
  title: string;
};

const PROFILE_PHOTO_BUCKET = "profile-photos";
const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024;
const acceptedProfilePhotoTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function ProfileExplorer({
  applicationOverview,
  artifactOverview,
  jobOverview,
  masterResumeOverview,
  onNavigate,
  overview,
}: ProfileExplorerProps) {
  const router = useRouter();
  const profileName = overview.profile?.displayName ?? "Career profile";
  const headline =
    overview.profile?.headline ??
    "Add a resume, LinkedIn profile, portfolio, or a few notes to shape your direction.";
  const profileGaps = readProfileGaps(overview);
  const nextMove = readNextMove({
    applicationOverview,
    jobOverview,
    masterResumeOverview,
    overview,
    profileGaps,
  });
  const returnBrief = readReturnBrief({
    applicationOverview,
    artifactOverview,
    jobOverview,
    masterResumeOverview,
    overview,
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
  const { prompt, TrustDialog } = useTrustDialog();
  const activeDirection =
    overview.profile?.targetDirection?.trim().toLowerCase() ?? "";

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
        setMessage(
          payload.error?.message ?? "Unable to save the profile photo.",
        );
        return;
      }

      setDraft((currentDraft) => ({
        ...currentDraft,
        photoStoragePath: storagePath,
      }));
      setMessage(
        "Profile photo saved. ATS-first resumes will still exclude it unless you choose a photo-compatible format.",
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
        setMessage(
          payload.error?.message ?? "Unable to acknowledge that direction.",
        );
        return;
      }

      setMessage(
        `Target direction saved. ${brand.name} will use it for your profile read, master resume focus, job-fit reviews, and application materials.`,
      );
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
        setMessage(payload.error?.message ?? "Unable to confirm that profile fact.");
        return;
      }

      setMessage("Confirmed that profile fact.");
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function editFact(factId: string, currentValue: string) {
    const value = (
      await prompt({
        confirmLabel: "Save fact",
        description: "Update this profile fact and mark it confirmed.",
        input: {
          initialValue: currentValue,
          label: "Profile fact",
          required: true,
        },
        title: "Edit profile fact",
      })
    )?.trim();

    if (!value || value === currentValue) {
      return;
    }

    setPendingId(factId);
    setMessage(null);

    try {
      const response = await fetch(`/api/profile/facts/${factId}/confirm`, {
        body: JSON.stringify({ value }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to update that profile fact.");
        return;
      }

      setMessage("Updated and confirmed that profile fact.");
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function deleteFact(factId: string) {
    setPendingId(factId);
    setMessage(null);

    try {
      const response = await fetch(`/api/profile/facts/${factId}/confirm`, {
        method: "DELETE",
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to remove that profile fact.");
        return;
      }

      setMessage("Removed that profile fact.");
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  const learnedFactReceipt = buildLearnedFactReceipt(overview);

  return (
    <main className="profile-pane" aria-labelledby="profile-title">
      <TrustDialog />
      <div className="profile-heading">
        <div className="pane-heading">
          <p className="eyebrow">Profile home</p>
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
              <UserRound size={32} />
            )}
          </div>
          <label
            className="profile-photo-icon-action"
            title={
              draft.photoStoragePath
                ? "Replace profile photo"
                : "Add profile photo"
            }
          >
            <Camera size={15} aria-hidden="true" />
            <span className="sr-only">
              {draft.photoStoragePath
                ? "Replace profile photo"
                : "Add profile photo"}
            </span>
            <input
              accept="image/jpeg,image/png,image/webp"
              disabled={pendingId === "photo"}
              onChange={(event) =>
                uploadProfilePhoto(event.target.files?.[0] ?? null)
              }
              type="file"
            />
          </label>
        </div>
      </div>

      <section
        className={`next-action-panel ${profileGaps.length === 0 ? "single-column" : ""}`}
        aria-label="Recommended next step"
      >
        <div>
          <p className="eyebrow">Next best move</p>
          <h2>{nextMove.title}</h2>
          <p>{nextMove.body}</p>
          <div className="next-action-buttons">
            {nextMove.prompt ? (
              <button
                className="secondary-action compact-action compact-action-primary"
                onClick={() => draftProfileIntakePrompt(nextMove.prompt ?? "")}
                type="button"
              >
                <Send size={14} aria-hidden="true" />
                {nextMove.actionLabel}
              </button>
            ) : (
              <button
                className="secondary-action compact-action compact-action-primary"
                onClick={() => onNavigate(nextMove.target)}
                type="button"
              >
                {nextMove.actionLabel}
              </button>
            )}
          </div>
        </div>
        {profileGaps.length > 0 ? (
          <div className="next-action-support">
            <span>Most useful next details</span>
            <div className="profile-gap-list">
              {profileGaps.map((gap) => (
                <strong key={gap}>{gap}</strong>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="return-brief-panel" aria-label="What needs attention now">
        <div className="section-heading">
          <p className="eyebrow">Home</p>
          <h2>What needs attention now</h2>
        </div>
        <div className="return-brief-grid">
          {returnBrief.map((item) => (
            <button
              aria-label={`Open home task: ${item.label}, ${item.value}`}
              className={`return-brief-item ${item.priority ? "priority" : ""}`}
              key={item.label}
              onClick={() => onNavigate(item.target)}
              type="button"
            >
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <p>{item.detail}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="intake-action-panel" aria-label="Build profile from source material">
        <div className="section-heading">
          <p className="eyebrow">Build my profile</p>
          <h2>Start with the easiest evidence you have</h2>
          <p>
            Use the chat intake path for uploads, links, screenshots, and rough
            notes. {brand.name} will save sources in Library and ask before it
            trusts inferred facts.
          </p>
        </div>
        <div className="intake-action-grid">
          <button
            className="intake-action-card"
            onClick={() =>
              draftProfileIntakePrompt(
                "I am going to drop or upload my resume now. Please extract profile facts, chronology, skills, and useful resume evidence.",
              )
            }
            type="button"
          >
            <FileUp size={17} aria-hidden="true" />
            <strong>Drop resume</strong>
            <span>PDF, DOCX, TXT, or image</span>
          </button>
          <button
            className="intake-action-card"
            onClick={() =>
              draftProfileIntakePrompt(
                "I want to add LinkedIn evidence. I can upload a LinkedIn PDF/export, paste a public LinkedIn URL, or paste visible profile text.",
              )
            }
            type="button"
          >
            <FileUp size={17} aria-hidden="true" />
            <strong>LinkedIn source</strong>
            <span>PDF/export, URL, or pasted text</span>
          </button>
          <button
            className="intake-action-card"
            onClick={() =>
              draftProfileIntakePrompt(
                "Add this public profile, portfolio, or project link to my career profile: ",
              )
            }
            type="button"
          >
            <Link2 size={17} aria-hidden="true" />
            <strong>Add link</strong>
            <span>Portfolio, profile, writing, work samples</span>
          </button>
          <button
            className="intake-action-card"
            onClick={() =>
              draftProfileIntakePrompt(
                "Here are rough career notes to add to my profile. Please separate confirmed facts from questions: ",
              )
            }
            type="button"
          >
            <ClipboardPaste size={17} aria-hidden="true" />
            <strong>Paste notes</strong>
            <span>Fastest path when files are not ready</span>
          </button>
        </div>
      </section>

      <section className="cockpit-panel" aria-label="Career overview">
        <CockpitMetric
          detail="Review the master resume and profile direction"
          label="Resume"
          onClick={() => onNavigate("resume")}
          value="Open"
        />
        <CockpitMetric
          detail="Track every role you chose to pursue"
          label="Applications"
          onClick={() =>
            onNavigate({ applicationStageFilter: "All", view: "applications" })
          }
          value={applicationOverview.summary.total}
        />
        <CockpitMetric
          detail="Active interview loops and next steps"
          label="Interviewing"
          onClick={() =>
            onNavigate({
              applicationStageFilter: "Interview",
              view: "applications",
            })
          }
          value={applicationOverview.summary.interviewing}
        />
        <CockpitMetric
          detail="Roles sent but not answered yet"
          label="No reply"
          onClick={() =>
            onNavigate({
              applicationStageFilter: "Applied",
              view: "applications",
            })
          }
          value={applicationOverview.summary.noReply}
        />
        <CockpitMetric
          detail="Closed or rejected applications"
          label="Closed"
          onClick={() =>
            onNavigate({
              applicationStageFilter: "Closed",
              view: "applications",
            })
          }
          value={applicationOverview.summary.rejected}
        />
        <CockpitMetric
          detail="Decide whether to pursue these roles"
          label="Jobs to review"
          onClick={() => onNavigate("jobs")}
          value={jobOverview.summary.readyForReview}
        />
        <CockpitMetric
          detail="Open uploaded files and generated materials"
          label="Library"
          onClick={() => onNavigate("library")}
          value={overview.sourceCount + artifactOverview.summary.total}
        />
        <div className="stage-progress-card">
          <div>
            <span>Application outcomes</span>
            <strong>
              {applicationOverview.summary.total === 0
                ? "No active applications yet"
                : `${applicationOverview.summary.selected} selected`}
            </strong>
          </div>
          {applicationOverview.summary.total > 0 ? (
            <div
              className="stage-progress"
              aria-label="Application status distribution"
            >
              {applicationOverview.summary.byStatus.map((stage) => (
                <button
                  key={stage.label}
                  onClick={() =>
                    onNavigate({
                      applicationStageFilter: mapStatusToStageFilter(
                        stage.status,
                      ),
                      view: "applications",
                    })
                  }
                  title={`${stage.label}: ${stage.value}`}
                  type="button"
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
                </button>
              ))}
            </div>
          ) : (
            <p className="stage-empty-note">
              When you choose to pursue a role, {brand.name} will track it from
              review through interviews and outcomes here.
            </p>
          )}
        </div>
      </section>

      {message ? <p className="system-note success">{message}</p> : null}

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

      <section
        className="profile-intelligence-panel"
        aria-label="Profile intelligence"
      >
        <div className="section-heading">
          <p className="eyebrow">Career read</p>
          <h2>Strengths {brand.name} can use</h2>
        </div>
        <div className="profile-signal-grid">
          <article>
            <span>Positioning read</span>
            <strong>
              {formatEvidenceStrength(overview.intelligence.evidenceStrength)}
            </strong>
            <p>{overview.intelligence.roleTargetRead}</p>
          </article>
          <article>
            <span>Resume emphasis</span>
            <ul>
              {overview.intelligence.resumeFocus.slice(0, 4).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        </div>
        {overview.intelligence.proofThemes.length > 0 ? (
          <div className="proof-theme-list">
            {overview.intelligence.proofThemes.map((theme) => (
              <article key={theme.label}>
                <strong>{theme.label}</strong>
                <p>{theme.evidence[0]}</p>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      {overview.intelligence.highValueGaps.length > 0 ? (
        <section
          className="profile-intelligence-panel"
          aria-label="High-value gaps"
        >
          <div className="section-heading">
            <p className="eyebrow">Sharpen next</p>
            <h2>Questions that create better bullets</h2>
          </div>
          <div className="metric-prompt-list">
            {overview.intelligence.highValueGaps.slice(0, 5).map((gap) => (
              <article
                className={gap.severity}
                key={`${gap.label}-${gap.prompt}`}
              >
                <span>{gap.severity}</span>
                <strong>{gap.label}</strong>
                <p>{gap.prompt}</p>
                <button
                  className="secondary-action compact-action"
                  onClick={() => draftGapAnswerPrompt(gap.label, gap.prompt)}
                  type="button"
                >
                  <Send size={14} aria-hidden="true" />
                  Answer
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <details
        className="profile-editor-panel profile-editor-disclosure"
        aria-label="Profile direction editor"
      >
        <summary>
          <span>
            <p className="eyebrow">Profile details</p>
            <strong>Edit profile direction</strong>
          </span>
          <Pencil size={16} aria-hidden="true" />
        </summary>
        <div className="profile-editor-grid">
          <label>
            Name
            <input
              onChange={(event) =>
                setDraft({ ...draft, displayName: event.target.value })
              }
              placeholder="Your name"
              value={draft.displayName}
            />
          </label>
          <label>
            Headline
            <input
              onChange={(event) =>
                setDraft({ ...draft, headline: event.target.value })
              }
              placeholder="e.g. Product leader | Fintech platforms | GTM strategy"
              value={draft.headline}
            />
          </label>
          <label>
            Target direction
            <input
              onChange={(event) =>
                setDraft({ ...draft, targetDirection: event.target.value })
              }
              placeholder="Role family, domain, or path"
              value={draft.targetDirection}
            />
          </label>
          <label>
            Target level
            <input
              onChange={(event) =>
                setDraft({ ...draft, targetLevel: event.target.value })
              }
              placeholder="e.g. Senior Manager, Director, VP"
              value={draft.targetLevel}
            />
          </label>
          <label className="profile-summary-editor">
            Summary
            <textarea
              onChange={(event) =>
                setDraft({ ...draft, summary: event.target.value })
              }
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
      </details>

      <section className="profile-editor-panel" aria-label="Market and resume format guidance">
        <div className="section-heading">
          <p className="eyebrow">Market details</p>
          <h2>Target market and format</h2>
          <p>
            If you are targeting a specific country or region, add the details
            {brand.name} should respect before resume generation.
          </p>
        </div>
        <div className="profile-market-prompt-grid">
          {[
            "Target country/cities and whether you are open to relocation",
            "Work authorization, sponsorship needs, and notice period",
            "Languages to show on the resume or CV",
            "Preferred format, such as UAE CV, India resume, UK CV, or US resume",
          ].map((prompt) => (
            <button
              className="profile-market-prompt"
              key={prompt}
              onClick={() => draftMarketPrompt(prompt)}
              type="button"
            >
              {prompt}
            </button>
          ))}
        </div>
      </section>

      {learnedFactReceipt.length > 0 ? (
        <details
          className="profile-editor-panel profile-editor-disclosure fact-receipt-panel"
          aria-label="Review recently learned facts"
        >
          <summary>
            <span>
              <p className="eyebrow">Evidence history</p>
              <strong>{learnedFactReceipt.length} recent source fact{learnedFactReceipt.length === 1 ? "" : "s"}</strong>
            </span>
            <Pencil size={16} aria-hidden="true" />
          </summary>
          <div className="fact-groups fact-receipt-list compact">
            {learnedFactReceipt.map((fact) => (
              <article className="fact-group fact-receipt-card" key={fact.id}>
                <h3>{fact.type}</h3>
                <p>{fact.value}</p>
                <div className="fact-receipt-meta">
                  <span>{fact.sourceLabel}</span>
                  <span>{formatEvidenceStatus(fact.evidenceStatus)}</span>
                </div>
                <div className="fact-review-actions" aria-label={`Review ${fact.type} fact`}>
                  {fact.userConfirmed ? (
                    <span className="fact-confirmed-label">
                      <CheckCircle2 size={13} aria-hidden="true" />
                      Confirmed
                    </span>
                  ) : (
                    <button
                      className="fact-confirm-button"
                      disabled={pendingId === fact.id}
                      onClick={() => confirmFact(fact.id)}
                      type="button"
                    >
                      <CheckCircle2 size={13} aria-hidden="true" />
                      Confirm
                    </button>
                  )}
                  <button
                    className="fact-confirm-button"
                    disabled={pendingId === fact.id}
                    onClick={() => editFact(fact.id, fact.value)}
                    type="button"
                  >
                    <Pencil size={13} aria-hidden="true" />
                    Edit
                  </button>
                  <button
                    className="fact-delete-button"
                    disabled={pendingId === fact.id}
                    onClick={() => deleteFact(fact.id)}
                    type="button"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        </details>
      ) : null}

      {overview.roleRecommendations.length > 0 ? (
        <section className="roles-panel" aria-label="Role recommendations">
          <div className="section-heading">
            <p className="eyebrow">Role paths</p>
            <h2>Directions worth considering</h2>
          </div>
          <div className="role-list">
            {overview.roleRecommendations.map((recommendation) => (
              <article
                className={`role-card ${
                  recommendation.user_acknowledged ||
                  recommendation.role_family.trim().toLowerCase() ===
                    activeDirection
                    ? "selected"
                    : ""
                }`}
                key={recommendation.id}
              >
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
                {recommendation.user_acknowledged ||
                recommendation.role_family.trim().toLowerCase() ===
                  activeDirection ? (
                  <p className="role-selected-note">
                    <CheckCircle2 size={15} aria-hidden="true" />
                    Current working direction for profile positioning, resume
                    focus, job-fit reviews, and application materials.
                  </p>
                ) : null}
                {recommendation.open_questions.length > 0 ? (
                  <ul>
                    {recommendation.open_questions.map((question) => (
                      <li key={question}>{question}</li>
                    ))}
                  </ul>
                ) : null}
                {recommendation.user_acknowledged ||
                recommendation.role_family.trim().toLowerCase() ===
                  activeDirection ? (
                  <span className="role-current-target">
                    <CheckCircle2 size={15} aria-hidden="true" />
                    Current target
                  </span>
                ) : (
                  <button
                    className="secondary-action"
                    disabled={pendingId === recommendation.id}
                    onClick={() => acknowledgeRecommendation(recommendation.id)}
                    title="Sets this as your working target direction for profile positioning, resume focus, job fit, and application materials."
                    type="button"
                  >
                    {pendingId === recommendation.id
                      ? "Saving..."
                      : "Set as target direction"}
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function draftMarketPrompt(prompt: string) {
  draftProfileIntakePrompt(`Add this profile guidance: ${prompt}. My answer: `);
}

function draftGapAnswerPrompt(label: string, prompt: string) {
  draftProfileIntakePrompt(
    [
      "I want to answer this missing resume evidence question:",
      "",
      `${label}: ${prompt}`,
      "",
      "My answer:",
    ].join("\n"),
  );
}

function draftProfileIntakePrompt(text: string) {
  window.dispatchEvent(
    new CustomEvent("pramania:conversation-draft", {
      detail: {
        focus: true,
        source: "profile-intake-action",
        text,
      },
    }),
  );
  window.dispatchEvent(
    new CustomEvent("pramania:focus-chat", {
      detail: {
        reason: "market-profile-guidance",
      },
    }),
  );
}

function buildLearnedFactReceipt(overview: ProfileOverview) {
  const sourceLabelById = new Map(
    overview.recentSources.map((source) => [
      source.id,
      source.original_filename ?? source.source_url ?? formatSourceLabel(source.source_type),
    ]),
  );

  return Object.entries(overview.factsByType)
    .flatMap(([type, facts]) =>
      facts.map((fact) => ({
        createdAt: fact.created_at,
        evidenceStatus: fact.evidence_status,
        id: fact.id,
        sourceLabel:
          fact.source_ids
            .map((sourceId) => sourceLabelById.get(sourceId))
            .find(Boolean) ?? "Profile input",
        type,
        userConfirmed: fact.user_confirmed,
        value: fact.fact_value,
      })),
    )
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt))
    .slice(0, 6);
}

function formatEvidenceStatus(status: string) {
  if (status === "user_confirmed") return "Confirmed by you";
  if (status === "source_supported") return "Source supported";
  if (status === "conflict") return "Conflicting evidence";
  if (status === "missing_evidence") return "Needs evidence";
  if (status === "inferred") return "Needs confirmation";
  return status.replaceAll("_", " ");
}

function mapStatusToStageFilter(status: string) {
  if (status === "draft") return "Review";
  if (status === "interview_in_progress") return "Interview";
  if (status === "interviewed_selected") return "Selected";
  if (["rejected", "interviewed_not_selected", "withdrawn"].includes(status))
    return "Closed";
  return "Applied";
}

function readStageWidth(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.max(8, Math.round((value / total) * 100));
}

function readReturnBrief({
  applicationOverview,
  artifactOverview,
  jobOverview,
  masterResumeOverview,
  overview,
}: {
  applicationOverview: ApplicationOverview;
  artifactOverview: ArtifactOverview;
  jobOverview: JobOverview;
  masterResumeOverview: MasterResumeOverview;
  overview: ProfileOverview;
}) {
  const blockedSourceCount = overview.recentSources.filter((source) =>
    ["failed", "error", "analysis_failed"].includes(source.extraction_status),
  ).length;
  const latestArtifact = artifactOverview.artifacts[0] ?? null;
  const followUpCount = applicationOverview.openFollowUpCount;
  const jobsToReview = jobOverview.summary.readyForReview;
  const latestResume = masterResumeOverview.latestResume;
  const resumeReady = Boolean(
    latestResume?.pdfDownloadUrl && latestResume.docxDownloadUrl,
  );

  return [
    {
      detail: latestResume
        ? resumeReady
          ? "PDF and DOCX are ready from Profile & Resume."
          : "Review the draft, resolve any checklist items, then prepare files."
        : "Create the ATS master resume once the profile has enough evidence.",
      label: "Master resume",
      priority: !resumeReady,
      target: "resume" as const,
      value: latestResume ? (resumeReady ? "Ready to download" : "Needs export") : "Not created",
    },
    {
      detail:
        masterResumeOverview.missingEvidence.length > 0
          ? masterResumeOverview.missingEvidence[0]
          : "No blocking master-resume issue is currently open.",
      label: "Resume checklist",
      priority: masterResumeOverview.missingEvidence.length > 0,
      target: "resume" as const,
      value:
        masterResumeOverview.missingEvidence.length > 0
          ? `${masterResumeOverview.missingEvidence.length} to review`
          : "Clear",
    },
    {
      detail:
        followUpCount > 0
          ? "Update status, prepare materials, or decide the next move."
          : "No tracked applications currently need follow-up.",
      label: "Follow-ups",
      priority: followUpCount > 0,
      target: { applicationStageFilter: "Applied", view: "applications" } as const,
      value: followUpCount,
    },
    {
      detail:
        jobsToReview > 0
          ? "Review fit, gaps, risks, and whether each role is worth pursuing."
          : "Paste a role into chat when you want a fit read.",
      label: "Jobs to review",
      priority: jobsToReview > 0,
      target: "jobs" as const,
      value: jobsToReview,
    },
    {
      detail:
        blockedSourceCount > 0
          ? "A saved item needs a clearer copy or another read attempt."
          : latestArtifact
            ? `Latest generated item: ${latestArtifact.label}`
            : "Uploaded sources and generated materials are available here.",
      label: blockedSourceCount > 0 ? "Sources needing review" : "Library",
      priority: blockedSourceCount > 0,
      target: "library" as const,
      value:
        blockedSourceCount > 0
          ? blockedSourceCount
          : artifactOverview.summary.total > 0
            ? artifactOverview.summary.total
            : overview.sourceCount,
    },
  ] satisfies Array<{
    detail: string;
    label: string;
    priority?: boolean;
    target: WorkspaceNavigationTarget;
    value: number | string;
  }>;
}

function formatSourceLabel(sourceType: string) {
  if (sourceType === "docx") return "Word document";
  if (sourceType === "pdf") return "PDF";
  if (sourceType === "txt") return "text note";
  if (sourceType === "image") return "image";
  if (sourceType === "linkedin") return "LinkedIn source";
  if (sourceType === "portfolio") return "portfolio source";
  return sourceType.replaceAll("_", " ");
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

  if (overview.factCount < 3) {
    gaps.push("Outcome evidence");
  }

  if (overview.sourceCount === 0) {
    gaps.push("Resume or profile source");
  }

  return gaps.slice(0, 4);
}

function readNextMove({
  applicationOverview,
  jobOverview,
  masterResumeOverview,
  overview,
  profileGaps,
}: {
  applicationOverview: ApplicationOverview;
  jobOverview: JobOverview;
  masterResumeOverview: MasterResumeOverview;
  overview: ProfileOverview;
  profileGaps: string[];
}): HomeNextMove {
  if (overview.factCount === 0) {
    return {
      actionLabel: "Add evidence",
      body: `Drop a resume, paste LinkedIn or a portfolio, or tell ${brand.name} what you have done. One useful source is enough to begin building your profile.`,
      prompt: "I want to build my profile. Here is the career evidence I can share: ",
      target: "profile" as const,
      title: "Start with what you have",
    };
  }

  if (
    overview.roleRecommendations.some(
      (recommendation) => !recommendation.user_acknowledged,
    )
  ) {
    return {
      actionLabel: "Review role paths",
      body: `Review the role paths ${brand.name} suggested and choose the direction that feels right. This keeps resume and application work focused.`,
      target: "profile" as const,
      title: "Choose the working lane",
    };
  }

  if (profileGaps.length > 0) {
    return {
      actionLabel: "Answer key gap",
      body: `The profile is taking shape. Next, add ${formatList(profileGaps.map((gap) => gap.toLowerCase()))} so ${brand.name} can position you with more confidence.`,
      prompt: `I want to close these profile gaps for my resume: ${formatList(profileGaps)}. My answer: `,
      target: "profile" as const,
      title: "Fill the gaps hiring teams notice",
    };
  }

  if (jobOverview.summary.readyForReview > 0) {
    return {
      actionLabel: "Review job fit",
      body: "You have a job post ready for review. Review fit, gaps, and tradeoffs before drafting job-specific materials.",
      target: "jobs" as const,
      title: "Review the role fit",
    };
  }

  if (applicationOverview.summary.needsReview > 0) {
    return {
      actionLabel: "Open applications",
      body: "You have an application waiting for a next action. Draft the materials, update status, or decide whether to proceed.",
      target: { applicationStageFilter: "Review", view: "applications" } as const,
      title: "Finish the application record",
    };
  }

  if (
    masterResumeOverview.latestResume &&
    (!masterResumeOverview.latestResume.pdfDownloadUrl ||
      !masterResumeOverview.latestResume.docxDownloadUrl)
  ) {
    return {
      actionLabel: "Review master resume",
      body: "Your draft is available, but the final PDF/DOCX files are not ready yet. Review the checklist, then prepare the export from Profile & Resume.",
      target: "resume" as const,
      title: "Prepare the master resume export",
    };
  }

  return {
    actionLabel: "Add job link",
    body: `Paste a role you are considering into ${brand.name}. It will compare the posting against your profile and help decide whether it is worth pursuing.`,
    prompt: "I want to review this job against my profile: ",
    target: "jobs" as const,
    title: "Ready for a job link",
  };
}

function CockpitMetric({
  detail,
  label,
  onClick,
  value,
}: {
  detail: string;
  label: string;
  onClick: () => void;
  value: number | string;
}) {
  return (
    <button
      aria-label={`Open ${label}: ${value}. ${detail}`}
      className="cockpit-metric"
      onClick={onClick}
      title={detail}
      type="button"
    >
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </button>
  );
}

function formatList(items: string[]) {
  if (items.length <= 1) {
    return items[0] ?? "";
  }

  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function formatEvidenceStrength(
  value: ProfileOverview["intelligence"]["evidenceStrength"],
) {
  const labels: Record<
    ProfileOverview["intelligence"]["evidenceStrength"],
    string
  > = {
    developing: "Taking shape",
    strong: "Well supported",
    thin: "Needs more evidence",
  };

  return labels[value];
}

function readImageExtension(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}
