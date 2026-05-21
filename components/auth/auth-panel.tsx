"use client";

import { useState } from "react";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";

import { createClient } from "@/lib/supabase/browser";

type AuthMode = "sign-in" | "sign-up";

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

  return (
    <section className="auth-shell" aria-labelledby="auth-title">
      <div className="auth-copy">
        <div className="brand-mark" aria-hidden="true">
          RA
        </div>
        <p className="eyebrow">ResumAI workspace</p>
        <h1 id="auth-title">Build calmer, sharper job applications.</h1>
        <p>
          Sign in to enter the protected workspace. The next foundation step is
          profile building, resume intake, and job-post analysis on top of this
          secure shell.
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
      </form>
    </section>
  );
}
