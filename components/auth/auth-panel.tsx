"use client";

import { useState } from "react";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import type { Provider } from "@supabase/supabase-js";
import Image from "next/image";

import { brand } from "@/lib/brand";
import { createClient } from "@/lib/supabase/browser";

type AuthMode = "sign-in" | "sign-up";
type OAuthProviderId = Provider;

const oauthProviders: Array<{
  id: OAuthProviderId;
  label: string;
  icon: "google" | "microsoft" | "apple" | "linkedin" | "facebook";
}> = [
  { id: "google", label: "Google", icon: "google" },
  { id: "azure", label: "Microsoft", icon: "microsoft" },
  { id: "apple", label: "Apple", icon: "apple" },
  { id: "linkedin_oidc" as OAuthProviderId, label: "LinkedIn", icon: "linkedin" },
  { id: "facebook", label: "Facebook", icon: "facebook" },
];

export function AuthPanel() {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
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
    const credentials = { email, password };
    const result =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword(credentials)
        : await supabase.auth.signUp(credentials);

    setIsSubmitting(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    if (mode === "sign-up") {
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
    <section className="auth-shell" aria-labelledby="auth-title">
      <div className="auth-copy">
        <Image
          alt={brand.logoAlt}
          className="auth-logo"
          height={221}
          priority
          src={brand.logoPath}
          width={600}
        />
        <p className="eyebrow">{brand.tagline}</p>
        <h1 id="auth-title">Career clarity, guided by intelligence.</h1>
        <p>
          Sign in to enter a private workspace for profile building, role clarity,
          resume tailoring, and thoughtful job applications.
        </p>
        <div className="trust-note">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>Private user data stays behind Supabase authentication and RLS.</span>
        </div>
      </div>

      <form className="auth-card" onSubmit={handleSubmit}>
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
          {mode === "sign-in" ? "Enter workspace" : "Create secure account"}
          <ArrowRight size={18} aria-hidden="true" />
        </button>

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
  );
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

  if (icon === "apple") {
    return (
      <svg aria-hidden="true" className="provider-icon monochrome" viewBox="0 0 24 24">
        <path d="M16.37 12.72c-.02-2.13 1.74-3.15 1.82-3.2-1-.46-2.55-.53-3.1-.54-1.32-.13-2.58.77-3.25.77-.68 0-1.72-.75-2.83-.73-1.46.02-2.81.85-3.56 2.16-1.52 2.64-.39 6.55 1.09 8.69.72 1.05 1.59 2.23 2.72 2.18 1.09-.04 1.5-.7 2.82-.7 1.31 0 1.69.7 2.84.68 1.17-.02 1.92-1.07 2.64-2.12.83-1.22 1.17-2.39 1.19-2.45-.03-.02-2.35-.9-2.38-4.74ZM14.22 7.6c.6-.73 1.01-1.74.9-2.75-.87.04-1.92.58-2.54 1.31-.56.65-1.04 1.68-.91 2.67.97.08 1.95-.5 2.55-1.23Z" fill="currentColor" />
      </svg>
    );
  }

  return <span className="provider-monogram" aria-hidden="true">{icon === "linkedin" ? "in" : "f"}</span>;
}
