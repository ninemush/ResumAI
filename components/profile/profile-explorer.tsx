"use client";

import { useState } from "react";
import { CheckCircle2, Compass, Save, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";

import { brand } from "@/lib/brand";
import type { ProfileOverview } from "@/lib/profile/profile-overview";

type ProfileExplorerProps = {
  overview: ProfileOverview;
};

type ProfileDraft = {
  displayName: string;
  headline: string;
  summary: string;
  targetDirection: string;
  targetLevel: string;
};

export function ProfileExplorer({ overview }: ProfileExplorerProps) {
  const router = useRouter();
  const profileName = overview.profile?.displayName ?? "Your profile";
  const headline = overview.profile?.headline ?? "Profile direction not set yet";
  const hasFacts = overview.factCount > 0;
  const [draft, setDraft] = useState<ProfileDraft>({
    displayName: overview.profile?.displayName ?? "",
    headline: overview.profile?.headline ?? "",
    summary: overview.profile?.summary ?? "",
    targetDirection: overview.profile?.targetDirection ?? "",
    targetLevel: overview.profile?.targetLevel ?? "",
  });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
      <div className="pane-heading">
        <p className="eyebrow">Profile explorer</p>
        <h1 id="profile-title">{profileName}</h1>
        <p>{headline}</p>
      </div>

      <section className="readiness-panel" aria-label="Profile readiness">
        <div>
          <span className="readiness-score">{overview.readinessScore}%</span>
          <p>Profile readiness</p>
        </div>
        <p>
          {hasFacts
            ? `${overview.factCount} profile details captured from ${overview.sourceCount} source${overview.sourceCount === 1 ? "" : "s"}. ${overview.confirmedFactCount} detail${overview.confirmedFactCount === 1 ? "" : "s"} confirmed.`
            : "Start naturally in the AI agent: type a quick work-history note, paste LinkedIn or a portfolio, or drag in a resume. I will turn that into structured profile evidence here."}
        </p>
      </section>

      {message ? <p className="system-note success">{message}</p> : null}

      <section className="profile-editor-panel" aria-label="Profile direction editor">
        <div className="section-heading">
          <p className="eyebrow">Working profile</p>
          <h2>Shape the story</h2>
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
          <strong>{overview.tierName ?? "Unassigned"}</strong>
        </div>
        <div>
          <span>Status</span>
          <strong>{overview.profile?.status.replace("_", " ") ?? "draft"}</strong>
        </div>
        <div>
          <span>Target</span>
          <strong>{overview.profile?.targetDirection ?? "Needs direction"}</strong>
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
                </div>
                <span className={`source-pill ${source.extraction_status}`}>
                  {source.extraction_status.replace("_", " ")}
                </span>
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
                      <span>{fact.fact_value}</span>
                      {fact.user_confirmed ? (
                        <CheckCircle2 size={16} aria-label="Confirmed" />
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
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">
            Once you share a resume, link, or work-history note in the AI agent,
            captured details will appear here for confirmation.
          </p>
        )}
      </section>
    </main>
  );
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
  };

  return friendlyMessages[reason] ?? "Extraction needs another attempt.";
}
