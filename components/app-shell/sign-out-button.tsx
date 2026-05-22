"use client";

import { LogOut } from "lucide-react";

import { createClient } from "@/lib/supabase/browser";

type SignOutButtonProps = {
  compact?: boolean;
};

export function SignOutButton({ compact = false }: SignOutButtonProps) {
  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.reload();
  }

  return (
    <button
      aria-label={compact ? "Sign out" : undefined}
      className="icon-text-button"
      title={compact ? "Sign out" : undefined}
      type="button"
      onClick={signOut}
    >
      <LogOut size={17} aria-hidden="true" />
      {compact ? null : "Sign out"}
    </button>
  );
}
