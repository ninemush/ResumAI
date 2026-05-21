"use client";

import { LogOut } from "lucide-react";

import { createClient } from "@/lib/supabase/browser";

export function SignOutButton() {
  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.reload();
  }

  return (
    <button className="icon-text-button" type="button" onClick={signOut}>
      <LogOut size={17} aria-hidden="true" />
      Sign out
    </button>
  );
}
