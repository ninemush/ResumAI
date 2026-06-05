"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";

import {
  PRIVACY_POLICY_EFFECTIVE_DATE,
  PRIVACY_POLICY_VERSION,
  TERMS_EFFECTIVE_DATE,
  TERMS_VERSION,
} from "@/lib/legal/terms";
import { brand } from "@/lib/brand";

type TermsGateProps = {
  firstName: string | null;
};

export function TermsGate({ firstName }: TermsGateProps) {
  const [accepted, setAccepted] = useState(false);
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function accept() {
    setError(null);

    if (!accepted || !privacyAcknowledged) {
      setError("Please accept the current Terms and acknowledge the Privacy Policy to continue.");
      return;
    }

    setIsSaving(true);

    const response = await fetch("/api/legal/terms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        acceptedAt: new Date().toISOString(),
        version: TERMS_VERSION,
      }),
    }).catch(() => null);

    setIsSaving(false);

    if (!response?.ok) {
      setError("I could not save that acceptance yet. Please try again.");
      return;
    }

    window.location.reload();
  }

  async function declineAndSignOut() {
    await fetch("/api/auth/sign-out", { method: "POST" });
    window.location.reload();
  }

  return (
    <main className="terms-gate-page">
      <section className="terms-gate-card" aria-labelledby="terms-gate-title">
        <span className="terms-gate-icon" aria-hidden="true">
          <ShieldCheck size={22} />
        </span>
        <p className="eyebrow">Before You Continue</p>
        <h1 id="terms-gate-title">
          {firstName ? `${firstName}, one quick confirmation.` : "One quick confirmation."}
        </h1>
        <p>
          {brand.name} helps you draft and reason through career materials, but you
          stay responsible for reviewing, approving, and deciding how to use any
          output.
        </p>
        <div className="terms-version-card" aria-label="Legal version details">
          <span>Terms v{TERMS_VERSION} · Effective {TERMS_EFFECTIVE_DATE}</span>
          <span>
            Privacy v{PRIVACY_POLICY_VERSION} · Effective{" "}
            {PRIVACY_POLICY_EFFECTIVE_DATE}
          </span>
        </div>
        <label className="terms-consent terms-gate-consent">
          <input
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
            type="checkbox"
          />
          <span>
            I have read and agree to the{" "}
            <Link href="/terms" target="_blank">
              Terms and Conditions
            </Link>
            . I understand that I am responsible for verifying and approving all
            generated content before using it.
          </span>
        </label>
        <label className="terms-consent terms-gate-consent">
          <input
            checked={privacyAcknowledged}
            onChange={(event) => setPrivacyAcknowledged(event.target.checked)}
            type="checkbox"
          />
          <span>
            I acknowledge the{" "}
            <Link href="/privacy" target="_blank">
              Privacy Policy
            </Link>
            , including support-safe data handling, retention, and data-rights
            request paths.
          </span>
        </label>
        {error ? <p className="form-message error">{error}</p> : null}
        <button
          className="primary-action terms-gate-action"
          disabled={isSaving}
          onClick={() => void accept()}
          type="button"
        >
          {isSaving ? <Loader2 className="spin" size={18} /> : null}
          Continue to workspace
          <ArrowRight size={18} aria-hidden="true" />
        </button>
        <div className="terms-gate-secondary-actions">
          <Link href="/terms" target="_blank">
            Review changes
          </Link>
          <button disabled={isSaving} onClick={() => void declineAndSignOut()} type="button">
            Decline and sign out
          </button>
        </div>
      </section>
    </main>
  );
}
