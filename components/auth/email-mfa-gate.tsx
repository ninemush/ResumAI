"use client";

import { useState } from "react";
import { ArrowRight, Loader2, MailCheck } from "lucide-react";

type EmailMfaGateProps = {
  email: string;
};

export function EmailMfaGate({ email }: EmailMfaGateProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(
    "Enter the 6-digit code we sent to your email to finish signing in.",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function verifyCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus(null);
    setIsSubmitting(true);

    const response = await fetch("/api/auth/verify-email-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const payload = await response.json().catch(() => null);

    setIsSubmitting(false);

    if (!response.ok) {
      setError(readAuthErrorMessage(payload));
      return;
    }

    window.location.reload();
  }

  async function resendCode() {
    setError(null);
    setStatus(null);
    setIsSubmitting(true);

    const response = await fetch("/api/auth/resend-email-code", { method: "POST" });
    const payload = await response.json().catch(() => null);

    setIsSubmitting(false);

    if (!response.ok) {
      setError(readAuthErrorMessage(payload));
      return;
    }

    setStatus("I sent a fresh code to your email.");
  }

  async function signOut() {
    await fetch("/api/auth/sign-out", { method: "POST" });
    window.location.reload();
  }

  return (
    <main className="auth-page centered-auth-page">
      <form className="auth-card email-mfa-card" onSubmit={verifyCode}>
        <div className="auth-card-intro">
          <span className="auth-section-icon">
            <MailCheck size={18} aria-hidden="true" />
          </span>
          <h1>Check your email</h1>
          <p>Pramania sent a 6-digit code to {email}. This keeps your career workspace protected.</p>
        </div>

        <label>
          Email code
          <input
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            name="email-code"
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            pattern="[0-9]{6}"
            placeholder="6-digit code"
            required
            type="text"
            value={code}
          />
        </label>

        {error ? <p className="form-message error">{error}</p> : null}
        {status ? <p className="form-message">{status}</p> : null}

        <button className="primary-action" disabled={isSubmitting} type="submit">
          {isSubmitting ? <Loader2 className="spin" size={18} /> : null}
          Verify code
          <ArrowRight size={18} aria-hidden="true" />
        </button>

        <div className="auth-secondary-actions">
          <button disabled={isSubmitting} onClick={() => void resendCode()} type="button">
            Resend code
          </button>
          <button disabled={isSubmitting} onClick={() => void signOut()} type="button">
            Sign out
          </button>
        </div>
      </form>
    </main>
  );
}

function readAuthErrorMessage(payload: unknown) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }

  return "The email code could not be verified. Please try again.";
}
