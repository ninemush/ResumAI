"use client";

import type { FormEvent } from "react";
import { AlertCircle, CheckCircle2, HelpCircle, MessageSquareText, RefreshCw, Send } from "lucide-react";
import { useEffect, useState } from "react";

type SupportIssue = {
  area: string;
  auto_closed_at: string | null;
  closed_reason: string | null;
  created_at: string;
  fix_status: string;
  id: string;
  priority: string;
  reopen_until: string | null;
  root_cause: string | null;
  root_cause_category: string | null;
  shortId: string;
  status: string;
  subject: string;
  suggested_fix: string | null;
  summary: string;
  updated_at: string;
  user_visible_resolution: string | null;
};

export function SupportPanel() {
  const [issues, setIssues] = useState<SupportIssue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [category, setCategory] = useState("product");
  const [severity, setSeverity] = useState("normal");
  const [subject, setSubject] = useState("");
  const [details, setDetails] = useState("");
  const [includeContext, setIncludeContext] = useState(true);
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

  async function createIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedSubject = subject.trim();
    const trimmedDetails = details.trim();

    if (!trimmedSubject || !trimmedDetails) {
      setMessage("Add a short subject and the details you want support to review.");
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch("/api/support/issues", {
        body: JSON.stringify({
          area: category,
          errorCode: `USER_${category.toUpperCase()}_${severity.toUpperCase()}`,
          metadata: {
            attachmentConsent: false,
            category,
            includeSupportContext: includeContext,
            severity,
            sourceSurface: "support_form",
          },
          source: "support_form",
          title: trimmedSubject,
          userMessage: trimmedDetails,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload.error?.message ?? "Unable to create that support issue.");
        return;
      }

      setSubject("");
      setDetails("");
      setCategory("product");
      setSeverity("normal");
      setIncludeContext(true);
      setMessage(
        `Created issue ${payload.issue?.shortId ?? ""}. Human review is expected within the response window shown here.`,
      );
      await fetchIssues();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="profile-pane" aria-labelledby="support-title">
      <div className="pane-heading compact-pane-heading">
        <p className="eyebrow">Support</p>
        <h1 id="support-title">Help and issue history</h1>
        <p>
          Create a support issue directly for product problems, billing/refund
          questions, privacy or security requests, and account recovery help.
          Chat can still help with quick guidance.
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
        <article className="support-user-card warning">
          <AlertCircle size={18} aria-hidden="true" />
          <div>
            <strong>Keep sensitive details out</strong>
            <p>
              Do not include patient names, MRNs, DOBs, clinical notes, SSNs,
              private employer records, or other unauthorized sensitive data in
              support messages. Use de-identified examples instead.
            </p>
          </div>
        </article>
      </section>

      <section className="support-request-panel" aria-label="Create support issue">
        <div className="section-heading inline-section-heading">
          <div>
            <p className="eyebrow">New issue</p>
            <h2>Route this to support</h2>
          </div>
          <span className="support-response-pill">Expected first response: 1 business day</span>
        </div>
        <form className="support-request-form" onSubmit={createIssue}>
          <div className="support-form-grid">
            <label>
              Category
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="product">Product issue</option>
                <option value="billing_refund">Billing or refund</option>
                <option value="privacy">Privacy or data rights</option>
                <option value="security">Security concern</option>
                <option value="account_recovery">Account recovery</option>
              </select>
            </label>
            <label>
              Severity
              <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
          </div>
          <label>
            Subject
            <input
              maxLength={180}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Short description"
              value={subject}
            />
          </label>
          <label>
            Details
            <textarea
              maxLength={2000}
              onChange={(event) => setDetails(event.target.value)}
              placeholder="What happened, what you expected, and whether this involves billing, privacy, security, or account access."
              rows={5}
              value={details}
            />
          </label>
          <label className="support-context-consent">
            <input
              checked={includeContext}
              onChange={(event) => setIncludeContext(event.target.checked)}
              type="checkbox"
            />
            <span>
              Include support-safe workspace context such as recent errors,
              affected area, and issue history. Do not include sensitive
              personal records in the message.
            </span>
          </label>
          <div className="support-request-footer">
            <p>
              Privacy, security, refund, and account-access issues are routed
              for human escalation review.
            </p>
            <button className="secondary-action" disabled={isSubmitting} type="submit">
              <Send size={15} aria-hidden="true" />
              {isSubmitting ? "Creating..." : "Create issue"}
            </button>
          </div>
        </form>
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
                  <div>
                    <dt>Reopen window</dt>
                    <dd>{formatReopenWindow(issue)}</dd>
                  </div>
                </dl>
                {issue.user_visible_resolution ? (
                  <p className="support-resolution-note">
                    <AlertCircle size={14} aria-hidden="true" />
                    {issue.user_visible_resolution}
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

function formatReopenWindow(issue: SupportIssue) {
  if (issue.status === "closed") {
    return issue.auto_closed_at ? `Closed ${formatDate(issue.auto_closed_at)}` : "Closed";
  }

  if (issue.status === "resolved" && issue.reopen_until) {
    return `Until ${formatDate(issue.reopen_until)}`;
  }

  return "After resolution";
}
