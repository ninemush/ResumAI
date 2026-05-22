import { CheckCircle2, CircleDashed, FileUp, Link2, MessageSquareText } from "lucide-react";

import { ProfileSourceUploader } from "@/components/profile/profile-source-uploader";
import { brand } from "@/lib/brand";
import type { ProfileOverview } from "@/lib/profile/profile-overview";

const profileSteps = [
  {
    label: `Tell ${brand.name} your story`,
    detail: "Conversational intake for experience, strengths, goals, and constraints.",
    icon: MessageSquareText,
    state: "Ready",
  },
  {
    label: "Upload source material",
    detail: "PDF, DOCX, text, image/OCR, and public profile links belong here next.",
    icon: FileUp,
    state: "Next",
  },
  {
    label: "Enrich from trusted links",
    detail: "Public LinkedIn, portfolio, and profile pages after validation and consent.",
    icon: Link2,
    state: "Planned",
  },
];

type ProfileExplorerProps = {
  overview: ProfileOverview;
  userId: string;
};

export function ProfileExplorer({ overview, userId }: ProfileExplorerProps) {
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

      <ProfileSourceUploader userId={userId} />

      <section className="sources-panel" aria-label="Recent profile sources">
        <div className="section-heading">
          <p className="eyebrow">Recent sources</p>
          <h2>What you have added</h2>
        </div>
        {overview.recentSources.length > 0 ? (
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
        ) : (
          <p className="empty-state">
            Upload a resume, Word document, PDF, text file, or add a profile link to
            start building your source library.
          </p>
        )}
      </section>

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
        ) : (
          <p className="empty-state">
            Start with a sentence or two in the conversation panel. Keep it casual:
            roles, wins, tools, credentials, and what you want next all help.
          </p>
        )}
      </section>

      <section className="step-list" aria-label="Profile build steps">
        {profileSteps.map((step) => {
          const Icon = step.icon;
          const isReady = step.state === "Ready";

          return (
            <article className="step-row" key={step.label}>
              <div className={isReady ? "step-icon ready" : "step-icon"}>
                {isReady ? (
                  <CheckCircle2 size={20} aria-hidden="true" />
                ) : (
                  <Icon size={20} aria-hidden="true" />
                )}
              </div>
              <div>
                <h2>{step.label}</h2>
                <p>{step.detail}</p>
              </div>
              <span className="status-pill">
                {step.state === "Planned" ? (
                  <CircleDashed size={14} aria-hidden="true" />
                ) : null}
                {step.state}
              </span>
            </article>
          );
        })}
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
