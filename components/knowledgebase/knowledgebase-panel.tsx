"use client";

import { Download, FileText, RefreshCw, Trash2 } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { brand } from "@/lib/brand";
import type { ProfileOverview } from "@/lib/profile/profile-overview";

type KnowledgebasePanelProps = {
  embedded?: boolean;
  overview: ProfileOverview;
};

const sourceFilters = [
  "All",
  "Ready",
  "Needs help",
  "Files",
  "Links",
  "Images",
] as const;

type SourceFilter = (typeof sourceFilters)[number];

export function KnowledgebasePanel({ embedded = false, overview }: KnowledgebasePanelProps) {
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
          ? `File read. ${brand.name} updated your career profile from it.`
          : "Source read. I did not see anything new enough to change your profile this time.",
      );
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function removeSource(source: ProfileOverview["recentSources"][number]) {
    const label = source.original_filename ?? formatSourceUrl(source.source_url);
    const confirmed = window.confirm(
      `Remove ${label} from your Library? The original saved file or link record will be removed. Profile text already saved from it may still appear in your editable profile until you revise it.`,
    );

    if (!confirmed) {
      return;
    }

    setPendingId(source.id);
    setMessage(null);

    try {
      const response = await fetch(`/api/profile/sources/${source.id}`, {
        method: "DELETE",
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to remove that source.");
        return;
      }

      setMessage("Source removed from Library.");
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  const content = (
    <>
      {embedded ? null : (
        <div className="pane-heading">
          <p className="eyebrow">Library</p>
          <h1 id="knowledgebase-title">Uploaded files and links</h1>
          <p>
            A chronological record of resumes, LinkedIn exports, screenshots, links,
            and notes that shaped your profile and resume direction.
          </p>
        </div>
      )}

      {message ? <p className="system-note success">{message}</p> : null}

      <section className="sources-helper-panel" aria-label={`How ${brand.name} uses sources`}>
        <div>
          <strong>Your career record</strong>
          <p>
            Every resume, LinkedIn export, portfolio link, certificate photo,
            screenshot, note, and link you share
            in chat is kept here in order.
          </p>
        </div>
        <div>
          <strong>Why it matters</strong>
          <p>
            {brand.name} uses these sources to keep advice, resumes, and job-fit
            reviews grounded in what you actually shared.
          </p>
        </div>
        <div>
          <strong>Privacy reminder</strong>
          <p>
            Do not upload patient names, MRNs, DOBs, clinical notes, or other
            unauthorized sensitive details. Use de-identified operational results.
          </p>
        </div>
      </section>

      {sourceHealth.needsAttention > 0 ? (
        <section className="source-attention-panel" aria-label="Sources needing attention">
          <div>
              <strong>{sourceHealth.needsAttention} item{sourceHealth.needsAttention === 1 ? "" : "s"} need a clearer copy</strong>
              <p>
              Originals are still saved. Try again, download the file to check
              the version, or drop a cleaner copy into chat.
              </p>
          </div>
        </section>
      ) : null}

      <section className="sources-panel" aria-label="Profile sources">
        <div className="section-heading">
          <p className="eyebrow">Uploaded timeline</p>
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
                        <summary>View content</summary>
                        <p>{source.extractedTextPreview}</p>
                      </details>
                    ) : null}
                    <p className="source-proof-note">
                      {formatSourceProofNote(source)}
                    </p>
                    {source.source_type === "image" && source.extraction_status === "failed" ? (
                      <div className="source-fallback" aria-label="Image import options">
                        <FileText size={15} aria-hidden="true" />
                        <div>
                          <strong>What this means</strong>
                          <p>
                            The screenshot is saved. I try to read it automatically before
                            marking it as needing help. Use Try again for a fresh attempt, or
                            paste the visible text if the screenshot itself is hard to read.
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
                            More, select Save to PDF, then drag the PDF into {brand.name}.
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
                    {formatSourceStatusLabel(source.extraction_status)}
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
                        isSourceReady(source)
                          ? "Read this saved item again"
                          : "Try reading this saved item again"
                      }
                      type="button"
                    >
                      <RefreshCw size={14} aria-hidden="true" />
                      {pendingId === source.id
                        ? "Working..."
                        : isSourceReady(source)
                          ? "Read again"
                          : "Try again"}
                    </button>
                  ) : null}
                  <button
                    className="secondary-action compact-action danger-action"
                    disabled={pendingId === source.id}
                    onClick={() => void removeSource(source)}
                    title="Remove this source from Library"
                    type="button"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">
            Drop a resume, LinkedIn export, screenshot, portfolio link, or career note
            into {brand.name}. Rough notes and certificate photos are welcome. The source
            record will appear here.
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
          have to manage individual parsed details here. Update your profile
          directly in Profile & Resume, or ask {brand.name} to refine it in chat.
        </p>
      </section>

      {activeSource ? (
        <SourceViewer source={activeSource} onClose={() => setActiveSource(null)} />
      ) : null}
    </>
  );

  if (embedded) {
    return (
      <section className="profile-pane embedded-library-panel" aria-labelledby="knowledgebase-title">
        <div className="section-heading">
          <p className="eyebrow">Uploaded</p>
          <h2 id="knowledgebase-title">Uploaded files and links</h2>
        </div>
        {content}
      </section>
    );
  }

  return (
    <main className="profile-pane" aria-labelledby="knowledgebase-title">
      {content}
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
                  Preview is not available, but the original item is preserved and
                  can be tried again or used as supporting context.
              </p>
              <dl className="source-viewer-metadata">
                <div>
                  <dt>Status</dt>
                  <dd>{formatSourceStatusLabel(source.extraction_status)}</dd>
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
    DOCX_TEXT_EMPTY: "I could not find enough career content in this Word file.",
    IMAGE_OCR_FAILED: "I could not read enough text from this image.",
    IMAGE_OCR_FILE_TOO_LARGE: "This image is too large to read right now.",
    IMAGE_OCR_INCOMPLETE_RESPONSE: "The image read did not return enough useful text.",
    IMAGE_OCR_PROVIDER_AUTH_FAILED: "Image reading needs an owner-side configuration check.",
    IMAGE_OCR_PROVIDER_ERROR: "Image reading hit a service issue.",
    IMAGE_OCR_PROVIDER_REJECTED_IMAGE: "I could not process this image content.",
    IMAGE_OCR_PROVIDER_TEMPORARY_FAILURE: "Image reading was temporarily unavailable.",
    IMAGE_OCR_PROVIDER_UNAVAILABLE: "Image reading could not be reached.",
    IMAGE_OCR_TEXT_EMPTY: "I tried the image but did not find enough career content.",
    IMAGE_OCR_UNSUPPORTED_MIME_TYPE: "Use a JPG, PNG, or WebP image.",
    LINKEDIN_ARCHIVE_FILE_TOO_LARGE: "This LinkedIn export is too large to read right now.",
    LINKEDIN_ARCHIVE_INVALID_ZIP: "This does not look like a valid LinkedIn archive ZIP.",
    LINKEDIN_ARCHIVE_NO_PROFILE_FILES:
      "No LinkedIn profile CSV files found. Upload Profile.csv, Positions.csv, Skills.csv, or Education.csv.",
    LINKEDIN_ARCHIVE_TEXT_EMPTY: "I could not find enough profile rows in that LinkedIn export.",
    LINKEDIN_ARCHIVE_UNSUPPORTED_FILE: "LinkedIn archive import supports ZIP and CSV files.",
    LINKEDIN_PUBLIC_PROFILE_BLOCKED:
      `LinkedIn did not return enough public profile content to ${brand.name}.`,
    PDF_AI_EXTRACT_FAILED: "I could not read enough useful text from this PDF.",
    PDF_AI_INCOMPLETE_RESPONSE: "The PDF read did not return enough useful text.",
    PDF_AI_PROVIDER_AUTH_FAILED: "PDF reading needs an owner-side configuration check.",
    PDF_AI_PROVIDER_ERROR: "PDF reading hit a service issue.",
    PDF_AI_PROVIDER_REJECTED_FILE: "I could not process this PDF.",
    PDF_AI_PROVIDER_TEMPORARY_FAILURE: "PDF reading was temporarily unavailable.",
    PDF_AI_PROVIDER_UNAVAILABLE: "PDF reading could not be reached.",
    PDF_FILE_TOO_LARGE: "This PDF is too large to read right now.",
    PDF_PAGE_LIMIT_EXCEEDED: "This PDF has too many pages to read right now.",
    PDF_TEXT_EMPTY: "I could not find enough career content in this PDF.",
    PDF_TEXT_EXTRACTION_FAILED: "I could not read this PDF.",
    PROFILE_LINK_TEXT_TOO_SHORT: "I could not find enough profile content at that link.",
    TEXT_FILE_TOO_LARGE: "This text file is too large to read right now.",
  };

  return friendlyMessages[reason] ?? "This item needs another attempt.";
}

function formatSourceGuidance(source: ProfileOverview["recentSources"][number]) {
  if (source.extraction_status === "succeeded") {
    return "Ready to support your profile, resume, and job-fit reviews.";
  }

  if (source.extraction_status === "processing") {
    return "I am reading this now. Larger files can take a moment.";
  }

  if (source.extraction_status === "pending") {
    return "Saved and waiting to be read.";
  }

  if (source.source_type === "linkedin" && source.extraction_status === "failed") {
    return "I tried the public profile. If LinkedIn blocks the page, use the PDF or archive path below.";
  }

  if (source.source_type === "image" && source.extraction_status === "failed") {
    return "Saved as an image. Try again, or paste the key text if the image is hard to read.";
  }

  if (source.extraction_status === "failed") {
    return "Saved, but I need a clearer copy or another attempt before it can help your profile.";
  }

  return "Saved in your career record.";
}

function formatSourceProofNote(source: ProfileOverview["recentSources"][number]) {
  if (isSourceReady(source)) {
    const readableCount = source.readableCharacterCount;
    const companySummary = formatShortList(source.detectedCompanyNames);
    const roleSummary = formatShortList(source.detectedRoleTitles);

    if (source.detectedRoleCount > 0) {
      return [
        `Proof receipt: ${brand.name} detected ${source.detectedRoleCount} role timeline item${source.detectedRoleCount === 1 ? "" : "s"}`,
        companySummary ? `across ${companySummary}` : null,
        roleSummary ? `including ${roleSummary}` : null,
        "and can use this for profile, resume, and job-fit work.",
      ]
        .filter(Boolean)
        .join(" ");
    }

    return readableCount > 0
      ? `Proof receipt: ${brand.name} read this source and has ${readableCount.toLocaleString()} readable characters available for profile, resume, and job-fit work.`
      : `Proof receipt: ${brand.name} read this source and marked it profile-ready.`;
  }

  if (isSourceBlocked(source)) {
    return "Proof receipt: the original is saved, but this source has not safely updated your profile yet.";
  }

  if (source.extraction_status === "processing") {
    return `Proof receipt: this source is still being read, so ${brand.name} should not claim it changed your profile yet.`;
  }

  if (source.extraction_status === "pending") {
    return "Proof receipt: this source is saved and waiting to be read.";
  }

  return "Proof receipt: this source is preserved in your Library.";
}

function formatSourceStatusLabel(status: string) {
  if (["succeeded", "ready"].includes(status)) return "Ready";
  if (["failed", "error"].includes(status)) return "Needs help";
  if (status === "processing") return "Reading";
  if (status === "pending") return "Saved";
  if (status === "deleted") return "Removed";

  return status.replace("_", " ");
}

function buildSourceCapabilities(source: ProfileOverview["recentSources"][number]) {
  const capabilities: { label: string; tone: string }[] = [];

  if (isSourceReady(source)) {
    capabilities.push({ label: "Profile-ready", tone: "ready" });
  }

  if (source.detectedRoleCount > 0) {
    capabilities.push({
      label: `${source.detectedRoleCount} role${source.detectedRoleCount === 1 ? "" : "s"} found`,
      tone: "ready",
    });
  }

  if (source.previewUrl) {
    capabilities.push({ label: "Preview available", tone: "neutral" });
  }

  if (source.source_type === "pdf") {
    capabilities.push({ label: "PDF saved", tone: "neutral" });
  } else if (source.source_type === "docx") {
    capabilities.push({ label: "Word file saved", tone: "neutral" });
  } else if (source.source_type === "image") {
    capabilities.push({ label: "Image saved", tone: "neutral" });
  } else if (source.source_type === "linkedin" && source.source_url) {
    capabilities.push({ label: "Public profile link", tone: isSourceBlocked(source) ? "warning" : "neutral" });
  } else if (source.source_type === "linkedin" && source.storage_path) {
    capabilities.push({ label: "LinkedIn export", tone: "neutral" });
  } else if (["link", "portfolio"].includes(source.source_type)) {
    capabilities.push({ label: "Public page saved", tone: "neutral" });
  }

  if (isSourceBlocked(source)) {
    capabilities.push({ label: "Needs a clearer copy", tone: "warning" });
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

  if (filter === "Ready") {
    return isSourceReady(source);
  }

  if (filter === "Needs help") {
    return isSourceBlocked(source);
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
      "Needs help": 0,
      Ready: 0,
    },
  );
}

function buildSourceHealth(sources: ProfileOverview["recentSources"]) {
  return sources.reduce(
    (summary, source) => {
      if (isSourceReady(source)) {
        summary.read += 1;
      }

      if (isSourceBlocked(source)) {
        summary.needsAttention += 1;
      }

      return summary;
    },
    {
      needsAttention: 0,
      read: 0,
    },
  );
}

function isSourceReady(source: ProfileOverview["recentSources"][number]) {
  return ["succeeded", "ready"].includes(source.extraction_status);
}

function isSourceBlocked(source: ProfileOverview["recentSources"][number]) {
  return ["failed", "error"].includes(source.extraction_status);
}

function formatShortList(items: string[]) {
  if (items.length === 0) {
    return null;
  }

  if (items.length === 1) {
    return items[0];
  }

  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }

  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
