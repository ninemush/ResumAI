"use client";

import { CheckCircle2, FileText, RefreshCw, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { brand } from "@/lib/brand";
import type { ProfileOverview } from "@/lib/profile/profile-overview";

type KnowledgebasePanelProps = {
  overview: ProfileOverview;
};

export function KnowledgebasePanel({ overview }: KnowledgebasePanelProps) {
  const router = useRouter();
  const hasFacts = overview.factCount > 0;
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [factDrafts, setFactDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.values(overview.factsByType)
        .flat()
        .map((fact) => [fact.id, fact.fact_value]),
    ),
  );

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

      setMessage("Saved that profile detail.");
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

      setMessage("Removed that profile detail.");
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  return (
    <main className="profile-pane" aria-labelledby="knowledgebase-title">
      <div className="pane-heading">
        <p className="eyebrow">Knowledgebase</p>
        <h1 id="knowledgebase-title">Sources and profile evidence</h1>
        <p>
          This is the audit-friendly wiki of what you gave {brand.name}, what was read,
          and the profile evidence that came from it.
        </p>
      </div>

      {message ? <p className="system-note success">{message}</p> : null}

      <section className="sources-panel" aria-label="Profile sources">
        <div className="section-heading">
          <p className="eyebrow">Sources used</p>
          <h2>Input stream</h2>
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
                  <p>{formatSourceGuidance(source)}</p>
                  {source.source_type === "linkedin" && source.extraction_status === "failed" ? (
                    <div className="source-fallback" aria-label="LinkedIn import options">
                      <FileText size={15} aria-hidden="true" />
                      <div>
                        <strong>Reliable LinkedIn import</strong>
                        <p>
                          Drag a LinkedIn PDF export, screenshots, or paste the About,
                          Experience, Education, Skills, and Certifications sections into
                          Pramania. Those become reviewable LinkedIn-sourced evidence.
                        </p>
                      </div>
                    </div>
                  ) : null}
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
        ) : (
          <p className="empty-state">
            Drop a resume, LinkedIn export, screenshot, portfolio link, or career note
            into Pramania. The source record will appear here.
          </p>
        )}
      </section>

      <section className="facts-panel" aria-label="Captured profile evidence">
        <div className="section-heading">
          <p className="eyebrow">Profile evidence</p>
          <h2>Curated details</h2>
        </div>
        {hasFacts ? (
          <>
            <p className="evidence-note">
              You do not need to confirm every detail you personally provided. Edit or
              remove anything that is wrong; confirm only the details Pramania inferred
              or that you want treated as high-trust evidence for resume generation.
            </p>
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
                              Trusted
                            </span>
                          ) : (
                            <button
                              className="fact-confirm-button"
                              disabled={pendingId === fact.id}
                              onClick={() => confirmFact(fact.id)}
                              type="button"
                            >
                              {pendingId === fact.id ? "Saving..." : "Trust this"}
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
                            <Save size={14} aria-hidden="true" />
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
          </>
        ) : (
          <p className="empty-state">
            Profile evidence will appear here after Pramania reads a source or career note.
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
  if (sourceType === "image") return "Screenshot or image";
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
    IMAGE_OCR_FAILED: "Image OCR is unavailable right now. The image is saved.",
    IMAGE_OCR_FILE_TOO_LARGE: "Image exceeds the current OCR size limit.",
    IMAGE_OCR_TEXT_EMPTY: "No readable text found in the image.",
    IMAGE_OCR_UNSUPPORTED_MIME_TYPE: "OCR supports JPG, PNG, and WebP images.",
    LINKEDIN_PUBLIC_PROFILE_BLOCKED:
      "LinkedIn did not return readable public content to Pramania.",
    PDF_FILE_TOO_LARGE: "PDF exceeds the current parser size limit.",
    PDF_PAGE_LIMIT_EXCEEDED: "Too many pages for the current parser limit.",
    PDF_TEXT_EMPTY: "No selectable text found. OCR will be needed.",
    PROFILE_LINK_TEXT_TOO_SHORT: "Not enough readable profile text found.",
    TEXT_FILE_TOO_LARGE: "Text file exceeds the current parser size limit.",
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
    return "Public URL attempted. If LinkedIn blocks server reading, use the reliable import path below.";
  }

  if (source.source_type === "image" && source.extraction_status === "failed") {
    return "Saved as an image source. Retry OCR, or paste the key text into Pramania.";
  }

  if (source.extraction_status === "failed") {
    return "Saved, but extraction failed. Retry or provide the content another way.";
  }

  return "Saved as profile source.";
}
