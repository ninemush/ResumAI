"use client";

import { CreditCard, FileText, Gift, HelpCircle, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { useState } from "react";

import type { ApplicationOverview } from "@/lib/applications/application-overview";
import type { ArtifactOverview } from "@/lib/artifacts/artifact-overview";
import type { AppView } from "@/components/app-shell/side-nav";
import type { CreditSummary } from "@/lib/billing/credits";
import type { WorkspaceSession } from "@/lib/commands/session";
import type { ProfileOverview } from "@/lib/profile/profile-overview";

type SettingsPanelProps = {
  applicationOverview: ApplicationOverview;
  artifactOverview: ArtifactOverview;
  creditSummary: CreditSummary;
  onNavigate?: (view: AppView) => void;
  profileOverview: ProfileOverview;
  session: WorkspaceSession;
};

export function SettingsPanel({ creditSummary: initialCreditSummary, onNavigate, session }: SettingsPanelProps) {
  const [creditSummary, setCreditSummary] = useState(initialCreditSummary);
  const [promoCode, setPromoCode] = useState("");
  const [promoStatus, setPromoStatus] = useState<string | null>(null);
  const [isRedeeming, setIsRedeeming] = useState(false);

  async function redeemPromo() {
    setIsRedeeming(true);
    setPromoStatus(null);

    try {
      const response = await fetch("/api/billing/promo/redeem", {
        body: JSON.stringify({ code: promoCode }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
        summary?: CreditSummary;
      };

      if (!response.ok || !payload.summary) {
        setPromoStatus(payload.error?.message ?? "That promo code could not be applied.");
        return;
      }

      setCreditSummary(payload.summary);
      setPromoCode("");
      setPromoStatus("Promo code applied. Your credits are ready to use.");
    } finally {
      setIsRedeeming(false);
    }
  }

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
            <div className="settings-link-row">
              <a className="inline-link" href="/terms" target="_blank" rel="noreferrer">
                Review terms
              </a>
              <a className="inline-link" href="/privacy" target="_blank" rel="noreferrer">
                Review privacy policy
              </a>
            </div>
          </div>
        </article>

        <article className="settings-section-card">
          <CreditCard size={18} aria-hidden="true" />
          <div>
            <span>Credits</span>
            <strong>{creditSummary.balance} credits available</strong>
            <p>
              Credits are used for high-cost work like profile extraction, resume generation,
              job analysis, application materials, and validated exports.
            </p>
            <CreditMeter summary={creditSummary} />
          </div>
        </article>

        <article className="settings-section-card settings-billing-card">
          <Gift size={18} aria-hidden="true" />
          <div>
            <span>Promo code</span>
            <strong>Apply a one-time credit grant</strong>
            <p>Promo credits are added to your account and stay auditable in your credit history.</p>
            <div className="settings-promo-row">
              <input
                aria-label="Promo code"
                autoComplete="off"
                onChange={(event) => setPromoCode(event.target.value)}
                placeholder="ENTER-CODE"
                value={promoCode}
              />
              <button disabled={isRedeeming || !promoCode.trim()} onClick={redeemPromo} type="button">
                Apply
              </button>
            </div>
            {promoStatus ? <p className="settings-card-note">{promoStatus}</p> : null}
          </div>
        </article>

        <article className="settings-section-card settings-purchase-card">
          <Sparkles size={18} aria-hidden="true" />
          <div>
            <span>Add credits</span>
            <strong>Choose a pack when you need more runway</strong>
            <p>
              Pricing is based on useful career outcomes, not raw tokens. The larger pack gives
              more room for targeted applications and revisions.
            </p>
            <div className="settings-pack-grid">
              {creditSummary.purchaseOptions.map((option) => (
                <a
                  aria-disabled={!option.url}
                  className={option.recommended ? "settings-pack recommended" : "settings-pack"}
                  href={
                    option.url
                      ? buildPurchaseUrl(option.url, session.user.id, session.user.email)
                      : "#"
                  }
                  key={option.productId}
                  onClick={(event) => {
                    if (!option.url) event.preventDefault();
                  }}
                  target={option.url ? "_blank" : undefined}
                  rel="noreferrer"
                >
                  <span>{option.label}</span>
                  <strong>${option.priceUsd}</strong>
                  <p>{option.credits} credits</p>
                  {option.recommended ? <em>Best value</em> : null}
                  {!option.url ? <small>RevenueCat link pending</small> : null}
                </a>
              ))}
            </div>
          </div>
        </article>

        <article className="settings-section-card">
          <HelpCircle size={18} aria-hidden="true" />
          <div>
            <span>Support</span>
            <strong>Issue history available</strong>
            <p>
              Use Pramania chat for help. Product issues are logged with context
              and visible in the Support area.
            </p>
            <div className="settings-link-row">
              <button
                className="inline-link button-link"
                onClick={() => onNavigate?.("support")}
                type="button"
              >
                Open support
              </button>
            </div>
          </div>
        </article>
      </section>
    </main>
  );
}

function CreditMeter({ summary }: { summary: CreditSummary }) {
  const percent = Math.min(Math.max(summary.usagePercent, 0), 100);
  const threshold = summary.warningThreshold;

  return (
    <div className="credit-meter" aria-label="Credit usage">
      <div className="credit-meter-track">
        <span style={{ width: `${percent}%` }} />
      </div>
      <p>
        {summary.usedCredits} used of {summary.totalCredits} total credits
        {threshold ? ` · ${threshold}% usage reached` : ""}
      </p>
      {summary.isExhausted ? (
        <p className="settings-card-note danger">
          Credits are exhausted. Generation, ingestion, and export actions are blocked until
          credits are added.
        </p>
      ) : null}
    </div>
  );
}

function buildPurchaseUrl(url: string, userId: string, email: string | null) {
  const encodedUserId = encodeURIComponent(userId);
  const encodedEmail = email ? encodeURIComponent(email) : "";
  const normalizedUrl = url
    .replaceAll("{app_user_id}", encodedUserId)
    .replaceAll("{{app_user_id}}", encodedUserId)
    .replaceAll(":app_user_id", encodedUserId)
    .replaceAll("APP_USER_ID", encodedUserId)
    .replaceAll("{email}", encodedEmail)
    .replaceAll("{{email}}", encodedEmail)
    .replaceAll(":email", encodedEmail)
    .replaceAll("EMAIL", encodedEmail);

  const purchaseUrl = new URL(normalizedUrl);

  if (!purchaseUrl.pathname.includes(`/${encodedUserId}`)) {
    purchaseUrl.pathname = `${purchaseUrl.pathname.replace(/\/$/, "")}/${encodedUserId}`;
  }

  if (email) {
    purchaseUrl.searchParams.set("email", email);
  }

  return purchaseUrl.toString();
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
