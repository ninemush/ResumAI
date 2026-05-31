"use client";

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/browser";

export function ResetPasswordPanel() {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function updatePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    setIsSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setStatus("Password updated. You can return to Pramania and sign in.");
  }

  return (
    <main className="auth-page centered-auth-page">
      <form className="auth-card email-mfa-card" onSubmit={updatePassword}>
        <div className="auth-card-intro">
          <h1>Choose a new password</h1>
          <p>Use at least 8 characters. After this, sign in again and verify your email code.</p>
        </div>

        <label>
          New password
          <input
            autoComplete="new-password"
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
          Update password
          <ArrowRight size={18} aria-hidden="true" />
        </button>

        <div className="auth-secondary-actions">
          <Link href="/">Return to sign in</Link>
        </div>
      </form>
    </main>
  );
}
