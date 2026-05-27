"use client";

import { AlertCircle, CheckCircle2, Download, FileText, Save, WandSparkles } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import type { ResumeContent } from "@/lib/resumes/resume-content";
import type { MasterResumeOverview } from "@/lib/resumes/master-resume";
import type { ProfileOverview } from "@/lib/profile/profile-overview";

type MasterResumePanelProps = {
  overview: MasterResumeOverview;
  profileOverview: ProfileOverview;
};

export function MasterResumePanel({ overview, profileOverview }: MasterResumePanelProps) {
  const router = useRouter();
  const [currentOverview, setCurrentOverview] = useState(overview);
  const [draft, setDraft] = useState<ResumeContent | null>(
    overview.latestResume?.content ?? null,
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
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

  async function exportResumePdf() {
    setIsExporting(true);
    setMessage(null);

    try {
      const response = await fetch("/api/resume/master/export", {
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to export the master resume PDF.");
        return;
      }

      setCurrentOverview(payload.overview);
      setDraft(payload.overview.latestResume?.content ?? draft);
      setMessage("Exported a validated master resume PDF.");
      router.refresh();
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <main className="profile-pane" aria-labelledby="resume-studio-title">
      <div className="pane-heading">
        <p className="eyebrow">Profile & resume studio</p>
        <h1 id="resume-studio-title">Master profile and resume</h1>
        <p>
          Build a reusable ATS-friendly master resume from your profile evidence, then
          create sharper role-focused variants from the same trusted context.
        </p>
      </div>

      <section className="profile-draft-panel" aria-label="Working profile snapshot">
        <div className="section-heading">
          <p className="eyebrow">Current profile read</p>
          <h2>{profileOverview.profile?.headline ?? "Still calibrating"}</h2>
        </div>
        <p>
          {profileOverview.profile?.summary ??
            "Pramania needs a little more signal before it can write a strong positioning read."}
        </p>
        <div className="draft-chips">
          <span>{profileOverview.profile?.targetDirection ?? "Target direction open"}</span>
          <span>{profileOverview.profile?.targetLevel ?? "Level open"}</span>
          <span>{profileOverview.factCount} profile signal{profileOverview.factCount === 1 ? "" : "s"}</span>
        </div>
      </section>

      <section className="resume-readiness-panel" aria-label="Master resume readiness">
        <div>
          <span>{currentOverview.confirmedFactCount}</span>
          <strong>Profile proof points</strong>
          <p>{currentOverview.readinessNote}</p>
        </div>
        <div className="resume-readiness-actions">
          <button
            className="secondary-action"
            disabled={!currentOverview.canGenerate || isGenerating}
            onClick={generateResume}
            title={
              currentOverview.canGenerate
                ? "Generate a master resume from profile evidence"
                : "Add profile evidence before generating"
            }
            type="button"
          >
            <WandSparkles size={15} aria-hidden="true" />
            {isGenerating
              ? "Generating..."
              : currentOverview.latestResume
                ? "Generate role-focused variant"
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
          <button
            className="secondary-action"
            disabled={!draft || isExporting}
            onClick={exportResumePdf}
            title="Export a validated ATS-friendly PDF from the current master resume"
            type="button"
          >
            <Download size={15} aria-hidden="true" />
            {isExporting ? "Exporting..." : "Export PDF"}
          </button>
          {currentOverview.latestResume?.pdfDownloadUrl ? (
            <a
              className="secondary-action"
              href={currentOverview.latestResume.pdfDownloadUrl}
              rel="noreferrer"
              target="_blank"
              title="Open the latest exported master resume PDF"
            >
              <FileText size={15} aria-hidden="true" />
              Open PDF
            </a>
          ) : null}
        </div>
      </section>

      {message ? <p className="system-note success">{message}</p> : null}

      {(currentOverview.missingEvidence.length > 0 || draft?.keywordGaps.length || draft?.reviewerNotes.length) ? (
        <section className="resume-gap-panel priority-review-panel" aria-label="Master resume review priorities">
          <div className="section-heading">
            <p className="eyebrow">Review first</p>
            <h2>Gaps and reviewer notes</h2>
          </div>
          <div className="resume-review-grid">
            {currentOverview.missingEvidence.map((gap) => (
              <ReviewItem key={gap} severity="critical" text={gap} />
            ))}
            {draft?.keywordGaps.map((gap) => (
              <ReviewItem key={gap} severity="important" text={gap} />
            ))}
            {draft?.reviewerNotes.map((note) => (
              <ReviewItem key={note} severity="informational" text={note} />
            ))}
          </div>
        </section>
      ) : null}

      {draft ? (
        <section className="materials-review master-resume-editor resume-studio-surface" aria-label="Master resume editor">
          <div className="materials-review-header">
            <div>
              <p className="eyebrow">Draft</p>
              <h2>ATS master resume</h2>
            </div>
            <span className="resume-status-pill">
              <CheckCircle2 size={15} aria-hidden="true" />
              {currentOverview.latestResume?.status ?? "draft"}
            </span>
          </div>

          <div className="resume-document-preview" aria-label="Resume preview">
            <header>
              <input
                aria-label="Resume headline"
                onChange={(event) => setDraft({ ...draft, headline: event.target.value })}
                value={draft.headline}
              />
            </header>
            <section>
              <h3>Professional Summary</h3>
              <textarea
                aria-label="Resume summary"
                onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
                rows={Math.max(4, Math.ceil(draft.summary.length / 110))}
                value={draft.summary}
              />
            </section>
            <section>
              <h3>Core Skills</h3>
              <textarea
                aria-label="Skills"
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    skills: splitLines(event.target.value),
                  })
                }
                rows={Math.max(3, Math.ceil(draft.skills.join(", ").length / 110))}
                value={draft.skills.join(", ")}
              />
            </section>
            <section>
              <h3>Experience Highlights</h3>
              <textarea
                aria-label="Experience bullets"
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    experienceBullets: splitLines(event.target.value),
                  })
                }
                rows={Math.max(8, draft.experienceBullets.length + 2)}
                value={draft.experienceBullets.map((bullet) => `- ${bullet}`).join("\n")}
              />
            </section>
          </div>

          <details className="resume-advanced-editor">
            <summary>Edit gap and reviewer fields</summary>
            <label>
              Keyword gaps
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
          </details>
        </section>
      ) : (
        <section className="resume-empty-panel" aria-label="No master resume yet">
          <FileText size={22} aria-hidden="true" />
          <div>
            <h2>No master resume yet</h2>
            <p>
              Add profile evidence first, then generate a draft here. Pramania will keep
              unsupported claims out and call out evidence gaps before you tailor for jobs.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}

function ReviewItem({
  severity,
  text,
}: {
  severity: "critical" | "important" | "informational";
  text: string;
}) {
  return (
    <article className={`review-item ${severity}`}>
      <span>{severity}</span>
      <p>
        <AlertCircle size={15} aria-hidden="true" />
        {text}
      </p>
    </article>
  );
}

function splitLines(value: string) {
  return value
    .split(/\n|,/)
    .map((line) => line.trim().replace(/^-+\s*/, ""))
    .filter(Boolean);
}
