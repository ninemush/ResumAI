"use client";

import { Download, FileText, RefreshCw } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { brand } from "@/lib/brand";
import type { ProfileOverview } from "@/lib/profile/profile-overview";

type KnowledgebasePanelProps = {
  overview: ProfileOverview;
};

const sourceFilters = [
  "All",
  "Read",
  "Needs attention",
  "Files",
  "Links",
  "Images",
] as const;

type SourceFilter = (typeof sourceFilters)[number];

export function KnowledgebasePanel({ overview }: KnowledgebasePanelProps) {
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<SourceFilter>("All");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<ProfileOverview["recentSources"][number] | null>(
    null,
  );
  const visibleSources = overview.recentSources.filter((source) =>
    sourceMatchesFilter(source, activeFilter),
  );
  const filterCounts = buildSourceFilterCounts(overview.recentSources);
  const sourceHealth = buildSourceHealth(overview.recentSources);

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
          ? "Source read. Pramania updated your profile foundation from it."
          : "Source read. I did not see anything new enough to change your profile this time.",
      );
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  return (
    <main className="profile-pane" aria-labelledby="knowledgebase-title">
      <div className="pane-heading">
        <p className="eyebrow">Sources</p>
        <h1 id="knowledgebase-title">Source library</h1>
        <p>
          A chronological record of resumes, LinkedIn exports, screenshots, links,
          and notes that shaped your profile and resume direction.
        </p>
      </div>

      {message ? <p className="system-note success">{message}</p> : null}

      <section className="sources-helper-panel" aria-label="How Pramania uses sources">
        <div>
          <strong>Your career record</strong>
          <p>
            Every resume, LinkedIn export, screenshot, note, and link you share
            in chat is kept here in order.
          </p>
        </div>
        <div>
          <strong>Why it matters</strong>
          <p>
            Pramania uses these sources to keep advice, resumes, and job-fit
            reviews grounded in what you actually shared.
          </p>
        </div>
      </section>

      <section className="source-health-grid" aria-label="Source health summary">
        <article className="source-health-card ready">
          <span>Readable</span>
          <strong>{sourceHealth.read}</strong>
          <p>Sources Pramania can use for profile, resume, and fit analysis.</p>
        </article>
        <article className={sourceHealth.needsAttention > 0 ? "source-health-card warning" : "source-health-card"}>
          <span>Needs Attention</span>
          <strong>{sourceHealth.needsAttention}</strong>
          <p>Items where extraction failed or needs a cleaner file/source.</p>
        </article>
        <article className="source-health-card">
          <span>Preserved Text</span>
          <strong>{formatCompactNumber(sourceHealth.readableCharacters)}</strong>
          <p>Readable characters retained so Pramania can avoid asking you to repeat yourself.</p>
        </article>
      </section>

      <section className="sources-panel" aria-label="Profile sources">
        <div className="section-heading">
          <p className="eyebrow">Sources used</p>
          <h2>Timeline</h2>
        </div>
        {overview.recentSources.length > 0 ? (
          <div className="record-filter-strip" aria-label="Source filters">
            {sourceFilters.map((filter) => (
              <button
                aria-pressed={activeFilter === filter}
                className={`record-filter-chip ${activeFilter === filter ? "active" : ""}`}
                key={filter}
                onClick={() => setActiveFilter(filter)}
                type="button"
              >
                <strong>{filterCounts[filter]}</strong>
                <span>{filter}</span>
              </button>
            ))}
          </div>
        ) : null}
        {overview.recentSources.length > 0 ? (
          <div className="source-list">
            {visibleSources.length === 0 ? (
              <p className="empty-state">No sources match this filter yet.</p>
            ) : null}
            {visibleSources.map((source) => (
              <article className="source-row" key={source.id}>
                <div className="source-main">
                  <SourcePreviewThumb source={source} onOpen={() => setActiveSource(source)} />
                  <div>
                    <h3>{source.original_filename ?? formatSourceUrl(source.source_url)}</h3>
                    <p>{formatSourceType(source.source_type)}</p>
                    <p className="source-timestamp">{formatSourceTimestamp(source.created_at)}</p>
                    <div className="source-capability-row" aria-label="Source capabilities">
                      {buildSourceCapabilities(source).map((capability) => (
                        <span className={capability.tone} key={capability.label}>
                          {capability.label}
                        </span>
                      ))}
                    </div>
                    {source.failure_reason ? (
                      <p className="source-failure">{formatFailureReason(source.failure_reason)}</p>
                    ) : null}
                    <p>{formatSourceGuidance(source)}</p>
                    {source.extractedTextPreview ? (
                      <details className="source-excerpt">
                        <summary>
                          Read excerpt
                          <span>{source.readableCharacterCount.toLocaleString()} characters</span>
                        </summary>
                        <p>{source.extractedTextPreview}</p>
                      </details>
                    ) : null}
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
                  {source.downloadUrl ? (
                    <a
                      className="secondary-action compact-action"
                      download={source.original_filename ?? true}
                      href={source.downloadUrl}
                      rel="noreferrer"
                      target="_blank"
                      title="Download the original uploaded source file"
                    >
                      <Download size={14} aria-hidden="true" />
                      Download
                    </a>
                  ) : null}
                  {source.extraction_status !== "processing" &&
                  source.extraction_status !== "deleted" ? (
                    <button
                      className="secondary-action compact-action"
                      disabled={pendingId === source.id}
                      onClick={() => retrySourceExtraction(source.id)}
                      title={
                        source.extraction_status === "succeeded"
                          ? "Reprocess preserved source text"
                          : "Retry source extraction"
                      }
                      type="button"
                    >
                      <RefreshCw size={14} aria-hidden="true" />
                      {pendingId === source.id
                        ? "Working..."
                        : source.extraction_status === "succeeded"
                          ? "Reprocess"
                          : "Retry"}
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

      <section className="sources-panel slim-sources-panel" aria-label="How sources are used">
        <div className="section-heading">
          <p className="eyebrow">How this helps</p>
          <h2>Grounded career memory</h2>
        </div>
        <p className="evidence-note">
          {brand.name} uses these sources to build your profile, draft your master
          resume, assess role fit, and create application materials. You should not
          have to manage individual extracted details here. Update your profile
          directly in Profile & Resume, or ask Pramania to refine it in chat.
        </p>
      </section>

      {activeSource ? (
        <SourceViewer source={activeSource} onClose={() => setActiveSource(null)} />
      ) : null}
    </main>
  );
}

function SourcePreviewThumb({
  onOpen,
  source,
}: {
  onOpen: () => void;
  source: ProfileOverview["recentSources"][number];
}) {
  if (!source.previewUrl) {
    return (
      <button className="source-file-thumb interactive" onClick={onOpen} type="button">
        <FileText size={24} aria-hidden="true" />
        <span>{formatSourceType(source.source_type)}</span>
      </button>
    );
  }

  if (source.source_type === "image") {
    return (
      <button className="source-preview-button" onClick={onOpen} type="button">
        <Image
          alt={source.original_filename ?? "Uploaded screenshot source"}
          className="source-preview-image"
          height={120}
          src={source.previewUrl}
          unoptimized
          width={180}
        />
      </button>
    );
  }

  return (
    <button className="source-file-thumb interactive" onClick={onOpen} type="button">
      <FileText size={24} aria-hidden="true" />
      <span>{formatSourceType(source.source_type)}</span>
    </button>
  );
}

function SourceViewer({
  onClose,
  source,
}: {
  onClose: () => void;
  source: ProfileOverview["recentSources"][number];
}) {
  return (
    <div className="attachment-viewer-backdrop" role="presentation" onClick={onClose}>
      <div
        aria-label={`Preview ${source.original_filename ?? "profile source"}`}
        aria-modal="true"
        className="attachment-viewer"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <strong>{source.original_filename ?? formatSourceUrl(source.source_url)}</strong>
            <span>{formatSourceType(source.source_type)} · {formatSourceTimestamp(source.created_at)}</span>
          </div>
          <div className="source-viewer-actions">
            {source.downloadUrl ? (
              <a
                className="secondary-action compact-action"
                download={source.original_filename ?? true}
                href={source.downloadUrl}
                rel="noreferrer"
                target="_blank"
                title="Download the original uploaded source file"
              >
                <Download size={14} aria-hidden="true" />
                Download original
              </a>
            ) : null}
            <button className="secondary-action compact-action" onClick={onClose} type="button">
              Close
            </button>
          </div>
        </header>
        <div className="attachment-viewer-body">
          {source.previewUrl && source.source_type === "image" ? (
            <Image
              alt={source.original_filename ?? "Uploaded source"}
              className="attachment-viewer-image"
              height={900}
              src={source.previewUrl}
              unoptimized
              width={1200}
            />
          ) : source.previewUrl && source.source_type === "pdf" ? (
            <object
              aria-label={`Preview of ${source.original_filename ?? "PDF source"}`}
              className="attachment-viewer-object"
              data={source.previewUrl}
              type="application/pdf"
            >
              <a href={source.previewUrl} rel="noreferrer" target="_blank">
                Open PDF preview
              </a>
            </object>
          ) : source.previewUrl ? (
            <iframe
              className="attachment-viewer-object"
              src={source.previewUrl}
              title={`Preview of ${source.original_filename ?? "source"}`}
            />
          ) : (
            <div className="attachment-viewer-empty">
              <FileText size={28} aria-hidden="true" />
              <p>
                Preview is not available, but the source record is preserved and can
                be retried or used as audit context.
              </p>
              <dl className="source-viewer-metadata">
                <div>
                  <dt>Status</dt>
                  <dd>{source.extraction_status.replace("_", " ")}</dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>{formatSourceType(source.source_type)}</dd>
                </div>
                {source.failure_reason ? (
                  <div>
                    <dt>Last issue</dt>
                    <dd>{formatFailureReason(source.failure_reason)}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
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

function formatSourceTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Time unavailable";
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return `${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)}${timezone ? ` (${timezone})` : ""}`;
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
    return "Read into your profile and resume context.";
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

function buildSourceCapabilities(source: ProfileOverview["recentSources"][number]) {
  const capabilities: { label: string; tone: string }[] = [];

  if (source.extraction_status === "succeeded" && source.readableCharacterCount > 0) {
    capabilities.push({ label: "Profile context available", tone: "ready" });
  }

  if (source.previewUrl) {
    capabilities.push({ label: "Preview available", tone: "neutral" });
  }

  if (source.source_type === "pdf") {
    capabilities.push({ label: "PDF text/vision parser", tone: "neutral" });
  } else if (source.source_type === "docx") {
    capabilities.push({ label: "Word parser", tone: "neutral" });
  } else if (source.source_type === "image") {
    capabilities.push({ label: "OCR retry supported", tone: "neutral" });
  } else if (source.source_type === "linkedin" && source.source_url) {
    capabilities.push({ label: "Public web only", tone: source.extraction_status === "failed" ? "warning" : "neutral" });
  } else if (source.source_type === "linkedin" && source.storage_path) {
    capabilities.push({ label: "LinkedIn export", tone: "neutral" });
  } else if (["link", "portfolio"].includes(source.source_type)) {
    capabilities.push({ label: "Public page reader", tone: "neutral" });
  }

  if (source.extraction_status === "failed") {
    capabilities.push({ label: "Needs attention", tone: "warning" });
  }

  return capabilities;
}

function sourceMatchesFilter(
  source: ProfileOverview["recentSources"][number],
  filter: SourceFilter,
) {
  if (filter === "All") {
    return true;
  }

  if (filter === "Read") {
    return source.extraction_status === "succeeded";
  }

  if (filter === "Needs attention") {
    return source.extraction_status === "failed";
  }

  if (filter === "Files") {
    return ["docx", "pdf", "txt", "linkedin"].includes(source.source_type);
  }

  if (filter === "Links") {
    return ["link", "portfolio"].includes(source.source_type);
  }

  return source.source_type === "image";
}

function buildSourceFilterCounts(sources: ProfileOverview["recentSources"]) {
  return sourceFilters.reduce<Record<SourceFilter, number>>(
    (counts, filter) => {
      counts[filter] = sources.filter((source) => sourceMatchesFilter(source, filter)).length;
      return counts;
    },
    {
      All: 0,
      Files: 0,
      Images: 0,
      Links: 0,
      "Needs attention": 0,
      Read: 0,
    },
  );
}

function buildSourceHealth(sources: ProfileOverview["recentSources"]) {
  return sources.reduce(
    (summary, source) => {
      if (source.extraction_status === "succeeded") {
        summary.read += 1;
      }

      if (source.extraction_status === "failed") {
        summary.needsAttention += 1;
      }

      summary.readableCharacters += source.readableCharacterCount ?? 0;

      return summary;
    },
    {
      needsAttention: 0,
      read: 0,
      readableCharacters: 0,
    },
  );
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(value);
}
