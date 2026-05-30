"use client";

import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileText,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { normalizeResumeContent, type ResumeContent } from "@/lib/resumes/resume-content";
import type { MasterResumeOverview } from "@/lib/resumes/master-resume";
import type { ProfileOverview } from "@/lib/profile/profile-overview";

type MasterResumePanelProps = {
  onDirtyChange?: (isDirty: boolean) => void;
  overview: MasterResumeOverview;
  profileOverview: ProfileOverview;
};

export function MasterResumePanel({
  onDirtyChange,
  overview,
  profileOverview,
}: MasterResumePanelProps) {
  const router = useRouter();
  const resumePreviewRef = useRef<HTMLDivElement | null>(null);
  const [currentOverview, setCurrentOverview] = useState(overview);
  const [draft, setDraft] = useState<ResumeContent | null>(
    overview.latestResume?.content ?? null,
  );
  const [savedDraft, setSavedDraft] = useState<ResumeContent | null>(
    overview.latestResume?.content ?? null,
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(savedDraft),
    [draft, savedDraft],
  );
  const hasDraft = Boolean(draft);
  const reviewItems = useMemo(() => {
    const visibleLimit = hasDraft ? 4 : 8;
    const items = [
      ...currentOverview.missingEvidence.map((text) => ({
        severity: "critical" as const,
        text,
      })),
      ...(draft?.keywordGaps ?? []).map((text) => ({
        severity: "important" as const,
        text,
      })),
      ...(draft?.reviewerNotes ?? []).map((text) => ({
        severity: "informational" as const,
        text,
      })),
    ];

    return {
      hiddenCount: Math.max(0, items.length - visibleLimit),
      visible: items.slice(0, visibleLimit),
    };
  }, [currentOverview.missingEvidence, draft?.keywordGaps, draft?.reviewerNotes, hasDraft]);

  useEffect(() => {
    onDirtyChange?.(isDirty);

    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (!isDirty) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!draft || !resumePreviewRef.current) {
      return;
    }

    resumePreviewRef.current.querySelectorAll("textarea").forEach((field) => {
      autoGrowTextArea(field);
    });
  }, [draft]);

  async function generateResume() {
    if (isDirty && !window.confirm("Regenerating will replace unsaved resume edits. Continue?")) {
      return;
    }

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
      setSavedDraft(payload.overview.latestResume?.content ?? null);
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

    let normalizedDraft: ResumeContent;
    try {
      normalizedDraft = normalizeResumeContent(draft);
    } catch {
      setMessage("The resume has an empty required section. Add a summary, headline, skill, and at least one experience bullet before saving.");
      return;
    }

    setIsSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/resume/master", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: normalizedDraft }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to save the master resume.");
        return;
      }

      setCurrentOverview(payload.overview);
      setDraft(payload.overview.latestResume?.content ?? draft);
      setSavedDraft(payload.overview.latestResume?.content ?? draft);
      setMessage("Saved master resume edits.");
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  async function exportResumeFiles() {
    if (isDirty) {
      setMessage("Save or discard your resume edits before exporting PDF and DOCX files.");
      return;
    }

    setIsExporting(true);
    setMessage(null);

    try {
      const response = await fetch("/api/resume/master/export", {
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to export the master resume files.");
        return;
      }

      setCurrentOverview(payload.overview);
      setDraft(payload.overview.latestResume?.content ?? draft);
      setSavedDraft(payload.overview.latestResume?.content ?? draft);
      setMessage("Exported validated master resume PDF and DOCX files.");
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
          Build a reusable ATS-friendly master resume from your career context, then
          create sharper role-focused variants from the same trusted context.
        </p>
      </div>

      <section className="resume-readiness-panel" aria-label="Master resume readiness">
        <div>
          <span>{currentOverview.canGenerate ? "Ready" : "Needs work"}</span>
          <strong>Master resume</strong>
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
                ? "Regenerate master resume"
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
            onClick={exportResumeFiles}
            title="Export validated ATS-friendly PDF and DOCX files from the standard template"
            type="button"
          >
            <Download size={15} aria-hidden="true" />
            {isExporting ? "Exporting..." : "Export PDF + DOCX"}
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
          {currentOverview.latestResume?.docxDownloadUrl ? (
            <a
              className="secondary-action"
              href={currentOverview.latestResume.docxDownloadUrl}
              rel="noreferrer"
              target="_blank"
              title="Open the latest exported master resume DOCX"
            >
              <FileText size={15} aria-hidden="true" />
              Open DOCX
            </a>
          ) : null}
        </div>
      </section>

      {message ? <p className="system-note success">{message}</p> : null}

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
          {isDirty ? (
            <div className="resume-unsaved-banner" role="status">
              <span>You have unsaved resume edits.</span>
              <div>
                <button className="secondary-action compact-action" disabled={isSaving} onClick={saveResume} type="button">
                  <Save size={14} aria-hidden="true" />
                  Save
                </button>
                <button
                  className="secondary-action compact-action"
                  onClick={() => {
                    setDraft(savedDraft);
                    setMessage("Discarded unsaved resume edits.");
                  }}
                  type="button"
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  Discard
                </button>
              </div>
            </div>
          ) : null}

          <div
            className="resume-document-preview"
            aria-label="Resume preview"
            onInputCapture={(event) => {
              if (event.target instanceof HTMLTextAreaElement) {
                autoGrowTextArea(event.target);
              }
            }}
            ref={resumePreviewRef}
          >
            <header className="resume-preview-header">
              <strong className="resume-preview-name">
                {profileOverview.profile?.displayName ?? "Your Name"}
              </strong>
              <textarea
                aria-label="Resume headline"
                className="resume-headline-field"
                onChange={(event) => setDraft({ ...draft, headline: normalizeHeadlineInput(event.target.value) })}
                rows={2}
                value={normalizeHeadlineInput(draft.headline)}
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
              <div className="resume-section-heading-row">
                <h3>{draft.experienceSections.length > 0 ? "Professional Experience" : "Selected Experience"}</h3>
                <button
                  className="resume-inline-action"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      experienceSections: [
                        ...draft.experienceSections,
                        {
                          bullets: [""],
                          company: "",
                          dates: "",
                          location: "",
                          roleTitle: "New role",
                        },
                      ],
                    })
                  }
                  type="button"
                >
                  <Plus size={14} aria-hidden="true" />
                  Add role
                </button>
              </div>
              {draft.experienceSections.length > 0 ? (
                <div className="resume-experience-section-list">
                  {draft.experienceSections.map((section, index) => (
                    <article className="resume-experience-section" key={`${section.roleTitle}-${index}`}>
                      <div className="resume-role-card-header">
                        <label className="resume-role-title-field">
                          <span className="sr-only">Role</span>
                          <textarea
                            aria-label={`Role title for experience ${index + 1}`}
                            onChange={(event) =>
                              updateExperienceSection(draft, setDraft, index, {
                                roleTitle: event.target.value,
                              })
                            }
                            placeholder="Role title"
                            rows={Math.max(1, Math.ceil(section.roleTitle.length / 54))}
                            value={section.roleTitle}
                          />
                        </label>
                        <label className="resume-role-company-field">
                          <span className="sr-only">Company</span>
                          <input
                            aria-label={`Company for ${section.roleTitle}`}
                            onChange={(event) =>
                              updateExperienceSection(draft, setDraft, index, {
                                company: event.target.value,
                              })
                            }
                            placeholder="Company"
                            value={section.company ?? ""}
                          />
                        </label>
                      </div>
                      <div className="resume-role-meta-row">
                        <label>
                          <span className="sr-only">Dates</span>
                          <input
                            aria-label={`Dates for ${section.roleTitle}`}
                            onChange={(event) =>
                              updateExperienceSection(draft, setDraft, index, {
                                dates: event.target.value,
                              })
                            }
                            placeholder="Jan 2021 - Present"
                            value={section.dates ?? ""}
                          />
                        </label>
                        <label>
                          <span className="sr-only">Location</span>
                          <input
                            aria-label={`Location for ${section.roleTitle}`}
                            onChange={(event) =>
                              updateExperienceSection(draft, setDraft, index, {
                                location: event.target.value,
                              })
                            }
                            placeholder="Location"
                            value={section.location ?? ""}
                          />
                        </label>
                      </div>
                      <div className="resume-bullet-editor">
                        {section.bullets.map((bullet, bulletIndex) => (
                          <div className="resume-bullet-row" key={`${section.roleTitle}-${bulletIndex}`}>
                            <span aria-hidden="true">•</span>
                            <textarea
                              aria-label={`Bullet ${bulletIndex + 1} for ${section.roleTitle}`}
                              onChange={(event) =>
                                updateExperienceBullet(draft, setDraft, index, bulletIndex, event.target.value)
                              }
                              rows={Math.max(1, Math.ceil(bullet.length / 88))}
                              value={bullet}
                            />
                            <button
                              aria-label={`Remove bullet ${bulletIndex + 1}`}
                              className="icon-only-action"
                              onClick={() => removeExperienceBullet(draft, setDraft, index, bulletIndex)}
                              type="button"
                            >
                              <Trash2 size={14} aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="resume-role-actions">
                        <button
                          className="resume-inline-action"
                          onClick={() => addExperienceBullet(draft, setDraft, index)}
                          type="button"
                        >
                          <Plus size={14} aria-hidden="true" />
                          Add bullet
                        </button>
                        <button
                          className="resume-inline-action danger"
                          onClick={() => removeExperienceSection(draft, setDraft, index)}
                          type="button"
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          Remove role
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="resume-bullet-editor">
                  {draft.experienceBullets.map((bullet, index) => (
                    <div className="resume-bullet-row" key={`${bullet}-${index}`}>
                      <span aria-hidden="true">•</span>
                      <textarea
                        aria-label={`Selected experience bullet ${index + 1}`}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            experienceBullets: draft.experienceBullets.map((item, itemIndex) =>
                              itemIndex === index ? event.target.value : item,
                            ),
                          })
                        }
                        rows={Math.max(1, Math.ceil(bullet.length / 88))}
                        value={bullet}
                      />
                      <button
                        aria-label={`Remove selected experience bullet ${index + 1}`}
                        className="icon-only-action"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            experienceBullets: draft.experienceBullets.filter((_, itemIndex) => itemIndex !== index),
                          })
                        }
                        type="button"
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  <button
                    className="resume-inline-action"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        experienceBullets: [...draft.experienceBullets, ""],
                      })
                    }
                    type="button"
                  >
                    <Plus size={14} aria-hidden="true" />
                    Add bullet
                  </button>
                </div>
              )}
            </section>
          </div>

          <ResumeReviewSection reviewItems={reviewItems} />

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
        <>
          <ResumeReviewSection reviewItems={reviewItems} />
          <section className="resume-empty-panel" aria-label="No master resume yet">
            <FileText size={22} aria-hidden="true" />
            <div>
              <h2>No master resume yet</h2>
              <p>
                Add career context first, then generate a draft here. Pramania will keep
                unsupported claims out and call out evidence gaps before you tailor for jobs.
              </p>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function ResumeReviewSection({
  reviewItems,
}: {
  reviewItems: {
    hiddenCount: number;
    visible: Array<{
      severity: "critical" | "important" | "informational";
      text: string;
    }>;
  };
}) {
  if (reviewItems.visible.length === 0) {
    return null;
  }

  return (
    <section className="resume-gap-panel priority-review-panel" aria-label="Master resume review priorities">
      <div className="section-heading">
        <p className="eyebrow">Review next</p>
        <h2>Resume refinement prompts</h2>
      </div>
      <div className="resume-review-grid">
        {reviewItems.visible.map((item) => (
          <ReviewItem
            key={`${item.severity}-${item.text}`}
            severity={item.severity}
            text={item.text}
          />
        ))}
      </div>
      {reviewItems.hiddenCount > 0 ? (
        <p className="resume-review-note">
          {reviewItems.hiddenCount} more refinement prompt{reviewItems.hiddenCount === 1 ? "" : "s"} are
          preserved in the advanced editor so the resume itself stays easy to work on.
        </p>
      ) : null}
    </section>
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

function normalizeHeadlineInput(headline: string) {
  const normalized = headline.replace(/\s*\|\s*/g, " / ").replace(/\s+/g, " ").trim();
  const segments = normalized.split(/\s+\/\s+/).filter(Boolean);

  if (segments.length <= 2) {
    return normalized;
  }

  return segments.slice(0, 2).join(" / ");
}

function autoGrowTextArea(field: HTMLTextAreaElement) {
  field.style.height = "auto";
  field.style.height = `${field.scrollHeight}px`;
}

function updateExperienceSection(
  draft: ResumeContent,
  setDraft: (draft: ResumeContent) => void,
  index: number,
  patch: Partial<ResumeContent["experienceSections"][number]>,
) {
  setDraft({
    ...draft,
    experienceSections: draft.experienceSections.map((section, sectionIndex) =>
      sectionIndex === index ? { ...section, ...patch } : section,
    ),
  });
}

function updateExperienceBullet(
  draft: ResumeContent,
  setDraft: (draft: ResumeContent) => void,
  sectionIndex: number,
  bulletIndex: number,
  value: string,
) {
  setDraft({
    ...draft,
    experienceSections: draft.experienceSections.map((section, index) =>
      index === sectionIndex
        ? {
            ...section,
            bullets: section.bullets.map((bullet, currentBulletIndex) =>
              currentBulletIndex === bulletIndex ? value : bullet,
            ),
          }
        : section,
    ),
  });
}

function addExperienceBullet(
  draft: ResumeContent,
  setDraft: (draft: ResumeContent) => void,
  sectionIndex: number,
) {
  setDraft({
    ...draft,
    experienceSections: draft.experienceSections.map((section, index) =>
      index === sectionIndex
        ? {
            ...section,
            bullets: [...section.bullets, ""],
          }
        : section,
    ),
  });
}

function removeExperienceBullet(
  draft: ResumeContent,
  setDraft: (draft: ResumeContent) => void,
  sectionIndex: number,
  bulletIndex: number,
) {
  setDraft({
    ...draft,
    experienceSections: draft.experienceSections.map((section, index) =>
      index === sectionIndex
        ? {
            ...section,
            bullets: section.bullets.filter((_, currentBulletIndex) => currentBulletIndex !== bulletIndex),
          }
        : section,
    ),
  });
}

function removeExperienceSection(
  draft: ResumeContent,
  setDraft: (draft: ResumeContent) => void,
  sectionIndex: number,
) {
  setDraft({
    ...draft,
    experienceSections: draft.experienceSections.filter((_, index) => index !== sectionIndex),
  });
}
