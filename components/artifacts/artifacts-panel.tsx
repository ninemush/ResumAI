"use client";

import { useMemo, useState } from "react";
import { Download, FileText, Layers3 } from "lucide-react";

import type { ArtifactOverview } from "@/lib/artifacts/artifact-overview";

type ArtifactsPanelProps = {
  overview: ArtifactOverview;
};

type ArtifactFilter = "all" | "resume" | "cover_letter" | "pdf" | "docx";

export function ArtifactsPanel({ overview }: ArtifactsPanelProps) {
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
          Resumes and cover letters Pramania created, with versions, timestamps,
          application context, and download status.
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
          filteredArtifacts.map((artifact) => (
            <article className="record-row artifact-record" key={`${artifact.kind}-${artifact.id}`}>
              <div className="artifact-icon">
                {artifact.kind === "resume" ? (
                  <FileText size={18} aria-hidden="true" />
                ) : (
                  <Layers3 size={18} aria-hidden="true" />
                )}
              </div>
              <div className="record-main">
                <h3 className="record-title">{artifact.label}</h3>
                <p className="record-meta">
                  {formatArtifactKind(artifact.kind)} v{artifact.version}
                  {artifact.companyName ? ` · ${artifact.companyName}` : ""}
                  {artifact.roleTitle ? ` · ${artifact.roleTitle}` : ""}
                </p>
                <p className="record-summary">
                  Created {formatDate(artifact.createdAt)} · Updated {formatDate(artifact.updatedAt)}
                </p>
              </div>
              <span className={`source-pill ${artifact.status}`}>{artifact.status}</span>
              <div className="record-actions artifact-actions" aria-label={`${artifact.label} downloads`}>
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
          ))
        ) : (
          <p className="empty-state">
            No artifacts match this filter yet. Generate or export a resume or cover
            letter and it will appear here.
          </p>
        )}
      </section>
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
