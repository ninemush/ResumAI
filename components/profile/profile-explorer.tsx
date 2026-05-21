import { CheckCircle2, CircleDashed, FileUp, Link2, MessageSquareText } from "lucide-react";

const profileSteps = [
  {
    label: "Tell ResumAI your story",
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

export function ProfileExplorer() {
  return (
    <main className="profile-pane" aria-labelledby="profile-title">
      <div className="pane-heading">
        <p className="eyebrow">Profile explorer</p>
        <h1 id="profile-title">Start with the candidate profile.</h1>
        <p>
          This center workspace will become the editable source of truth for the
          user&apos;s experience, role direction, resumes, and application history.
        </p>
      </div>

      <section className="readiness-panel" aria-label="Profile readiness">
        <div>
          <span className="readiness-score">0%</span>
          <p>Profile readiness</p>
        </div>
        <p>
          No profile facts have been captured yet. The first build step after
          auth is unified intake: chat, uploads, and links all creating the same
          normalized profile facts.
        </p>
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
