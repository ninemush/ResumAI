import "server-only";

import { z } from "zod";

import { PRIVACY_POLICY_VERSION, TERMS_VERSION } from "@/lib/legal/terms";
import { createClient } from "@/lib/supabase/server";

export const acceptTermsSchema = z.object({
  acceptedAt: z.string().datetime().optional(),
  version: z.string().trim().max(40).default(TERMS_VERSION),
});

export async function acceptTerms(input: z.input<typeof acceptTermsSchema>) {
  const parsed = acceptTermsSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const acceptedAt = parsed.acceptedAt ?? new Date().toISOString();
  const { data: profile, error } = await supabase
    .from("profiles")
    .upsert(
      {
        privacy_policy_accepted_at: acceptedAt,
        privacy_policy_version: PRIVACY_POLICY_VERSION,
        user_id: user.id,
        terms_accepted_at: acceptedAt,
        terms_version: parsed.version,
      },
      { onConflict: "user_id" },
    )
    .select("id, terms_accepted_at, terms_version")
    .single();

  if (error || !profile) {
    throw new Error("TERMS_ACCEPTANCE_FAILED");
  }

  return {
    id: profile.id,
    termsAcceptedAt: profile.terms_accepted_at as string,
    termsVersion: profile.terms_version as string,
  };
}
