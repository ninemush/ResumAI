"use client";

import { useMemo, useState } from "react";
import { Download, ExternalLink, FileText, Layers3, X } from "lucide-react";

import type { ArtifactOverview } from "@/lib/artifacts/artifact-overview";

type ArtifactsPanelProps = {
  overview: ArtifactOverview;
};

type ArtifactFilter = "all" | "resume" | "cover_letter" | "pdf" | "docx";

export function ArtifactsPanel({ overview }: ArtifactsPanelProps) {
  const [activeArtifact, setActiveArtifact] = useState<ArtifactOverview["artifacts"][number] | null>(
    null,
  );
  const [filter, setFilter] = useState<ArtifactFilter>("all");
  const filteredArtifacts = useMemo(
    () =>
      overview.artifacts.filter((artifact) => {
        if (filter === "all") return true;
        if (filter === "pdf") return Boolean(artifact.pdfDownloadUrl);
        if (filter === "docx") return Boolean(artifact.docxDownloadUrl);
        return artifact.kind === filter;
      }),
    [filter, overview.artifacts],
  );

  return (
    <main className="profile-pane" aria-labelledby="artifacts-title">
      <div className="pane-heading compact-pane-heading">
        <p className="eyebrow">Artifacts</p>
        <h1 id="artifacts-title">Generated materials</h1>
        <p>
          A chronological cabinet for resumes and cover letters Pramania created,
          including the role context and export files when available.
        </p>
      </div>

      <section className="artifact-filter-strip" aria-label="Artifact filters">
        <ArtifactFilterButton active={filter === "all"} count={overview.summary.total} label="All" onClick={() => setFilter("all")} />
        <ArtifactFilterButton active={filter === "resume"} count={overview.summary.resumes} label="Resumes" onClick={() => setFilter("resume")} />
        <ArtifactFilterButton active={filter === "cover_letter"} count={overview.summary.coverLetters} label="Cover letters" onClick={() => setFilter("cover_letter")} />
        <ArtifactFilterButton active={filter === "pdf"} count={overview.summary.exportedPdfs} label="PDFs" onClick={() => setFilter("pdf")} />
        <ArtifactFilterButton active={filter === "docx"} count={overview.summary.exportedDocx} label="DOCX" onClick={() => setFilter("docx")} />
      </section>

      <section className="record-list artifact-record-list" aria-label="Generated artifact list">
        {filteredArtifacts.length > 0 ? (
          <>
            <div className="record-table-header artifact-record-header" aria-hidden="true">
              <span />
              <span>Material</span>
              <span>Status</span>
              <span>Downloads</span>
            </div>
            {filteredArtifacts.map((artifact) => (
              <article className="record-row artifact-record" key={`${artifact.kind}-${artifact.id}`}>
                <div className="artifact-icon">
                  {artifact.kind === "resume" ? (
                    <FileText size={18} aria-hidden="true" />
                  ) : (
                    <Layers3 size={18} aria-hidden="true" />
                  )}
                </div>
                <button
                  className="record-main-button"
                  onClick={() => setActiveArtifact(artifact)}
                  title="Open artifact details"
                  type="button"
                >
                  <span className="record-title">{artifact.label}</span>
                  <span className="record-meta">
                    {formatArtifactKind(artifact.kind)} v{artifact.version}
                    {artifact.companyName ? ` · ${artifact.companyName}` : ""}
                    {artifact.roleTitle ? ` · ${artifact.roleTitle}` : ""}
                  </span>
                  <span className="record-summary">
                    Created {formatDate(artifact.createdAt)} · Updated {formatDate(artifact.updatedAt)}
                  </span>
                </button>
                <span className={`source-pill ${artifact.status}`}>{artifact.status}</span>
                <div className="record-actions artifact-actions" aria-label={`${artifact.label} downloads`}>
                  <button
                    className="secondary-action compact-action"
                    onClick={() => setActiveArtifact(artifact)}
                    type="button"
                  >
                    <ExternalLink size={13} aria-hidden="true" />
                    Details
                  </button>
                  {artifact.pdfDownloadUrl ? (
                    <a
                      className="secondary-action compact-action"
                      href={artifact.pdfDownloadUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <Download size={13} aria-hidden="true" />
                      PDF
                    </a>
                  ) : null}
                  {artifact.docxDownloadUrl ? (
                    <a
                      className="secondary-action compact-action"
                      href={artifact.docxDownloadUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <Download size={13} aria-hidden="true" />
                      DOCX
                    </a>
                  ) : null}
                  {!artifact.pdfDownloadUrl && !artifact.docxDownloadUrl ? (
                    <span className="source-pill muted">Not exported</span>
                  ) : null}
                </div>
              </article>
            ))}
          </>
        ) : (
          <p className="empty-state">
            No artifacts match this filter yet. Generate or export a resume or cover
            letter and it will appear here.
          </p>
        )}
      </section>

      {activeArtifact ? (
        <ArtifactViewer artifact={activeArtifact} onClose={() => setActiveArtifact(null)} />
      ) : null}
    </main>
  );
}

function ArtifactFilterButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`artifact-filter-chip${active ? " active" : ""}`}
      onClick={onClick}
      type="button"
    >
      <strong>{count}</strong>
      <span>{label}</span>
    </button>
  );
}

function formatArtifactKind(kind: ArtifactOverview["artifacts"][number]["kind"]) {
  return kind === "resume" ? "Resume" : "Cover letter";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function ArtifactViewer({
  artifact,
  onClose,
}: {
  artifact: ArtifactOverview["artifacts"][number];
  onClose: () => void;
}) {
  return (
    <div className="attachment-viewer-backdrop" role="presentation" onClick={onClose}>
      <div
        aria-label={`Open ${artifact.label}`}
        aria-modal="true"
        className="attachment-viewer artifact-viewer"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <strong>{artifact.label}</strong>
            <span>
              {formatArtifactKind(artifact.kind)} v{artifact.version} · Updated{" "}
              {formatDate(artifact.updatedAt)}
            </span>
          </div>
          <button className="secondary-action compact-action" onClick={onClose} type="button">
            <X size={14} aria-hidden="true" />
            Close
          </button>
        </header>

        <div className="artifact-viewer-body">
          <dl className="artifact-metadata-grid">
            <div>
              <dt>Status</dt>
              <dd>{artifact.status.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Context</dt>
              <dd>
                {artifact.roleTitle && artifact.companyName
                  ? `${artifact.roleTitle} at ${artifact.companyName}`
                  : artifact.companyName ?? artifact.roleTitle ?? "Master material"}
              </dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDate(artifact.createdAt)}</dd>
            </div>
            <div>
              <dt>Downloads</dt>
              <dd>
                {artifact.pdfDownloadUrl || artifact.docxDownloadUrl
                  ? "Export files are ready."
                  : "Not exported yet."}
              </dd>
            </div>
          </dl>

          <div className="artifact-download-panel">
            {artifact.pdfDownloadUrl ? (
              <a className="secondary-action" href={artifact.pdfDownloadUrl} rel="noreferrer" target="_blank">
                <Download size={15} aria-hidden="true" />
                Open PDF
              </a>
            ) : null}
            {artifact.docxDownloadUrl ? (
              <a className="secondary-action" href={artifact.docxDownloadUrl} rel="noreferrer" target="_blank">
                <Download size={15} aria-hidden="true" />
                Download DOCX
              </a>
            ) : null}
            {!artifact.pdfDownloadUrl && !artifact.docxDownloadUrl ? (
              <p>
                Open the related resume or application material, review it, then export
                PDF and DOCX files from there.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
