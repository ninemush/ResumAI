"use client";

import { CreditCard, FileText, HelpCircle, ShieldCheck, UserRound } from "lucide-react";

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

export function SettingsPanel({ session }: SettingsPanelProps) {
  return (
    <main className="profile-pane" aria-labelledby="settings-title">
      <div className="pane-heading compact-pane-heading">
        <p className="eyebrow">Settings</p>
        <h1 id="settings-title">Account and privacy</h1>
        <p>
          Manage the basics that affect your workspace access, consent, privacy, and
          subscription readiness.
        </p>
      </div>

      <section className="settings-section-grid" aria-label="Workspace settings">
        <article className="settings-section-card">
          <UserRound size={18} aria-hidden="true" />
          <div>
            <span>Account identity</span>
            <strong>{session.user.fullName ?? session.user.email ?? "Pramania user"}</strong>
            {session.user.email ? <p>{session.user.email}</p> : null}
            <p className="settings-card-note">
              Your profile name can be refined in the Profile & Resume area without
              changing your sign-in email.
            </p>
          </div>
        </article>

        <article className="settings-section-card">
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <span>Privacy posture</span>
            <strong>Private workspace</strong>
            <p>
              Profile sources, generated materials, and applications remain scoped to
              your authenticated account.
            </p>
            <p className="settings-card-note">
              Export and deletion controls will be explicit before public launch.
            </p>
          </div>
        </article>

        <article className="settings-section-card">
          <FileText size={18} aria-hidden="true" />
          <div>
            <span>Terms</span>
            <strong>{session.legal?.termsAcceptedAt ? "Accepted" : "Action needed"}</strong>
            <p>
              {session.legal?.termsAcceptedAt
                ? `Accepted ${formatDate(session.legal.termsAcceptedAt)}.`
                : "Please accept the current Terms and Conditions to continue using Pramania."}
            </p>
            <a className="inline-link" href="/terms" target="_blank" rel="noreferrer">
              Review terms
            </a>
            <a className="inline-link" href="/privacy" target="_blank" rel="noreferrer">
              Review privacy policy
            </a>
          </div>
        </article>

        <article className="settings-section-card">
          <CreditCard size={18} aria-hidden="true" />
          <div>
            <span>Subscription</span>
            <strong>Private beta access</strong>
            <p>
              Stripe tiers are not enabled yet. Application limits will attach here as
              configurable plans, not code changes.
            </p>
          </div>
        </article>

        <article className="settings-section-card">
          <HelpCircle size={18} aria-hidden="true" />
          <div>
            <span>Support</span>
            <strong>Support desk planned</strong>
            <p>
              Self-serve docs and support cases are on the V1 backlog after the core
              profile, resume, and application flow stabilizes.
            </p>
          </div>
        </article>
      </section>
    </main>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
