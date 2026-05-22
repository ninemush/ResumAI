import { CheckCircle2, Compass, Sparkles } from "lucide-react";

import { brand } from "@/lib/brand";
import type { ProfileOverview } from "@/lib/profile/profile-overview";

type ProfileExplorerProps = {
  overview: ProfileOverview;
};

export function ProfileExplorer({ overview }: ProfileExplorerProps) {
  const profileName = overview.profile?.displayName ?? "Your profile";
  const headline = overview.profile?.headline ?? "Profile direction not set yet";
  const hasFacts = overview.factCount > 0;

  return (
    <main className="profile-pane" aria-labelledby="profile-title">
      <div className="pane-heading">
        <p className="eyebrow">Profile explorer</p>
        <h1 id="profile-title">{profileName}</h1>
        <p>
          {headline}
        </p>
      </div>

      <section className="readiness-panel" aria-label="Profile readiness">
        <div>
          <span className="readiness-score">{overview.readinessScore}%</span>
          <p>Profile readiness</p>
        </div>
        <p>
          {hasFacts
            ? `${overview.factCount} profile details captured from ${overview.sourceCount} source${overview.sourceCount === 1 ? "" : "s"}. ${overview.confirmedFactCount} detail${overview.confirmedFactCount === 1 ? "" : "s"} confirmed.`
            : "No profile facts have been captured yet. Chat, uploads, and links will all create the same normalized profile facts."}
        </p>
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
            <p className="eyebrow">Working draft</p>
            <h2>The current read</h2>
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
                      ) : null}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        ) : null}
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
