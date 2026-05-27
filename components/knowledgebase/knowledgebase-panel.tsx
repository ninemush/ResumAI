"use client";

import { CheckCircle2, FileText, RefreshCw, Save, Trash2 } from "lucide-react";
import Image from "next/image";
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
                <div className="source-main">
                  {source.previewUrl ? (
                    <Image
                      alt={source.original_filename ?? "Uploaded screenshot source"}
                      className="source-preview-image"
                      height={120}
                      src={source.previewUrl}
                      unoptimized
                      width={180}
                    />
                  ) : null}
                  <div>
                    <h3>{source.original_filename ?? formatSourceUrl(source.source_url)}</h3>
                    <p>{formatSourceType(source.source_type)}</p>
                    {source.failure_reason ? (
                      <p className="source-failure">{formatFailureReason(source.failure_reason)}</p>
                    ) : null}
                    <p>{formatSourceGuidance(source)}</p>
                    {source.source_type === "image" && source.extraction_status === "failed" ? (
                      <div className="source-fallback" aria-label="Image OCR import options">
                        <FileText size={15} aria-hidden="true" />
                        <div>
                          <strong>What this means</strong>
                          <p>
                            The screenshot is saved. OCR now retries automatically before
                            marking it failed. Use Retry for a fresh attempt, or paste the
                            visible text into Pramania if the screenshot itself is hard to read.
                          </p>
                        </div>
                      </div>
                    ) : null}
                    {source.source_type === "linkedin" && source.extraction_status === "failed" ? (
                      <div className="source-fallback" aria-label="LinkedIn import options">
                        <FileText size={15} aria-hidden="true" />
                        <div>
                          <strong>Reliable LinkedIn import</strong>
                          <p>
                            On desktop LinkedIn, open your profile, choose Resources or
                            More, select Save to PDF, then drag the PDF into Pramania.
                            For a fuller import, use Settings & Privacy {" -> "}Data privacy
                            {" -> "}Get a copy of your data and upload the archive files.
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </div>
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
    IMAGE_OCR_FAILED: "OCR request failed. The image is saved and can be retried.",
    IMAGE_OCR_FILE_TOO_LARGE: "Image exceeds the current OCR size limit.",
    IMAGE_OCR_INCOMPLETE_RESPONSE: "OCR returned an incomplete response after retrying.",
    IMAGE_OCR_PROVIDER_AUTH_FAILED: "OCR provider configuration needs attention.",
    IMAGE_OCR_PROVIDER_ERROR: "OCR provider returned an error after retrying.",
    IMAGE_OCR_PROVIDER_REJECTED_IMAGE: "OCR could not process this image content.",
    IMAGE_OCR_PROVIDER_TEMPORARY_FAILURE: "OCR provider was temporarily unavailable after retrying.",
    IMAGE_OCR_PROVIDER_UNAVAILABLE: "OCR provider could not be reached after retrying.",
    IMAGE_OCR_TEXT_EMPTY: "OCR retried but found no readable text in the image.",
    IMAGE_OCR_UNSUPPORTED_MIME_TYPE: "OCR supports JPG, PNG, and WebP images.",
    LINKEDIN_ARCHIVE_FILE_TOO_LARGE: "LinkedIn archive exceeds the current 25 MB parser limit.",
    LINKEDIN_ARCHIVE_INVALID_ZIP: "This does not look like a valid LinkedIn archive ZIP.",
    LINKEDIN_ARCHIVE_NO_PROFILE_FILES:
      "No LinkedIn profile CSV files found. Upload Profile.csv, Positions.csv, Skills.csv, or Education.csv.",
    LINKEDIN_ARCHIVE_TEXT_EMPTY: "No readable profile rows found in that LinkedIn export.",
    LINKEDIN_ARCHIVE_UNSUPPORTED_FILE: "LinkedIn archive import supports ZIP and CSV files.",
    LINKEDIN_PUBLIC_PROFILE_BLOCKED:
      "LinkedIn did not return readable public content to Pramania.",
    PDF_AI_EXTRACT_FAILED: "PDF vision extraction failed after retrying.",
    PDF_AI_INCOMPLETE_RESPONSE: "PDF vision extraction returned an incomplete response.",
    PDF_AI_PROVIDER_AUTH_FAILED: "PDF extraction provider configuration needs attention.",
    PDF_AI_PROVIDER_ERROR: "PDF vision extraction provider returned an error.",
    PDF_AI_PROVIDER_REJECTED_FILE: "PDF vision extraction could not process this file.",
    PDF_AI_PROVIDER_TEMPORARY_FAILURE: "PDF vision extraction was temporarily unavailable.",
    PDF_AI_PROVIDER_UNAVAILABLE: "PDF vision extraction could not be reached.",
    PDF_FILE_TOO_LARGE: "PDF exceeds the current parser size limit.",
    PDF_PAGE_LIMIT_EXCEEDED: "Too many pages for the current parser limit.",
    PDF_TEXT_EMPTY: "No readable career text found after parser and PDF vision extraction.",
    PDF_TEXT_EXTRACTION_FAILED: "The PDF parser could not read this file.",
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
    return "Public URL attempted. If LinkedIn blocks server reading, use the PDF or archive path below.";
  }

  if (source.source_type === "image" && source.extraction_status === "failed") {
    return "Saved as an image source. OCR retries are bounded; use Retry or paste the key text.";
  }

  if (source.extraction_status === "failed") {
    return "Saved, but extraction failed. Retry or provide the content another way.";
  }

  return "Saved as profile source.";
}
