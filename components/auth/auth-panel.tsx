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

import { brand } from "@/lib/brand";
import { createClient } from "@/lib/supabase/browser";

type AuthMode = "sign-in" | "sign-up";
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
    title: "Start messy",
    body: "Drop a resume, paste LinkedIn, or just write what happened. Pramania will help organize the signal.",
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

const outcomeItems = [
  "Structured career profile",
  "Role-fit guidance",
  "ATS-ready resume drafts",
  "Cover letters with your voice",
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
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const result =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              data: {
                full_name: fullName,
                name: fullName,
              },
            },
          });

    setIsSubmitting(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    if (mode === "sign-up") {
      await saveSignupProfileName(fullName);
      setStatus("Account created. Check your inbox if email confirmation is enabled.");
    }

    window.location.reload();
  }

  async function handleOAuthSignIn(provider: OAuthProviderId) {
    setError(null);
    setStatus(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
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
            height={500}
            priority
            src={brand.horizontalLogoPath}
            width={1800}
          />
        </div>
        <h1 id="auth-title">Turn your experience into a sharper career story.</h1>
        <p>
          Job searching is noisy. {brand.name} helps you build a private career profile,
          understand where you fit, and prepare thoughtful applications without losing
          your voice.
        </p>
        <div className="auth-outcome-strip" aria-label="What you get with Pramania">
          {outcomeItems.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
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
          <h2>{mode === "sign-in" ? "Welcome back" : "Create your workspace"}</h2>
          <p>
            {mode === "sign-in"
              ? "Pick up where your profile, applications, and career context left off."
              : "Start with a resume, LinkedIn link, or a messy note. Pramania will organize it with you."}
          </p>
        </div>
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

        {mode === "sign-up" ? (
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

        {error ? <p className="form-message error">{error}</p> : null}
        {status ? <p className="form-message">{status}</p> : null}

        <button className="primary-action" disabled={isSubmitting} type="submit">
          {isSubmitting ? <Loader2 className="spin" size={18} /> : null}
          {mode === "sign-in" ? "Enter workspace" : "Start my private profile"}
          <ArrowRight size={18} aria-hidden="true" />
        </button>

        <p className="auth-card-note">
          Built around how recruiters screen: clarity, fit, evidence, keywords, and momentum.
        </p>

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
        <h2 id="pricing-title">Simple tiers are coming.</h2>
        <p>
          Early access will focus on profile quality, application credits, and transparent limits.
          The product is being built so tiers can be configured without code changes.
        </p>
      </section>
    </div>
  );
}

async function saveSignupProfileName(fullName: string) {
  const normalizedName = fullName.trim();

  if (!normalizedName) {
    return;
  }

  await fetch("/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: normalizedName }),
  }).catch(() => undefined);
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
