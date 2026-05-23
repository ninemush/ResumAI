"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { ApplicationOverview } from "@/lib/applications/application-overview";

type ApplicationPanelProps = {
  overview: ApplicationOverview;
};

const applicationStatuses = [
  { value: "draft", label: "Draft" },
  { value: "applied", label: "Applied" },
  { value: "no_reply", label: "No reply" },
  { value: "rejected", label: "Rejected" },
  { value: "interview_in_progress", label: "Interview in progress" },
  { value: "interviewed_not_selected", label: "Interviewed, not selected" },
  { value: "interviewed_selected", label: "Interviewed, selected" },
  { value: "withdrawn", label: "Withdrawn" },
];

export function ApplicationPanel({ overview }: ApplicationPanelProps) {
  const router = useRouter();
  const [generatingApplicationId, setGeneratingApplicationId] = useState<string | null>(null);
  const [pendingApplicationId, setPendingApplicationId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (overview.recentApplications.length === 0) {
    return null;
  }

  async function updateStatus(applicationId: string, status: string) {
    setPendingApplicationId(applicationId);
    setMessage(null);

    try {
      const response = await fetch(`/api/applications/${applicationId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to update application status.");
        return;
      }

      setMessage(`Updated ${payload.application?.companyName ?? "application"} to ${formatStatus(status)}.`);
      router.refresh();
    } finally {
      setPendingApplicationId(null);
    }
  }

  async function generateMaterials(applicationId: string) {
    setGeneratingApplicationId(applicationId);
    setMessage(null);

    try {
      const response = await fetch(`/api/applications/${applicationId}/materials`, {
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to generate materials.");
        return;
      }

      setMessage(payload.summary ?? "Generated targeted resume and cover-letter materials.");
      router.refresh();
    } finally {
      setGeneratingApplicationId(null);
    }
  }

  return (
    <section className="applications-panel" aria-label="Tracked applications">
      <div className="section-heading">
        <p className="eyebrow">Applications</p>
        <h2>Follow-up tracker</h2>
      </div>

      <div className="job-list">
        {message ? <p className="system-note success">{message}</p> : null}
        {overview.recentApplications.map((application) => (
          <article className="job-row" key={application.id}>
            <div>
              <h3>{application.jobTitle ?? "Application"}</h3>
              <p>{application.companyName}</p>
              <p>{formatStatus(application.status)}</p>
              {application.latestResumeStatus || application.latestCoverLetterStatus ? (
                <p>
                  Materials: resume {application.latestResumeStatus ?? "not ready"}, cover letter{" "}
                  {application.latestCoverLetterStatus ?? "not ready"}
                </p>
              ) : null}
              {application.latestResumeHeadline ? (
                <p>Resume direction: {application.latestResumeHeadline}</p>
              ) : null}
              {application.latestCoverLetterExcerpt ? (
                <p>Cover letter: {application.latestCoverLetterExcerpt}</p>
              ) : null}
            </div>
            <select
              aria-label={`Update ${application.companyName} application status`}
              className="status-select"
              disabled={pendingApplicationId === application.id}
              onChange={(event) => updateStatus(application.id, event.target.value)}
              value={application.status}
            >
              {applicationStatuses.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
            <button
              className="secondary-action"
              disabled={generatingApplicationId === application.id}
              onClick={() => generateMaterials(application.id)}
              type="button"
            >
              {generatingApplicationId === application.id ? "Generating..." : "Generate materials"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function formatStatus(status: string) {
  return applicationStatuses.find((item) => item.value === status)?.label ?? status.replaceAll("_", " ");
}
