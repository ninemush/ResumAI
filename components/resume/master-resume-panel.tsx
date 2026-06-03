"use client";

import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Download,
  Edit3,
  ExternalLink,
  FileText,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  looksLikeEmploymentTypeLabel,
  normalizeResumeContent,
  type ResumeContent,
} from "@/lib/resumes/resume-content";
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
  const [variantFocus, setVariantFocus] = useState("");
  const [isGeneratingVariant, setIsGeneratingVariant] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
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
        setMessage(payload.error?.message ?? "Unable to create the master resume.");
        return;
      }

      setCurrentOverview(payload.overview);
      setDraft(payload.overview.latestResume?.content ?? null);
      setSavedDraft(payload.overview.latestResume?.content ?? null);
      setMessage(payload.summary ?? "Created a master resume draft.");
      router.refresh();
    } finally {
      setIsGenerating(false);
    }
  }

  async function generateFocusedVariant() {
    const focus = variantFocus.trim();

    if (!focus) {
      setMessage("Add a target role, role family, or positioning lane before creating a focused variant.");
      return;
    }

    if (isDirty && !window.confirm("Creating a focused variant will replace unsaved resume edits. Continue?")) {
      return;
    }

    setIsGeneratingVariant(true);
    setMessage(null);

    try {
      const response = await fetch("/api/resume/master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: `Create a focused master resume variant for ${focus}. Keep the standard ATS chronology, preserve verified facts, retain contact details and role-by-role work history, and only adjust positioning, selected highlights, skill emphasis, and summary language for this target.`,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to create that focused variant.");
        return;
      }

      setCurrentOverview(payload.overview);
      setDraft(payload.overview.latestResume?.content ?? null);
      setSavedDraft(payload.overview.latestResume?.content ?? null);
      setMessage(`Created a focused master resume variant for ${focus}. Review it before downloading files.`);
      router.refresh();
    } finally {
      setIsGeneratingVariant(false);
    }
  }

  async function saveResume() {
    if (!draft) {
      return;
    }

    let normalizedDraft: ResumeContent;
    try {
      normalizedDraft = normalizeResumeContent(sanitizeResumeDraft(draft));
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
      setIsEditing(false);
      setMessage("Saved master resume edits.");
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  async function exportResumeFiles() {
    if (isDirty) {
      setMessage("Save or discard your resume edits before preparing PDF and DOCX files.");
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
      setMessage("Your master resume PDF and DOCX are ready to download.");
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

      {message ? <p className="system-note success">{message}</p> : null}

      {draft ? (
        <section className="materials-review master-resume-editor resume-studio-surface" aria-label="Master resume editor">
          <div className="materials-review-header resume-document-toolbar">
            <div>
              <p className="eyebrow">{isEditing ? "Editing" : "Resume preview"}</p>
              <h2>{isEditing ? "Resume editor" : "Review-ready resume"}</h2>
            </div>
            <div className="resume-preview-toolbar">
              <span className="resume-status-pill">
                <CheckCircle2 size={15} aria-hidden="true" />
                {formatResumeStatus(currentOverview.latestResume?.status ?? "draft")}
              </span>
              {isEditing ? (
                <button
                  className="secondary-action compact-action"
                  disabled={isSaving}
                  onClick={saveResume}
                  type="button"
                >
                  <Save size={14} aria-hidden="true" />
                  {isSaving ? "Saving..." : "Save edits"}
                </button>
              ) : (
                <button
                  className="secondary-action compact-action"
                  onClick={() => setIsEditing(true)}
                  type="button"
                >
                  <Edit3 size={14} aria-hidden="true" />
                  Edit resume
                </button>
              )}
            </div>
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
            className={`resume-document-preview ${isEditing ? "edit-mode" : "preview-mode"}`}
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
              {isEditing ? (
                <textarea
                  aria-label="Resume headline"
                  className="resume-headline-field"
                  onChange={(event) => setDraft({ ...draft, headline: normalizeHeadlineInput(event.target.value) })}
                  rows={2}
                  value={normalizeHeadlineInput(draft.headline)}
                />
              ) : (
                <p className="resume-headline-static">{normalizeHeadlineInput(draft.headline)}</p>
              )}
              {isEditing ? (
                <div className="resume-contact-grid" aria-label="Resume contact details">
                  <input
                    aria-label="Email"
                    onChange={(event) => updateResumeContact(draft, setDraft, "email", event.target.value)}
                    placeholder="Email"
                    value={draft.contact.email ?? ""}
                  />
                  <input
                    aria-label="Phone"
                    onChange={(event) => updateResumeContact(draft, setDraft, "phone", event.target.value)}
                    placeholder="Phone"
                    value={draft.contact.phone ?? ""}
                  />
                  <input
                    aria-label="LinkedIn profile"
                    onChange={(event) => updateResumeContact(draft, setDraft, "linkedin", event.target.value)}
                    placeholder="LinkedIn"
                    value={draft.contact.linkedin ?? ""}
                  />
                  <input
                    aria-label="Location"
                    onChange={(event) => updateResumeContact(draft, setDraft, "location", event.target.value)}
                    placeholder="Location"
                    value={draft.contact.location ?? ""}
                  />
                </div>
              ) : (
                <div className="resume-contact-line" aria-label="Resume contact details">
                  {draft.contact.email ? <span>{draft.contact.email}</span> : null}
                  {draft.contact.phone ? <span>{draft.contact.phone}</span> : null}
                  {draft.contact.linkedin ? (
                    <a href={normalizeLinkUrl(draft.contact.linkedin)} rel="noreferrer" target="_blank">
                      {draft.contact.linkedin}
                    </a>
                  ) : null}
                  {draft.contact.location ? <span>{draft.contact.location}</span> : null}
                </div>
              )}
            </header>
            <section>
              <h3>Professional Summary</h3>
              {isEditing ? (
                <textarea
                  aria-label="Resume summary"
                  onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
                  rows={Math.max(4, Math.ceil(draft.summary.length / 110))}
                  value={draft.summary}
                />
              ) : (
                <p className="resume-static-paragraph">{draft.summary}</p>
              )}
            </section>
            <section>
              <h3>Core Skills</h3>
              {isEditing ? (
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
              ) : (
                <p className="resume-static-paragraph">{draft.skills.join(", ")}</p>
              )}
            </section>
            <section className="resume-highlight-section">
              <div className="resume-section-heading-row">
                <h3>Selected Highlights</h3>
              </div>
              {isEditing ? (
                <div className="resume-bullet-editor">
                  {draft.experienceBullets.map((bullet, index) => (
                    <div className="resume-bullet-row" key={`${bullet}-${index}`}>
                      <span aria-hidden="true">•</span>
                      <textarea
                        aria-label={`Selected highlight ${index + 1}`}
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
                        aria-label={`Remove selected highlight ${index + 1}`}
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
                    Add highlight
                  </button>
                </div>
              ) : (
                <ul className="resume-static-bullet-list">
                  {draft.experienceBullets.map((bullet, index) => (
                    <li key={`${bullet}-static-${index}`}>{bullet}</li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <div className="resume-section-heading-row">
                <h3>Professional Experience</h3>
                {isEditing ? (
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
                ) : null}
              </div>
              {draft.experienceSections.length > 0 ? (
                <div className="resume-experience-section-list">
                  {draft.experienceSections.map((section, index) => {
                    const displayCompany = readDisplayCompany(section.company);
                    const companyBrand = readCompanyBrand(displayCompany);

                    return (
                      <article className="resume-experience-section" key={`${section.roleTitle}-${index}`}>
                        {isEditing ? (
                          <>
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
                              <div className="resume-role-company-field">
                                {companyBrand ? (
                                  <a
                                    aria-label={`Open ${companyBrand.label} website`}
                                    className="resume-company-link"
                                    href={companyBrand.url}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    <span
                                      aria-hidden="true"
                                      className="resume-company-logo"
                                      style={{ backgroundImage: `url(${companyBrand.logoUrl})` }}
                                    />
                                    <ExternalLink size={13} aria-hidden="true" />
                                  </a>
                                ) : (
                                  <span className="resume-company-placeholder" aria-hidden="true">
                                    <Building2 size={15} />
                                  </span>
                                )}
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
                              </div>
                            </div>
                            <div className="resume-role-meta-row">
                              <label>
                                <span className="sr-only">Dates</span>
                                <textarea
                                  aria-label={`Dates for ${section.roleTitle}`}
                                  onChange={(event) =>
                                    updateExperienceSection(draft, setDraft, index, {
                                      dates: event.target.value,
                                    })
                                  }
                                  placeholder="Jan 2021 - Present"
                                  rows={Math.max(1, Math.ceil((section.dates ?? "").length / 42))}
                                  value={section.dates ?? ""}
                                />
                              </label>
                              <label>
                                <span className="sr-only">Location</span>
                                <textarea
                                  aria-label={`Location for ${section.roleTitle}`}
                                  onChange={(event) =>
                                    updateExperienceSection(draft, setDraft, index, {
                                      location: event.target.value,
                                    })
                                  }
                                  placeholder="Location"
                                  rows={Math.max(1, Math.ceil((section.location ?? "").length / 42))}
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
                          </>
                        ) : (
                          <>
                            <div className="resume-role-static-header">
                              <div>
                                <h4>{section.roleTitle}</h4>
                                <p>
                                  {[section.dates, section.location].filter(Boolean).join(" · ")}
                                </p>
                              </div>
                              {displayCompany ? (
                                companyBrand ? (
                                  <a className="resume-company-static-link" href={companyBrand.url} rel="noreferrer" target="_blank">
                                    <span
                                      aria-hidden="true"
                                      className="resume-company-logo"
                                      style={{ backgroundImage: `url(${companyBrand.logoUrl})` }}
                                    />
                                    {displayCompany}
                                  </a>
                                ) : (
                                  <strong>{displayCompany}</strong>
                                )
                              ) : null}
                            </div>
                            <ul className="resume-static-bullet-list">
                              {section.bullets.map((bullet, bulletIndex) => (
                                <li key={`${section.roleTitle}-static-${bulletIndex}`}>{bullet}</li>
                              ))}
                            </ul>
                          </>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="resume-empty-note">
                  No role-by-role work history yet. Drop a resume, LinkedIn PDF, or work history note into Pramania,
                  then regenerate this master resume.
                </p>
              )}
            </section>
            {(isEditing || draft.education.length > 0) ? (
              <section>
                <div className="resume-section-heading-row">
                  <h3>Education</h3>
                  {isEditing ? (
                    <button
                      className="resume-inline-action"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          education: [
                            ...draft.education,
                            {
                              credential: "",
                              dates: "",
                              institution: "",
                              location: "",
                            },
                          ],
                        })
                      }
                      type="button"
                    >
                      <Plus size={14} aria-hidden="true" />
                      Add education
                    </button>
                  ) : null}
                </div>
                {isEditing ? (
                  <div className="resume-credential-list">
                    {draft.education.map((item, index) => (
                      <div className="resume-credential-row" key={`education-${index}`}>
                        <div className="resume-credential-grid">
                          <label>
                            <span>Institution</span>
                            <input
                              aria-label={`Education institution ${index + 1}`}
                              onChange={(event) => updateEducationItem(draft, setDraft, index, { institution: event.target.value })}
                              placeholder="Institution"
                              value={item.institution}
                            />
                          </label>
                          <label>
                            <span>Credential</span>
                            <input
                              aria-label={`Education credential ${index + 1}`}
                              onChange={(event) => updateEducationItem(draft, setDraft, index, { credential: event.target.value })}
                              placeholder="Degree, diploma, or program"
                              value={item.credential ?? ""}
                            />
                          </label>
                          <label>
                            <span>Dates</span>
                            <input
                              aria-label={`Education dates ${index + 1}`}
                              onChange={(event) => updateEducationItem(draft, setDraft, index, { dates: event.target.value })}
                              placeholder="Dates"
                              value={item.dates ?? ""}
                            />
                          </label>
                          <label>
                            <span>Location</span>
                            <input
                              aria-label={`Education location ${index + 1}`}
                              onChange={(event) => updateEducationItem(draft, setDraft, index, { location: event.target.value })}
                              placeholder="Location"
                              value={item.location ?? ""}
                            />
                          </label>
                          <button
                            aria-label={`Remove education item ${index + 1}`}
                            className="icon-only-action"
                            onClick={() => removeEducationItem(draft, setDraft, index)}
                            type="button"
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="resume-credential-list">
                    {draft.education.map((item, index) => (
                      <div className="resume-credential-static" key={`${item.institution}-${index}`}>
                        <strong>{item.institution}</strong>
                        <span>
                          {[item.credential, item.dates, item.location].filter(Boolean).join(" · ")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ) : null}
            {(isEditing || draft.certifications.length > 0) ? (
              <section>
                <div className="resume-section-heading-row">
                  <h3>Certifications</h3>
                  {isEditing ? (
                    <button
                      className="resume-inline-action"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          certifications: [
                            ...draft.certifications,
                            {
                              date: "",
                              issuer: "",
                              name: "",
                            },
                          ],
                        })
                      }
                      type="button"
                    >
                      <Plus size={14} aria-hidden="true" />
                      Add certification
                    </button>
                  ) : null}
                </div>
                {isEditing ? (
                  <div className="resume-credential-list">
                    {draft.certifications.map((item, index) => (
                      <div className="resume-credential-row" key={`certification-${index}`}>
                        <div className="resume-credential-grid">
                          <label>
                            <span>Certification</span>
                            <input
                              aria-label={`Certification name ${index + 1}`}
                              onChange={(event) => updateCertificationItem(draft, setDraft, index, { name: event.target.value })}
                              placeholder="Certification"
                              value={item.name}
                            />
                          </label>
                          <label>
                            <span>Issuer</span>
                            <input
                              aria-label={`Certification issuer ${index + 1}`}
                              onChange={(event) => updateCertificationItem(draft, setDraft, index, { issuer: event.target.value })}
                              placeholder="Issuer"
                              value={item.issuer ?? ""}
                            />
                          </label>
                          <label>
                            <span>Date</span>
                            <input
                              aria-label={`Certification date ${index + 1}`}
                              onChange={(event) => updateCertificationItem(draft, setDraft, index, { date: event.target.value })}
                              placeholder="Date"
                              value={item.date ?? ""}
                            />
                          </label>
                          <button
                            aria-label={`Remove certification ${index + 1}`}
                            className="icon-only-action"
                            onClick={() => removeCertificationItem(draft, setDraft, index)}
                            type="button"
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="resume-credential-list">
                    {draft.certifications.map((item, index) => (
                      <div className="resume-credential-static" key={`${item.name}-${index}`}>
                        <strong>{item.name}</strong>
                        <span>{[item.issuer, item.date].filter(Boolean).join(" · ")}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ) : null}
          </div>

          <ResumeReviewSection reviewItems={reviewItems} />

          {isEditing ? (
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
          ) : null}
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

      <section className="resume-readiness-panel" aria-label="Master resume readiness">
        <div>
          <span>{currentOverview.canGenerate ? "Ready" : "Needs work"}</span>
          <strong>Improve or download</strong>
          <p>{currentOverview.readinessNote}</p>
        </div>
        <div className="resume-readiness-actions">
          <button
            className="secondary-action"
            disabled={!currentOverview.canGenerate || isGenerating}
            onClick={generateResume}
            title={
              currentOverview.canGenerate
                ? "Create a master resume from career evidence"
                : "Add career evidence before creating a resume"
            }
            type="button"
          >
            <WandSparkles size={15} aria-hidden="true" />
            {isGenerating
              ? "Creating..."
              : currentOverview.latestResume
                ? "Rebuild resume"
                : "Create resume"}
          </button>
          <button
            className="secondary-action"
            disabled={!draft || isSaving}
            onClick={saveResume}
            title="Save edits to the current master resume"
            type="button"
          >
            <Save size={15} aria-hidden="true" />
            {isSaving ? "Saving..." : "Save resume"}
          </button>
          <button
            className="secondary-action"
            disabled={!draft || isExporting}
            onClick={exportResumeFiles}
            title="Create downloadable ATS-friendly PDF and DOCX files from the standard template"
            type="button"
          >
            <Download size={15} aria-hidden="true" />
            {isExporting ? "Preparing..." : "Download PDF + DOCX"}
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

      <section className="resume-export-panel" aria-label="Resume export readiness">
        <article>
          <span>Format</span>
          <strong>Standard ATS layout</strong>
          <p>Pramania keeps the structure consistent and changes the content for your goals.</p>
        </article>
        <article>
          <span>PDF</span>
          <strong>{currentOverview.latestResume?.pdfDownloadUrl ? "Ready to download" : "Prepare files"}</strong>
          <p>{currentOverview.latestResume?.pdfDownloadUrl ? "PDF file is stored for this resume." : "Prepare the PDF after review."}</p>
        </article>
        <article>
          <span>DOCX</span>
          <strong>{currentOverview.latestResume?.docxDownloadUrl ? "Ready" : "Prepare files"}</strong>
          <p>{currentOverview.latestResume?.docxDownloadUrl ? "Editable Word file is stored for this resume." : "Prepare the DOCX after review."}</p>
        </article>
        <article>
          <span>Profile photo</span>
          <strong>Separate design</strong>
          <p>ATS-first exports stay photo-free. Profile-photo formats will use a separate template.</p>
        </article>
      </section>

      <section className="resume-variant-panel" aria-label="Focused resume variants">
        <div>
          <p className="eyebrow">Focused variant</p>
          <h2>Shape the resume for a target lane</h2>
          <p>
            Use this for a role family such as “VP GTM Operations” or “CIO /
            Digital Transformation.” It keeps the same ATS template and verified
            chronology, then shifts emphasis without overwriting your source record.
          </p>
        </div>
        <div className="resume-variant-actions">
          <input
            aria-label="Focused resume target"
            onChange={(event) => setVariantFocus(event.target.value)}
            placeholder="Target role or lane"
            value={variantFocus}
          />
          <button
            className="secondary-action"
            disabled={!currentOverview.canGenerate || isGeneratingVariant}
            onClick={generateFocusedVariant}
            type="button"
          >
            <WandSparkles size={15} aria-hidden="true" />
            {isGeneratingVariant ? "Creating..." : "Create focused variant"}
          </button>
        </div>
      </section>
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

function formatResumeStatus(status: string) {
  const labels: Record<string, string> = {
    draft: "Ready for review",
    exported: "Exported",
    failed: "Needs review",
    ready: "Ready",
  };

  return labels[status] ?? "Ready for review";
}

function normalizeHeadlineInput(headline: string) {
  const normalized = headline.replace(/\s*\|\s*/g, " / ").replace(/\s+/g, " ").trim();
  const segments = normalized.split(/\s+\/\s+/).filter(Boolean);

  if (segments.length <= 2) {
    return normalized;
  }

  return segments.slice(0, 2).join(" / ");
}

function normalizeLinkUrl(value: string) {
  const trimmed = value.trim();

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function readCompanyBrand(company: string | null) {
  const normalized = company?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  if (!normalized) {
    return null;
  }

  const brandMap: Array<{ domain: string; label: string; patterns: string[] }> = [
    { domain: "uipath.com", label: "UiPath", patterns: ["uipath"] },
    { domain: "ge.com", label: "GE", patterns: ["ge", "general electric", "ge capital"] },
    { domain: "linkedin.com", label: "LinkedIn", patterns: ["linkedin"] },
    { domain: "microsoft.com", label: "Microsoft", patterns: ["microsoft"] },
    { domain: "oracle.com", label: "Oracle", patterns: ["oracle"] },
    { domain: "salesforce.com", label: "Salesforce", patterns: ["salesforce"] },
    { domain: "servicenow.com", label: "ServiceNow", patterns: ["servicenow", "service now"] },
    { domain: "sap.com", label: "SAP", patterns: ["sap"] },
    { domain: "accenture.com", label: "Accenture", patterns: ["accenture"] },
    { domain: "deloitte.com", label: "Deloitte", patterns: ["deloitte"] },
    { domain: "pwc.com", label: "PwC", patterns: ["pwc", "pricewaterhousecoopers"] },
    { domain: "ey.com", label: "EY", patterns: ["ey", "ernst young"] },
  ];
  const match = brandMap.find((item) =>
    item.patterns.some((pattern) => normalized === pattern || new RegExp(`(^| )${escapeRegExp(pattern)}( |$)`).test(normalized)),
  );

  if (!match) {
    return null;
  }

  return {
    label: match.label,
    logoUrl: `https://logo.clearbit.com/${match.domain}`,
    url: `https://${match.domain}`,
  };
}

function readDisplayCompany(company: string | null) {
  if (!company || looksLikeEmploymentTypeLabel(company)) {
    return null;
  }

  return company;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function updateResumeContact(
  draft: ResumeContent,
  setDraft: (draft: ResumeContent) => void,
  field: keyof ResumeContent["contact"],
  value: string,
) {
  setDraft({
    ...draft,
    contact: {
      ...draft.contact,
      [field]: value,
    },
  });
}

function autoGrowTextArea(field: HTMLTextAreaElement) {
  field.style.height = "auto";
  field.style.height = `${field.scrollHeight}px`;
}

function sanitizeResumeDraft(draft: ResumeContent): ResumeContent {
  return {
    ...draft,
    certifications: draft.certifications.filter((item) => item.name.trim()),
    education: draft.education.filter((item) => item.institution.trim() || item.credential?.trim()),
    experienceBullets: draft.experienceBullets.filter((bullet) => bullet.trim()),
    experienceSections: draft.experienceSections
      .map((section) => ({
        ...section,
        bullets: section.bullets.filter((bullet) => bullet.trim()),
      }))
      .filter((section) => section.roleTitle.trim() || section.company?.trim() || section.bullets.length > 0),
  };
}

function updateEducationItem(
  draft: ResumeContent,
  setDraft: (draft: ResumeContent) => void,
  index: number,
  patch: Partial<ResumeContent["education"][number]>,
) {
  setDraft({
    ...draft,
    education: draft.education.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : item,
    ),
  });
}

function removeEducationItem(
  draft: ResumeContent,
  setDraft: (draft: ResumeContent) => void,
  index: number,
) {
  setDraft({
    ...draft,
    education: draft.education.filter((_, itemIndex) => itemIndex !== index),
  });
}

function updateCertificationItem(
  draft: ResumeContent,
  setDraft: (draft: ResumeContent) => void,
  index: number,
  patch: Partial<ResumeContent["certifications"][number]>,
) {
  setDraft({
    ...draft,
    certifications: draft.certifications.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : item,
    ),
  });
}

function removeCertificationItem(
  draft: ResumeContent,
  setDraft: (draft: ResumeContent) => void,
  index: number,
) {
  setDraft({
    ...draft,
    certifications: draft.certifications.filter((_, itemIndex) => itemIndex !== index),
  });
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
