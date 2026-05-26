"use client";

import { AlertCircle, CheckCircle2, FileText, Save, WandSparkles } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import type { ResumeContent } from "@/lib/resumes/resume-content";
import type { MasterResumeOverview } from "@/lib/resumes/master-resume";

type MasterResumePanelProps = {
  overview: MasterResumeOverview;
};

export function MasterResumePanel({ overview }: MasterResumePanelProps) {
  const router = useRouter();
  const [currentOverview, setCurrentOverview] = useState(overview);
  const [draft, setDraft] = useState<ResumeContent | null>(
    overview.latestResume?.content ?? null,
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function generateResume() {
    setIsGenerating(true);
    setMessage(null);

    try {
      const response = await fetch("/api/resume/master", {
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to generate the master resume.");
        return;
      }

      setCurrentOverview(payload.overview);
      setDraft(payload.overview.latestResume?.content ?? null);
      setMessage(payload.summary ?? "Generated a master resume draft.");
      router.refresh();
    } finally {
      setIsGenerating(false);
    }
  }

  async function saveResume() {
    if (!draft) {
      return;
    }

    setIsSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/resume/master", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: draft }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to save the master resume.");
        return;
      }

      setCurrentOverview(payload.overview);
      setDraft(payload.overview.latestResume?.content ?? draft);
      setMessage("Saved master resume edits.");
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="profile-pane" aria-labelledby="resume-studio-title">
      <div className="pane-heading">
        <p className="eyebrow">Resume studio</p>
        <h1 id="resume-studio-title">Master resume</h1>
        <p>
          Build a reusable ATS-friendly resume from confirmed profile evidence. Keep this
          grounded, then tailor from it for specific roles.
        </p>
      </div>

      <section className="resume-readiness-panel" aria-label="Master resume readiness">
        <div>
          <span>{currentOverview.confirmedFactCount}</span>
          <strong>Confirmed proof points</strong>
          <p>{currentOverview.readinessNote}</p>
        </div>
        <div className="resume-readiness-actions">
          <button
            className="secondary-action"
            disabled={!currentOverview.canGenerate || isGenerating}
            onClick={generateResume}
            title={
              currentOverview.canGenerate
                ? "Generate a master resume from confirmed evidence"
                : "Confirm profile evidence before generating"
            }
            type="button"
          >
            <WandSparkles size={15} aria-hidden="true" />
            {isGenerating
              ? "Generating..."
              : currentOverview.latestResume
                ? "Regenerate"
                : "Generate master resume"}
          </button>
          <button
            className="secondary-action"
            disabled={!draft || isSaving}
            onClick={saveResume}
            title="Save edits to the current master resume draft"
            type="button"
          >
            <Save size={15} aria-hidden="true" />
            {isSaving ? "Saving..." : "Save draft"}
          </button>
        </div>
      </section>

      {message ? <p className="system-note success">{message}</p> : null}

      {currentOverview.missingEvidence.length > 0 ? (
        <section className="resume-gap-panel" aria-label="Master resume gaps">
          <div className="section-heading">
            <p className="eyebrow">Before generation</p>
            <h2>Evidence still needed</h2>
          </div>
          <ul>
            {currentOverview.missingEvidence.map((gap) => (
              <li key={gap}>
                <AlertCircle size={15} aria-hidden="true" />
                {gap}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {draft ? (
        <section className="materials-review master-resume-editor" aria-label="Master resume editor">
          <div className="materials-review-header">
            <div>
              <p className="eyebrow">Draft</p>
              <h2>{draft.headline}</h2>
            </div>
            <span className="resume-status-pill">
              <CheckCircle2 size={15} aria-hidden="true" />
              {currentOverview.latestResume?.status ?? "draft"}
            </span>
          </div>

          <div className="materials-editor-grid">
            <label>
              Resume headline
              <input
                onChange={(event) => setDraft({ ...draft, headline: event.target.value })}
                value={draft.headline}
              />
            </label>
            <label>
              Resume summary
              <textarea
                onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
                rows={5}
                value={draft.summary}
              />
            </label>
            <label>
              Skills
              <textarea
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    skills: splitLines(event.target.value),
                  })
                }
                rows={5}
                value={draft.skills.join("\n")}
              />
            </label>
            <label>
              Experience bullets
              <textarea
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    experienceBullets: splitLines(event.target.value),
                  })
                }
                rows={9}
                value={draft.experienceBullets.join("\n")}
              />
            </label>
            <label>
              Gaps to resolve
              <textarea
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    keywordGaps: splitLines(event.target.value),
                  })
                }
                rows={5}
                value={draft.keywordGaps.join("\n")}
              />
            </label>
            <label>
              Reviewer notes
              <textarea
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    reviewerNotes: splitLines(event.target.value),
                  })
                }
                rows={5}
                value={draft.reviewerNotes.join("\n")}
              />
            </label>
          </div>
        </section>
      ) : (
        <section className="resume-empty-panel" aria-label="No master resume yet">
          <FileText size={22} aria-hidden="true" />
          <div>
            <h2>No master resume yet</h2>
            <p>
              Confirm profile facts first, then generate a draft here. Pramania will keep
              unsupported claims out and call out evidence gaps before you tailor for jobs.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}

function splitLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim().replace(/^-+\s*/, ""))
    .filter(Boolean);
}
