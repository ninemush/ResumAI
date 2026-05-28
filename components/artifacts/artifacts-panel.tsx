import { Download, FileText, Layers3 } from "lucide-react";

import type { ArtifactOverview } from "@/lib/artifacts/artifact-overview";

type ArtifactsPanelProps = {
  overview: ArtifactOverview;
};

export function ArtifactsPanel({ overview }: ArtifactsPanelProps) {
  return (
    <main className="profile-pane" aria-labelledby="artifacts-title">
      <div className="pane-heading">
        <p className="eyebrow">Artifacts</p>
        <h1 id="artifacts-title">Generated materials</h1>
        <p>
          A chronological record of resumes and cover letters Pramania created,
          including versions, timestamps, application context, and export status.
        </p>
      </div>

      <section className="cockpit-panel artifacts-summary" aria-label="Artifact summary">
        <article className="stage-progress-card">
          <span>Total</span>
          <strong>{overview.summary.total}</strong>
        </article>
        <article className="stage-progress-card">
          <span>Resumes</span>
          <strong>{overview.summary.resumes}</strong>
        </article>
        <article className="stage-progress-card">
          <span>Cover letters</span>
          <strong>{overview.summary.coverLetters}</strong>
        </article>
        <article className="stage-progress-card">
          <span>Exported PDFs</span>
          <strong>{overview.summary.exportedPdfs}</strong>
        </article>
        <article className="stage-progress-card">
          <span>Exported DOCX</span>
          <strong>{overview.summary.exportedDocx}</strong>
        </article>
      </section>

      <section className="sources-panel" aria-label="Generated artifact list">
        <div className="section-heading">
          <p className="eyebrow">Chronology</p>
          <h2>Latest generated files</h2>
        </div>
        {overview.artifacts.length > 0 ? (
          <div className="artifact-list">
            {overview.artifacts.map((artifact) => (
              <article className="artifact-row" key={`${artifact.kind}-${artifact.id}`}>
                <div className="artifact-icon">
                  {artifact.kind === "resume" ? (
                    <FileText size={18} aria-hidden="true" />
                  ) : (
                    <Layers3 size={18} aria-hidden="true" />
                  )}
                </div>
                <div>
                  <h3>{artifact.label}</h3>
                  <p>
                    {formatArtifactKind(artifact.kind)} v{artifact.version}
                    {artifact.companyName ? ` for ${artifact.companyName}` : ""}
                    {artifact.roleTitle ? ` - ${artifact.roleTitle}` : ""}
                  </p>
                  <p>
                    Created {formatDate(artifact.createdAt)}. Updated{" "}
                    {formatDate(artifact.updatedAt)}.
                  </p>
                </div>
                <span className={`source-pill ${artifact.status}`}>{artifact.status}</span>
                <div className="artifact-actions" aria-label={`${artifact.label} downloads`}>
                  {artifact.pdfDownloadUrl ? (
                    <a
                      className="source-pill succeeded"
                      href={artifact.pdfDownloadUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <Download size={13} aria-hidden="true" />
                      PDF
                    </a>
                  ) : (
                    <span className="source-pill">No PDF</span>
                  )}
                  {artifact.docxDownloadUrl ? (
                    <a
                      className="source-pill succeeded"
                      href={artifact.docxDownloadUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <Download size={13} aria-hidden="true" />
                      DOCX
                    </a>
                  ) : (
                    <span className="source-pill">No DOCX</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">
            Generated resumes and cover letters will appear here after you create a
            master resume or application materials.
          </p>
        )}
      </section>
    </main>
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
