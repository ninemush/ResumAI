import { Activity, BriefcaseBusiness, FileText, HeartHandshake, UsersRound } from "lucide-react";

import type { OwnerMetrics } from "@/lib/admin/owner-metrics";

type OwnerConsoleProps = {
  metrics: OwnerMetrics;
};

export function OwnerConsole({ metrics }: OwnerConsoleProps) {
  return (
    <main className="owner-console" aria-labelledby="owner-console-title">
      <div className="pane-heading">
        <p className="eyebrow">Owner console</p>
        <h1 id="owner-console-title">Operating view</h1>
        <p>
          Aggregate product health, usage, application outcomes, and support readiness.
        </p>
      </div>

      <section className="owner-metric-grid" aria-label="Operating metrics">
        <MetricCard
          icon={UsersRound}
          label="Signed up"
          value={metrics.users.totalSignedUp}
          detail={`${metrics.users.active7d} active in 7 days, ${metrics.users.active30d} active in 30 days`}
        />
        <MetricCard
          icon={FileText}
          label="Profiles"
          value={metrics.profiles.created}
          detail={`${metrics.profiles.ready} ready, ${metrics.profiles.needsReview} need review`}
        />
        <MetricCard
          icon={BriefcaseBusiness}
          label="Applications"
          value={metrics.applications.logged}
          detail={`${formatRate(metrics.outcomes.interviewRate)} interview rate, ${formatRate(metrics.outcomes.selectionRate)} selected`}
        />
        <MetricCard
          icon={Activity}
          label="Materials"
          value={metrics.materials.generatedResumes + metrics.materials.generatedCoverLetters}
          detail={`${metrics.materials.resumePdfs + metrics.materials.coverLetterPdfs} PDFs exported`}
        />
        <MetricCard
          icon={HeartHandshake}
          label="Support"
          value={metrics.support.ticketsOpen}
          detail={metrics.support.status === "not_configured" ? "Support tables not configured yet" : `${metrics.support.ticketsEscalated} escalated`}
        />
      </section>

      <section className="owner-detail-grid" aria-label="Detailed operating metrics">
        <MetricBreakdown title="Application statuses" values={metrics.applications.byStatus} />
        <OutcomeBreakdown title="Outcome by tier" values={metrics.outcomes.byTier} />
        <OutcomeBreakdown title="Outcome by role family" values={metrics.outcomes.byRoleFamily} />
        <OutcomeBreakdown title="Outcome by source" values={metrics.outcomes.bySourceType} />
        <OutcomeBreakdown title="Outcome by resume type" values={metrics.outcomes.byResumeType} />
        <MetricBreakdown title="Feature usage" values={metrics.featureUsage} />
        <MetricBreakdown title="Profile sources" values={metrics.sources} />
        <div className="owner-detail-panel">
          <div className="section-heading">
            <p className="eyebrow">System health</p>
            <h2>Failure indicators</h2>
          </div>
          <dl className="metric-list">
            <div>
              <dt>Job ingestion failures</dt>
              <dd>{metrics.systemHealth.jobIngestionFailures}</dd>
            </div>
            <div>
              <dt>Profile extraction failures</dt>
              <dd>{metrics.systemHealth.profileExtractionFailures}</dd>
            </div>
            <div>
              <dt>Avg. hours to first response</dt>
              <dd>{metrics.outcomes.averageHoursToFirstResponse.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Generated at</dt>
              <dd>{formatTimestamp(metrics.generatedAt)}</dd>
            </div>
          </dl>
        </div>
      </section>
    </main>
  );
}

function MetricCard({
  detail,
  icon: Icon,
  label,
  value,
}: {
  detail: string;
  icon: typeof UsersRound;
  label: string;
  value: number;
}) {
  return (
    <article className="owner-metric-card">
      <div>
        <Icon size={18} aria-hidden="true" />
        <span>{label}</span>
      </div>
      <strong>{value.toLocaleString()}</strong>
      <p>{detail}</p>
    </article>
  );
}

function MetricBreakdown({ title, values }: { title: string; values: Record<string, number> }) {
  const entries = Object.entries(values);

  return (
    <div className="owner-detail-panel">
      <div className="section-heading">
        <p className="eyebrow">Usage</p>
        <h2>{title}</h2>
      </div>
      {entries.length > 0 ? (
        <dl className="metric-list">
          {entries.map(([label, value]) => (
            <div key={label}>
              <dt>{formatLabel(label)}</dt>
              <dd>{value.toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="empty-state">No activity recorded yet.</p>
      )}
    </div>
  );
}

function OutcomeBreakdown({
  title,
  values,
}: {
  title: string;
  values: Record<string, Record<string, number>>;
}) {
  const entries = Object.entries(values);

  return (
    <div className="owner-detail-panel">
      <div className="section-heading">
        <p className="eyebrow">Outcomes</p>
        <h2>{title}</h2>
      </div>
      {entries.length > 0 ? (
        <dl className="metric-list">
          {entries.map(([label, metrics]) => (
            <div key={label}>
              <dt>{formatLabel(label)}</dt>
              <dd>
                {Object.entries(metrics)
                  .map(([metricLabel, value]) =>
                    metricLabel.toLowerCase().includes("rate")
                      ? `${formatLabel(metricLabel)} ${formatRate(value)}`
                      : `${formatLabel(metricLabel)} ${value.toLocaleString()}`,
                  )
                  .join(" · ")}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="empty-state">No outcome data yet.</p>
      )}
    </div>
  );
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatRate(value: number) {
  return `${Math.round(value * 100)}%`;
}
