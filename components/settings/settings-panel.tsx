"use client";

import { Database, FileText, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";

import type { ApplicationOverview } from "@/lib/applications/application-overview";
import type { ArtifactOverview } from "@/lib/artifacts/artifact-overview";
import type { WorkspaceSession } from "@/lib/commands/session";
import type { ProfileOverview } from "@/lib/profile/profile-overview";

type SettingsPanelProps = {
  applicationOverview: ApplicationOverview;
  artifactOverview: ArtifactOverview;
  profileOverview: ProfileOverview;
  session: WorkspaceSession;
};

export function SettingsPanel({
  applicationOverview,
  artifactOverview,
  profileOverview,
  session,
}: SettingsPanelProps) {
  return (
    <main className="profile-pane" aria-labelledby="settings-title">
      <div className="pane-heading">
        <p className="eyebrow">Settings</p>
        <h1 id="settings-title">Workspace controls</h1>
        <p>
          Review account identity, privacy posture, and current usage. Billing controls
          will attach here once Stripe tiers are enabled.
        </p>
      </div>

      <section className="settings-grid" aria-label="Workspace settings">
        <article className="settings-card">
          <UserRound size={18} aria-hidden="true" />
          <div>
            <span>Signed in as</span>
            <strong>{session.user.fullName ?? session.user.email ?? "Pramania user"}</strong>
            {session.user.email ? <p>{session.user.email}</p> : null}
          </div>
        </article>

        <article className="settings-card">
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <span>Privacy posture</span>
            <strong>Private by default</strong>
            <p>Profile sources, generated materials, and applications stay scoped to your authenticated account.</p>
          </div>
        </article>

        <article className="settings-card">
          <Database size={18} aria-hidden="true" />
          <div>
            <span>Profile evidence</span>
            <strong>
              {profileOverview.sourceCount} source{profileOverview.sourceCount === 1 ? "" : "s"} ·{" "}
              {profileOverview.factCount} signal{profileOverview.factCount === 1 ? "" : "s"}
            </strong>
            <p>Sources remain visible in the source library so you can audit what shaped your profile.</p>
          </div>
        </article>

        <article className="settings-card">
          <FileText size={18} aria-hidden="true" />
          <div>
            <span>Generated artifacts</span>
            <strong>
              {artifactOverview.summary.total} total · {artifactOverview.summary.exportedPdfs} PDF ·{" "}
              {artifactOverview.summary.exportedDocx} DOCX
            </strong>
            <p>Exports are generated from Pramania&apos;s standard ATS-safe template and retained with timestamps.</p>
          </div>
        </article>

        <article className="settings-card">
          <LockKeyhole size={18} aria-hidden="true" />
          <div>
            <span>Application usage</span>
            <strong>
              {applicationOverview.summary.total} application{applicationOverview.summary.total === 1 ? "" : "s"} logged
            </strong>
            <p>
              Quota-sensitive application events are retained for audit and tier enforcement.
            </p>
          </div>
        </article>
      </section>
    </main>
  );
}
