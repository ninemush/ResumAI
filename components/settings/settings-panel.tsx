"use client";

import {
  CreditCard,
  Download,
  FileText,
  Gift,
  HelpCircle,
  KeyRound,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  WalletCards,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { AppView } from "@/components/app-shell/side-nav";
import type { ApplicationOverview } from "@/lib/applications/application-overview";
import type { ArtifactOverview } from "@/lib/artifacts/artifact-overview";
import {
  CREDIT_USAGE_GUIDE,
  formatCreditCost,
} from "@/lib/billing/credit-catalog";
import type {
  CreditHistory,
  CreditLedgerEvent,
  CreditSummary,
} from "@/lib/billing/credits";
import type { WorkspaceSession } from "@/lib/commands/session";
import type { ProfileOverview } from "@/lib/profile/profile-overview";
import { createClient } from "@/lib/supabase/browser";

type SettingsPanelProps = {
  applicationOverview: ApplicationOverview;
  artifactOverview: ArtifactOverview;
  creditSummary: CreditSummary;
  onNavigate?: (view: AppView) => void;
  profileOverview: ProfileOverview;
  session: WorkspaceSession;
};

type BillingHistoryResponse = {
  error?: { message?: string };
  history?: CreditHistory;
};

type PrivacyRequestType =
  | "account_delete"
  | "drafts_delete"
  | "data_export"
  | "privacy_question";

export function SettingsPanel({
  creditSummary: initialCreditSummary,
  onNavigate,
  session,
}: SettingsPanelProps) {
  const [creditSummary, setCreditSummary] = useState(initialCreditSummary);
  const [creditHistory, setCreditHistory] = useState<CreditHistory | null>(
    null,
  );
  const [historyStatus, setHistoryStatus] = useState<string | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [privacyRequestLoading, setPrivacyRequestLoading] =
    useState<PrivacyRequestType | null>(null);
  const [privacyRequestStatus, setPrivacyRequestStatus] = useState<string | null>(null);
  const [promoStatus, setPromoStatus] = useState<string | null>(null);
  const [resetStatus, setResetStatus] = useState<string | null>(null);

  const email = session.user.email;
  const usageRows = creditHistory?.usage.slice(0, 8) ?? [];
  const purchaseRows = creditHistory?.purchases.slice(0, 8) ?? [];
  const invoiceRows = creditHistory?.invoices.slice(0, 8) ?? [];
  const usageBreakdown = useMemo(
    () => [
      { label: "Starter", value: creditSummary.signupCredits },
      { label: "Promo", value: creditSummary.promoCredits },
      { label: "Purchased", value: creditSummary.purchasedCredits },
      { label: "Used", value: creditSummary.usedCredits },
    ],
    [creditSummary],
  );
  const hasLiveCheckout = creditSummary.purchaseOptions.some(
    (option) => option.url,
  );

  useEffect(() => {
    let isMounted = true;

    async function loadHistory() {
      setIsHistoryLoading(true);
      setHistoryStatus(null);

      try {
        const response = await fetch("/api/billing/history");
        const payload = (await response.json()) as BillingHistoryResponse;

        if (!response.ok || !payload.history) {
          throw new Error(
            payload.error?.message ?? "Unable to load usage history.",
          );
        }

        if (isMounted) {
          setCreditHistory(payload.history);
        }
      } catch (error) {
        if (isMounted) {
          setHistoryStatus(
            error instanceof Error
              ? error.message
              : "Unable to load usage history.",
          );
        }
      } finally {
        if (isMounted) {
          setIsHistoryLoading(false);
        }
      }
    }

    void loadHistory();

    return () => {
      isMounted = false;
    };
  }, []);

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
        setPromoStatus(
          payload.error?.message ?? "That promo code could not be applied.",
        );
        return;
      }

      setCreditSummary(payload.summary);
      setPromoCode("");
      setPromoStatus("Promo code applied. Your credits are ready to use.");
      await refreshHistory(setCreditHistory, setHistoryStatus);
    } finally {
      setIsRedeeming(false);
    }
  }

  async function sendPasswordReset() {
    if (!email) {
      setResetStatus("This account does not have an email address attached.");
      return;
    }

    setIsSendingReset(true);
    setResetStatus(null);

    const redirectTo = new URL("/auth/callback", window.location.origin);
    redirectTo.searchParams.set("next", "/auth/reset-password");
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: redirectTo.toString(),
    });

    setIsSendingReset(false);
    setResetStatus(
      error
        ? error.message
        : "Check your email for a secure password reset link.",
    );
  }

  async function createPrivacyRequest(type: PrivacyRequestType) {
    const config = privacyRequestConfig[type];

    setPrivacyRequestLoading(type);
    setPrivacyRequestStatus(null);

    try {
      const response = await fetch("/api/support/issues", {
        body: JSON.stringify({
          area: "privacy",
          errorCode: `USER_PRIVACY_${type.toUpperCase()}`,
          metadata: {
            requestType: type,
            sourceSurface: "settings_data_privacy",
          },
          source: "settings_data_privacy",
          title: config.title,
          userMessage: config.message,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        setPrivacyRequestStatus(
          payload.error?.message ?? "Unable to create that privacy request.",
        );
        return;
      }

      setPrivacyRequestStatus(
        `Created ${payload.issue?.shortId ?? "a support issue"} for ${config.label.toLowerCase()}.`,
      );
    } finally {
      setPrivacyRequestLoading(null);
    }
  }

  return (
    <main
      className="profile-pane settings-pane"
      aria-labelledby="settings-title"
    >
      <div className="pane-heading compact-pane-heading">
        <p className="eyebrow">Settings</p>
        <h1 id="settings-title">Account, billing, and access</h1>
        <p>
          Review your identity, credit usage, purchase records, security
          options, and support history from one place.
        </p>
      </div>

      <section className="settings-overview-grid" aria-label="Account overview">
        <article className="settings-section-card">
          <UserRound size={18} aria-hidden="true" />
          <div>
            <span>Account</span>
            <strong>{session.user.fullName ?? email ?? "Pramania user"}</strong>
            {email ? <p>{email}</p> : null}
            <p className="settings-card-note">
              Profile naming stays separate from your sign-in email, so resume
              edits do not change account access.
            </p>
          </div>
        </article>

        <article className="settings-section-card">
          <WalletCards size={18} aria-hidden="true" />
          <div>
            <span>Credit balance</span>
            <strong>{creditSummary.balance} available</strong>
            <CreditMeter summary={creditSummary} />
            <div className="settings-link-row">
              <a className="inline-link" href="/credits">
                Open usage and billing guide
              </a>
            </div>
          </div>
        </article>

        <article className="settings-section-card">
          <KeyRound size={18} aria-hidden="true" />
          <div>
            <span>Security</span>
            <strong>Password reset</strong>
            <p>
              Local password accounts can reset by email. Three failed password
              attempts trigger an account lock, and email-code verification
              protects new sessions.
            </p>
            <button
              className="settings-small-action"
              disabled={isSendingReset || !email}
              onClick={sendPasswordReset}
              type="button"
            >
              {isSendingReset ? "Sending reset link..." : "Send reset link"}
            </button>
            {resetStatus ? (
              <p className="settings-card-note">{resetStatus}</p>
            ) : null}
          </div>
        </article>
      </section>

      {creditSummary.isExhausted ? <CreditExhaustedNotice /> : null}

      <section className="settings-panel-section" aria-labelledby="data-rights-title">
        <div className="settings-section-heading">
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <p className="eyebrow">Data and privacy</p>
            <h2 id="data-rights-title">Data rights requests</h2>
            <p>
              Create a routed request for export, deletion, privacy questions,
              or account deletion. Requests are reviewed against audit-safe
              retention rules before any destructive action.
            </p>
          </div>
        </div>
        <div className="settings-privacy-action-grid">
          {(Object.keys(privacyRequestConfig) as PrivacyRequestType[]).map((type) => {
            const config = privacyRequestConfig[type];
            const Icon = config.icon === "delete" ? Trash2 : config.icon === "export" ? Download : HelpCircle;

            return (
              <button
                className={`settings-privacy-action ${config.tone === "danger" ? "danger" : ""}`}
                disabled={privacyRequestLoading !== null}
                key={type}
                onClick={() => void createPrivacyRequest(type)}
                type="button"
              >
                <Icon size={16} aria-hidden="true" />
                <strong>
                  {privacyRequestLoading === type ? "Creating..." : config.label}
                </strong>
                <span>{config.helper}</span>
              </button>
            );
          })}
        </div>
        {privacyRequestStatus ? (
          <p className="settings-card-note">{privacyRequestStatus}</p>
        ) : null}
        <p className="settings-card-note">
          You can also use Support for a human fallback. Application and quota
          records may retain minimum audit evidence where required by the V1
          retention policy.
        </p>
      </section>

      <section className="settings-panel-section" aria-labelledby="usage-title">
        <div className="settings-section-heading">
          <CreditCard size={18} aria-hidden="true" />
          <div>
            <p className="eyebrow">Usage</p>
            <h2 id="usage-title">Credit usage</h2>
            <p>
              Credits are consumed only by high-cost actions such as source
              reading, job analysis, generation, and export.
            </p>
          </div>
        </div>

        <div className="settings-stat-grid" aria-label="Credit breakdown">
          {usageBreakdown.map((item) => (
            <div className="settings-stat-card" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>

        <article
          className="settings-cost-guide"
          aria-labelledby="settings-cost-title"
        >
          <div>
            <h3 id="settings-cost-title">What actions use credits</h3>
            <a className="inline-link" href="/credits">
              See examples and rules
            </a>
          </div>
          <div className="settings-cost-list">
            {CREDIT_USAGE_GUIDE.map((item) => (
              <div className="settings-cost-row" key={item.feature}>
                <span>{item.name}</span>
                <strong>{formatCreditCost(item.cost)}</strong>
                <p>{item.value}</p>
              </div>
            ))}
          </div>
        </article>

        <HistoryList
          emptyText="No credit activity yet."
          isLoading={isHistoryLoading}
          rows={usageRows}
          status={historyStatus}
          title="Recent usage history"
        />
      </section>

      <section
        className="settings-panel-section"
        id="add-credits"
        aria-labelledby="billing-title"
      >
        <div className="settings-section-heading">
          <Sparkles size={18} aria-hidden="true" />
          <div>
            <p className="eyebrow">Billing</p>
            <h2 id="billing-title">Add credits</h2>
            <p>
              Pick a pack when you need more space for role analysis, tailored
              materials, and validated exports. The larger pack is priced for
              users applying to multiple roles and revising materials over a
              search sprint.
            </p>
          </div>
        </div>

        {!hasLiveCheckout ? (
          <div className="settings-checkout-note" role="status">
            <strong>Checkout is unavailable right now.</strong>
            <span>
              Promo codes and support-assisted credit grants are still
              available.
            </span>
            <button
              className="inline-link button-link"
              onClick={() => onNavigate?.("support")}
              type="button"
            >
              Open support
            </button>
          </div>
        ) : null}

        <div className="settings-pack-grid">
          {creditSummary.purchaseOptions.map((option) => (
            <CreditPackOption
              email={email}
              key={option.productId}
              onOpenSupport={() => onNavigate?.("support")}
              option={option}
              userId={session.user.id}
            />
          ))}
        </div>

        <div className="settings-history-grid">
          <HistoryList
            emptyText="No purchases yet."
            isLoading={isHistoryLoading}
            rows={purchaseRows}
            status={historyStatus}
            title="Purchase history"
          />
          <HistoryList
            emptyText="No receipts yet. Checkout receipts will appear after a credit purchase."
            isLoading={isHistoryLoading}
            rows={invoiceRows}
            status={historyStatus}
            title="Invoices and receipts"
          />
        </div>
        <p className="settings-card-note">
          Purchase rows show post-purchase confirmation once RevenueCat or
          checkout webhooks credit the account. Refund, payment, and receipt
          questions should be opened through Support so the owner can reconcile
          the credit ledger before changing balances.
        </p>
      </section>

      <section className="settings-section-grid" aria-label="Account controls">
        <article className="settings-section-card settings-billing-card">
          <Gift size={18} aria-hidden="true" />
          <div>
            <span>Promo code</span>
            <strong>Apply a one-time credit grant</strong>
            <p>
              Promo credits are added to your account and stay auditable in your
              usage history.
            </p>
            <div className="settings-promo-row">
              <input
                aria-label="Promo code"
                autoComplete="off"
                onChange={(event) => setPromoCode(event.target.value)}
                placeholder="ENTER-CODE"
                value={promoCode}
              />
              <button
                disabled={isRedeeming || !promoCode.trim()}
                onClick={redeemPromo}
                type="button"
              >
                {isRedeeming ? "Applying..." : "Apply"}
              </button>
            </div>
            {promoStatus ? (
              <p className="settings-card-note">{promoStatus}</p>
            ) : null}
          </div>
        </article>

        <article className="settings-section-card">
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <span>Privacy</span>
            <strong>Private workspace</strong>
            <p>
              Profile sources, generated materials, and applications remain
              scoped to your authenticated account. Exports and billing events
              are retained for audit and support.
            </p>
          </div>
        </article>

        <article className="settings-section-card">
          <FileText size={18} aria-hidden="true" />
          <div>
            <span>Terms</span>
            <strong>
              {session.legal?.termsAcceptedAt ? "Accepted" : "Action needed"}
            </strong>
            <p>
              {session.legal?.termsAcceptedAt
                ? `Accepted ${formatDate(session.legal.termsAcceptedAt)}.`
                : "Please accept the current Terms and Conditions to continue using Pramania."}
            </p>
            <div className="settings-link-row">
              <a
                className="inline-link"
                href="/terms"
                target="_blank"
                rel="noreferrer"
              >
                Review terms
              </a>
              <a
                className="inline-link"
                href="/privacy"
                target="_blank"
                rel="noreferrer"
              >
                Review privacy policy
              </a>
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

function CreditPackOption({
  email,
  onOpenSupport,
  option,
  userId,
}: {
  email: string | null;
  onOpenSupport: () => void;
  option: CreditSummary["purchaseOptions"][number];
  userId: string;
}) {
  const className = option.recommended
    ? "settings-pack recommended"
    : "settings-pack";
  const content = (
    <>
      <span>{option.label}</span>
      <strong>${option.priceUsd}</strong>
      <p>{option.credits} credits</p>
      <small>{option.description}</small>
      <small>One-time credit pack. No auto-charge or auto-renew.</small>
      {option.recommended ? <em>Best value</em> : null}
    </>
  );

  if (option.url) {
    return (
      <a
        className={className}
        href={buildPurchaseUrl(option.url, userId, email)}
        target="_blank"
        rel="noreferrer"
      >
        {content}
      </a>
    );
  }

  return (
    <article className={`${className} unavailable`}>
      {content}
      <small>Use a promo code or contact support to add credits.</small>
      <button
        className="inline-link button-link settings-pack-support"
        onClick={onOpenSupport}
        type="button"
      >
        Open support
      </button>
    </article>
  );
}

const privacyRequestConfig: Record<
  PrivacyRequestType,
  {
    helper: string;
    icon: "delete" | "export" | "question";
    label: string;
    message: string;
    title: string;
    tone?: "danger";
  }
> = {
  account_delete: {
    helper: "Request account closure and retention review",
    icon: "delete",
    label: "Delete account",
    message:
      "I want to request account deletion. Please review what can be deleted now and what minimum audit evidence must be retained.",
    title: "Account deletion request",
    tone: "danger",
  },
  data_export: {
    helper: "Request a copy of profile, sources, jobs, and materials",
    icon: "export",
    label: "Export my data",
    message:
      "I want to request an export of my account data, including profile data, uploaded source records, jobs, applications, and generated materials where available.",
    title: "Data export request",
  },
  drafts_delete: {
    helper: "Request deletion of editable sources and unsubmitted drafts",
    icon: "delete",
    label: "Delete sources/drafts",
    message:
      "I want to delete uploaded sources, editable profile data, generated master resume drafts, or other non-submitted drafts where deletion is allowed.",
    title: "Delete uploaded sources or drafts",
  },
  privacy_question: {
    helper: "Ask about privacy, retention, or support fallback",
    icon: "question",
    label: "Privacy request",
    message:
      "I have a privacy, retention, or data-handling question and want support to review it.",
    title: "Privacy support request",
  },
};

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
          All available credits have been used. Your workspace stays open;
          source reading, job analysis, generation, and exports resume after you
          add credits.
        </p>
      ) : null}
    </div>
  );
}

function CreditExhaustedNotice() {
  return (
    <section className="settings-credit-empty-state" aria-live="polite">
      <div>
        <p className="eyebrow">Credits</p>
        <h2>Your workspace is still yours.</h2>
        <p>
          You can keep reviewing saved profile details, jobs, applications,
          Library items, support history, and settings. Credit-consuming work
          pauses until you choose a pack.
        </p>
      </div>
      <div className="settings-credit-actions">
        <a className="settings-primary-link" href="#add-credits">
          Choose a credit pack
        </a>
        <a className="inline-link" href="/credits">
          How credits work
        </a>
      </div>
    </section>
  );
}

function HistoryList({
  emptyText,
  isLoading,
  rows,
  status,
  title,
}: {
  emptyText: string;
  isLoading: boolean;
  rows: CreditLedgerEvent[];
  status: string | null;
  title: string;
}) {
  return (
    <article className="settings-history-card">
      <div className="settings-history-title">
        <ReceiptText size={16} aria-hidden="true" />
        <h3>{title}</h3>
      </div>
      {isLoading ? (
        <p className="settings-history-empty">Loading history...</p>
      ) : null}
      {!isLoading && status ? (
        <p className="settings-history-empty danger">{status}</p>
      ) : null}
      {!isLoading && !status && rows.length === 0 ? (
        <p className="settings-history-empty">{emptyText}</p>
      ) : null}
      {!isLoading && !status && rows.length > 0 ? (
        <div className="settings-history-list">
          {rows.map((row) => (
            <div className="settings-history-row" key={row.id}>
              <div>
                <strong>{row.description}</strong>
                <p>
                  {row.resourceLabel} · {formatDate(row.createdAt)}
                </p>
              </div>
              <span className={row.amount > 0 ? "positive" : "negative"}>
                {row.amount > 0 ? "+" : ""}
                {row.amount}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

async function refreshHistory(
  setCreditHistory: (history: CreditHistory | null) => void,
  setHistoryStatus: (status: string | null) => void,
) {
  try {
    const response = await fetch("/api/billing/history");
    const payload = (await response.json()) as BillingHistoryResponse;

    if (!response.ok || !payload.history) {
      throw new Error(
        payload.error?.message ?? "Unable to refresh usage history.",
      );
    }

    setCreditHistory(payload.history);
  } catch (error) {
    setHistoryStatus(
      error instanceof Error
        ? error.message
        : "Unable to refresh usage history.",
    );
  }
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
