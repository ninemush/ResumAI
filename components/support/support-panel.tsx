"use client";

import { AlertCircle, CheckCircle2, HelpCircle, MessageSquareText, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

type SupportIssue = {
  area: string;
  created_at: string;
  fix_status: string;
  id: string;
  owner_notes: string | null;
  priority: string;
  root_cause: string | null;
  root_cause_category: string | null;
  shortId: string;
  status: string;
  subject: string;
  suggested_fix: string | null;
  summary: string;
  updated_at: string;
};

export function SupportPanel() {
  const [issues, setIssues] = useState<SupportIssue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  async function loadIssues() {
    setIsLoading(true);
    setMessage(null);
    await fetchIssues();
  }

  async function fetchIssues() {
    try {
      const response = await fetch("/api/support/issues");
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Support issues could not be loaded.");
        return;
      }

      setIssues(payload.issues ?? []);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void fetchIssues();
  }, []);

  return (
    <main className="profile-pane" aria-labelledby="support-title">
      <div className="pane-heading compact-pane-heading">
        <p className="eyebrow">Support</p>
        <h1 id="support-title">Help and issue history</h1>
        <p>
          Ask Pramania for help in the chat. If the app behaves unexpectedly,
          Pramania logs an issue with the relevant context so you do not have to
          repeat the whole story.
        </p>
      </div>

      <section className="support-user-grid" aria-label="Support options">
        <article className="support-user-card">
          <MessageSquareText size={18} aria-hidden="true" />
          <div>
            <strong>Start in chat</strong>
            <p>
              Describe the problem naturally. If it looks like product friction
              rather than career guidance, Pramania will create a support issue
              and keep the conversation context attached.
            </p>
          </div>
        </article>
        <article className="support-user-card">
          <HelpCircle size={18} aria-hidden="true" />
          <div>
            <strong>What gets captured</strong>
            <p>
              The issue includes the affected area, likely root cause, priority,
              user-visible summary, and supporting logs for owner review.
            </p>
          </div>
        </article>
      </section>

      <section className="support-user-list" aria-label="Your support issues">
        <div className="section-heading inline-section-heading">
          <div>
            <p className="eyebrow">Your issues</p>
            <h2>Logged for review</h2>
          </div>
          <button className="secondary-action compact-action" onClick={() => void loadIssues()} type="button">
            <RefreshCw size={14} aria-hidden="true" />
            Refresh
          </button>
        </div>

        {message ? <p className="system-note">{message}</p> : null}
        {isLoading ? <p className="empty-state">Loading support history...</p> : null}
        {!isLoading && issues.length === 0 ? (
          <div className="record-empty-panel">
            <CheckCircle2 size={18} aria-hidden="true" />
            <div>
              <strong>No issues logged yet</strong>
              <p>
                If something breaks, ask Pramania for help in the chat. The
                issue will appear here after it is logged.
              </p>
            </div>
          </div>
        ) : null}
        {!isLoading && issues.length > 0 ? (
          <div className="support-user-issue-list">
            {issues.map((issue) => (
              <article className="support-user-issue" key={issue.id}>
                <div>
                  <span className={`support-user-pill ${issue.status}`}>{issue.status}</span>
                  <span className="support-user-id">{issue.shortId}</span>
                </div>
                <h3>{issue.subject}</h3>
                <p>{issue.summary}</p>
                <dl>
                  <div>
                    <dt>Area</dt>
                    <dd>{formatArea(issue.area)}</dd>
                  </div>
                  <div>
                    <dt>Likely cause</dt>
                    <dd>{issue.root_cause_category ?? "Being reviewed"}</dd>
                  </div>
                  <div>
                    <dt>Last update</dt>
                    <dd>{formatDate(issue.updated_at)}</dd>
                  </div>
                </dl>
                {issue.owner_notes ? (
                  <p className="support-owner-note">
                    <AlertCircle size={14} aria-hidden="true" />
                    {issue.owner_notes}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function formatArea(area: string) {
  return area.replaceAll("_", " ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
