"use client";

import { useState } from "react";
import {
  ArrowRight,
  Brain,
  Compass,
  FileText,
  Loader2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { Provider } from "@supabase/supabase-js";
import Image from "next/image";

import { CREDIT_PURCHASE_OPTIONS } from "@/lib/billing/credit-catalog";
import { brand } from "@/lib/brand";
import { TERMS_VERSION } from "@/lib/legal/terms";
import { createClient } from "@/lib/supabase/browser";

type AuthMode = "sign-in" | "sign-up" | "reset-password";
type OAuthProviderId = Provider;

const oauthProviders: Array<{
  id: OAuthProviderId;
  label: string;
  icon: "google" | "microsoft" | "linkedin";
}> = [
  { id: "google", label: "Google", icon: "google" },
  { id: "azure", label: "Microsoft", icon: "microsoft" },
  { id: "linkedin_oidc" as OAuthProviderId, label: "LinkedIn", icon: "linkedin" },
];

const authHighlights = [
  {
    icon: FileText,
    title: "Start with your story",
    body: "Share a resume, LinkedIn profile, or career note. Pramania will help turn it into clear, useful direction.",
  },
  {
    icon: Compass,
    title: "Find the strongest lane",
    body: "Get candid guidance on roles, level, keywords, gaps, and what hiring teams are likely to value.",
  },
  {
    icon: Sparkles,
    title: "Apply with clarity",
    body: "Create tailored, ATS-friendly materials grounded in your real experience and voice.",
  },
];

const featureHighlights = [
  {
    icon: Brain,
    title: "When your head is full, start anywhere",
    body: "Pramania can work from rough notes, resumes, job links, profile pages, or a spoken thought. You do not need to organize everything first.",
  },
  {
    icon: Compass,
    title: "Know what to aim for next",
    body: "Get a calm read on role fit, seniority, strengths, gaps, and the evidence hiring teams are likely to care about.",
  },
  {
    icon: ShieldCheck,
    title: "Apply without sounding generic",
    body: "Generate focused resumes and cover letters that stay grounded in your real experience and keep a hint of your voice.",
  },
];

const pageLinks = ["Overview", "Features", "Pricing"];

export function AuthPanel() {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailCodeTarget, setEmailCodeTarget] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus(null);

    if (emailCodeTarget) {
      await handleEmailCodeSubmit();
      return;
    }

    if (mode === "reset-password") {
      await handlePasswordResetRequest();
      return;
    }

    if (mode === "sign-up" && !termsAccepted) {
      setError("You need to accept the Terms and Conditions before creating an account.");
      return;
    }

    setIsSubmitting(true);

    const termsAcceptedAt = new Date().toISOString();
    const result =
      mode === "sign-in"
        ? await fetch("/api/auth/password-sign-in", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          }).then(async (response) => ({
            data: await response.json(),
            ok: response.ok,
          }))
        : await createClient()
          .auth.signUp({
            email,
            password,
            options: {
              data: {
                full_name: fullName,
                name: fullName,
                terms_accepted_at: termsAcceptedAt,
                terms_version: TERMS_VERSION,
              },
            },
          })
          .then((response) => ({
            data: response,
            ok: !response.error,
          }));

    setIsSubmitting(false);

    if (!result.ok) {
      setError(readAuthErrorMessage(result.data));
      return;
    }

    if (mode === "sign-in" && readRequiresEmailCode(result.data)) {
      setEmailCodeTarget(readEmailCodeTarget(result.data) ?? email);
      setPassword("");
      setStatus("I sent a 6-digit code to your email. Enter it to finish signing in.");
      return;
    }

    if (mode === "sign-up") {
      await saveSignupProfileName({
        fullName,
        termsAcceptedAt,
        termsVersion: TERMS_VERSION,
      });
      await createClient().auth.signOut();
      setMode("sign-in");
      setPassword("");
      setStatus("Account created. Sign in now and I will send an email code to verify this device.");
      return;
    }

    window.location.reload();
  }

  async function handlePasswordResetRequest() {
    setIsSubmitting(true);

    const supabase = createClient();
    const redirectTo = new URL("/auth/callback", window.location.origin);
    redirectTo.searchParams.set("next", "/auth/reset-password");
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectTo.toString(),
    });

    setIsSubmitting(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setStatus("Check your email for a secure password reset link.");
  }

  async function handleEmailCodeSubmit() {
    setIsSubmitting(true);

    const response = await fetch("/api/auth/verify-email-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: emailCode }),
    });
    const payload = await response.json().catch(() => null);

    setIsSubmitting(false);

    if (!response.ok) {
      setError(readAuthErrorMessage(payload));
      return;
    }

    window.location.reload();
  }

  async function resendEmailCode() {
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

  async function handleOAuthSignIn(provider: OAuthProviderId) {
    setError(null);
    setStatus(null);

    if (mode === "sign-up" && !termsAccepted) {
      setError("You need to accept the Terms and Conditions before creating an account.");
      return;
    }

    setIsSubmitting(true);

    const supabase = createClient();
    const redirectUrl = new URL("/auth/callback", window.location.origin);

    if (mode === "sign-up") {
      redirectUrl.searchParams.set("terms", "accepted");
      redirectUrl.searchParams.set("termsVersion", TERMS_VERSION);
      redirectUrl.searchParams.set("termsAcceptedAt", new Date().toISOString());
    }

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        scopes: provider === "azure" ? "email" : undefined,
        redirectTo: redirectUrl.toString(),
      },
    });

    setIsSubmitting(false);

    if (oauthError) {
      setError(oauthError.message);
    }
  }

  return (
    <div className="auth-page">
      <header className="auth-topbar" aria-label="Public navigation">
        <nav>
          {pageLinks.map((link) => (
            <a href={`#${link.toLowerCase()}`} key={link}>
              {link}
            </a>
          ))}
        </nav>
      </header>

      <section className="auth-shell" id="overview" aria-labelledby="auth-title">
      <div className="auth-copy">
        <div className="auth-hero-logo-frame">
          <Image
            alt={brand.logoAlt}
            className="auth-hero-logo"
            height={941}
            priority
            src={brand.horizontalLogoPath}
            width={1672}
          />
        </div>
        <h1 id="auth-title">Turn your experience into a sharper career story.</h1>
        <p>
          Job searching is noisy. {brand.name} helps you build a private career profile,
          understand where you fit, and prepare thoughtful applications without losing
          your voice.
        </p>
        <div className="auth-highlight-grid" aria-label={`${brand.name} helps you`}>
          {authHighlights.map((highlight) => {
            const Icon = highlight.icon;

            return (
              <article className="auth-highlight-card" key={highlight.title}>
                <span>
                  <Icon size={17} aria-hidden="true" />
                </span>
                <div>
                  <h2>{highlight.title}</h2>
                  <p>{highlight.body}</p>
                </div>
              </article>
            );
          })}
        </div>
        <div className="trust-note">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>Private by default. You approve what is saved, used, and exported.</span>
        </div>
      </div>

      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-card-intro">
          <h2>
            {emailCodeTarget
              ? "Check your email"
              : mode === "reset-password"
                ? "Reset your password"
                : mode === "sign-in"
                  ? "Welcome back"
                  : "Create your workspace"}
          </h2>
          <p>
            {emailCodeTarget
              ? `Enter the 6-digit code sent to ${emailCodeTarget}.`
              : mode === "reset-password"
                ? "Enter your email and we will send a secure reset link."
                : mode === "sign-in"
                  ? "Pick up where your profile, applications, and career context left off."
                  : "Start with a resume, LinkedIn link, or career note. Pramania will shape it with you."}
          </p>
        </div>
        {!emailCodeTarget && mode !== "reset-password" ? (
          <div className="segmented-control" aria-label="Authentication mode">
            <button
              className={mode === "sign-in" ? "active" : ""}
              type="button"
              onClick={() => setMode("sign-in")}
            >
              Sign in
            </button>
            <button
              className={mode === "sign-up" ? "active" : ""}
              type="button"
              onClick={() => setMode("sign-up")}
            >
              Create account
            </button>
          </div>
        ) : null}

        {!emailCodeTarget && mode === "sign-up" ? (
          <label>
            Full name
            <input
              autoComplete="name"
              name="name"
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Your full name"
              required
              type="text"
              value={fullName}
            />
          </label>
        ) : null}

        {!emailCodeTarget ? (
          <label>
          Email
          <input
            autoComplete="email"
            inputMode="email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
            type="email"
            value={email}
          />
          </label>
        ) : null}

        {!emailCodeTarget && mode !== "reset-password" ? (
          <label>
            Password
            <input
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              minLength={8}
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              required
              type="password"
              value={password}
            />
          </label>
        ) : null}

        {emailCodeTarget ? (
          <label>
            Email code
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              name="email-code"
              onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              pattern="[0-9]{6}"
              placeholder="6-digit code"
              required
              type="text"
              value={emailCode}
            />
          </label>
        ) : null}

        {!emailCodeTarget && mode === "sign-up" ? (
          <label className="terms-consent">
            <input
              checked={termsAccepted}
              onChange={(event) => setTermsAccepted(event.target.checked)}
              type="checkbox"
            />
            <span>
              I have read and agree to the{" "}
              <a href="/terms" rel="noreferrer" target="_blank">
                Terms and Conditions
              </a>
              {" "}and acknowledge the{" "}
              <a href="/privacy" rel="noreferrer" target="_blank">
                Privacy Policy
              </a>
              . I understand I am responsible for reviewing and approving all
              generated content before using it.
            </span>
          </label>
        ) : null}

        {error ? <p className="form-message error">{error}</p> : null}
        {status ? <p className="form-message">{status}</p> : null}

        <button className="primary-action" disabled={isSubmitting} type="submit">
          {isSubmitting ? <Loader2 className="spin" size={18} /> : null}
          {emailCodeTarget
            ? "Verify code"
            : mode === "reset-password"
              ? "Send reset link"
              : mode === "sign-in"
                ? "Enter workspace"
                : "Start my private profile"}
          <ArrowRight size={18} aria-hidden="true" />
        </button>

        <div className="auth-secondary-actions">
          {emailCodeTarget ? (
            <>
              <button disabled={isSubmitting} onClick={() => void resendEmailCode()} type="button">
                Resend code
              </button>
              <button
                disabled={isSubmitting}
                onClick={() => {
                  setEmailCodeTarget(null);
                  setEmailCode("");
                  setStatus(null);
                }}
                type="button"
              >
                Back to sign in
              </button>
            </>
          ) : mode === "sign-in" ? (
            <button
              disabled={isSubmitting}
              onClick={() => {
                setMode("reset-password");
                setError(null);
                setStatus(null);
              }}
              type="button"
            >
              Forgot password?
            </button>
          ) : mode === "reset-password" ? (
            <button
              disabled={isSubmitting}
              onClick={() => {
                setMode("sign-in");
                setError(null);
                setStatus(null);
              }}
              type="button"
            >
              Back to sign in
            </button>
          ) : null}
        </div>

        <p className="auth-card-note">
          Built around how recruiters screen: clarity, fit, evidence, keywords, and momentum.
        </p>

        {!emailCodeTarget && mode !== "reset-password" ? (
          <>
            <div className="auth-divider">
              <span>or continue with</span>
            </div>

            <div className="oauth-grid" aria-label="Social sign in options">
              {oauthProviders.map((provider) => (
                <button
                  aria-label={`Continue with ${provider.label}`}
                  className="oauth-button"
                  disabled={isSubmitting}
                  key={provider.label}
                  onClick={() => void handleOAuthSignIn(provider.id)}
                  type="button"
                >
                  <ProviderIcon icon={provider.icon} />
                  <span>{provider.label}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}
        <p className="auth-legal-links">
          <a href="/terms" target="_blank" rel="noreferrer">
            Terms
          </a>
          <span aria-hidden="true">·</span>
          <a href="/privacy" target="_blank" rel="noreferrer">
            Privacy
          </a>
        </p>
      </form>
      </section>

      <section className="auth-section" id="features" aria-labelledby="features-title">
        <p className="eyebrow">Features</p>
        <h2 id="features-title">For the moments when job hunting feels heavy.</h2>
        <p>
          Whether you are actively searching, recovering from a layoff, or unsure how
          to explain your next move, Pramania helps turn the blur into a practical
          path forward.
        </p>
        <div className="auth-section-grid">
          {featureHighlights.map((feature) => {
            const Icon = feature.icon;

            return (
              <article key={feature.title}>
                <span className="auth-section-icon">
                  <Icon size={18} aria-hidden="true" />
                </span>
                <strong>{feature.title}</strong>
                <p>{feature.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="auth-section auth-pricing-section" id="pricing" aria-labelledby="pricing-title">
        <p className="eyebrow">Pricing</p>
        <h2 id="pricing-title">Pricing for a job search, not a forever subscription.</h2>
        <p>
          We know job hunting is usually a focused phase. Pramania uses credits so you can
          start with what you need, add more as you go, and stay in control. There are no
          automatic top-ups or surprise recurring charges.
        </p>
        <div className="auth-pricing-grid" aria-label="Credit packs">
          {CREDIT_PURCHASE_OPTIONS.map((option) => (
            <article className={option.recommended ? "auth-pricing-card recommended" : "auth-pricing-card"} key={option.productId}>
              <span>{option.label}</span>
              <strong>${option.priceUsd}</strong>
              <p>{option.credits} credits</p>
              <small>{option.description}</small>
              {option.recommended ? <em>Best value</em> : null}
            </article>
          ))}
        </div>
        <a className="inline-link" href="/credits" target="_blank" rel="noreferrer">
          See exactly how credits are used
        </a>
      </section>
    </div>
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

  return "Authentication could not be completed. Please try again.";
}

function readRequiresEmailCode(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("requiresEmailCode" in payload)) {
    return false;
  }

  return payload.requiresEmailCode === true;
}

function readEmailCodeTarget(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("email" in payload)) {
    return null;
  }

  return typeof payload.email === "string" ? payload.email : null;
}

async function saveSignupProfileName({
  fullName,
  termsAcceptedAt,
  termsVersion,
}: {
  fullName: string;
  termsAcceptedAt: string;
  termsVersion: string;
}) {
  const normalizedName = fullName.trim();

  await Promise.all([
    normalizedName
      ? fetch("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: normalizedName,
          }),
        }).catch(() => undefined)
      : Promise.resolve(undefined),
    termsAcceptedAt
      ? fetch("/api/legal/terms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            acceptedAt: termsAcceptedAt,
            version: termsVersion,
          }),
        }).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);
}

function ProviderIcon({ icon }: { icon: (typeof oauthProviders)[number]["icon"] }) {
  if (icon === "google") {
    return (
      <svg aria-hidden="true" className="provider-icon" viewBox="0 0 24 24">
        <path d="M21.6 12.23c0-.76-.07-1.49-.2-2.18H12v4.12h5.37a4.6 4.6 0 0 1-1.99 3.02v2.51h3.23c1.89-1.74 2.99-4.31 2.99-7.47Z" fill="#4285f4" />
        <path d="M12 22c2.7 0 4.97-.9 6.61-2.3l-3.23-2.51c-.9.6-2.04.95-3.38.95-2.6 0-4.81-1.76-5.6-4.13H3.06v2.59A9.98 9.98 0 0 0 12 22Z" fill="#34a853" />
        <path d="M6.4 14.01a6.01 6.01 0 0 1 0-3.82V7.6H3.06a10 10 0 0 0 0 8.99l3.34-2.58Z" fill="#fbbc05" />
        <path d="M12 6.07c1.47 0 2.78.5 3.82 1.49l2.86-2.86A9.62 9.62 0 0 0 12 2 9.98 9.98 0 0 0 3.06 7.6l3.34 2.59C7.19 7.82 9.4 6.07 12 6.07Z" fill="#ea4335" />
      </svg>
    );
  }

  if (icon === "microsoft") {
    return (
      <svg aria-hidden="true" className="provider-icon" viewBox="0 0 24 24">
        <path d="M3 3h8.5v8.5H3V3Z" fill="#f25022" />
        <path d="M12.5 3H21v8.5h-8.5V3Z" fill="#7fba00" />
        <path d="M3 12.5h8.5V21H3v-8.5Z" fill="#00a4ef" />
        <path d="M12.5 12.5H21V21h-8.5v-8.5Z" fill="#ffb900" />
      </svg>
    );
  }

  return <span className="provider-monogram" aria-hidden="true">in</span>;
}
