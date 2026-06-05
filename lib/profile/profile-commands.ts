import "server-only";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export const updateProfileDraftSchema = z.object({
  displayName: z.string().trim().max(120).nullable().optional(),
  headline: z.string().trim().max(180).nullable().optional(),
  photoStoragePath: z.string().trim().max(700).nullable().optional(),
  summary: z.string().trim().max(900).nullable().optional(),
  targetDirection: z.string().trim().max(240).nullable().optional(),
  targetLevel: z.string().trim().max(120).nullable().optional(),
});

export const confirmProfileFactSchema = z.object({
  factId: z.string().uuid(),
});

export const updateProfileFactSchema = confirmProfileFactSchema.extend({
  value: z.string().trim().min(2).max(500),
});

export const acknowledgeRoleRecommendationSchema = z.object({
  recommendationId: z.string().uuid(),
});

export async function updateProfileDraft(input: z.input<typeof updateProfileDraftSchema>) {
  const parsed = updateProfileDraftSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const patch = {
    display_name: normalizeOptionalText(parsed.displayName),
    headline: normalizeOptionalText(parsed.headline),
    photo_storage_path: normalizePhotoStoragePath(parsed.photoStoragePath, user.id),
    summary: normalizeOptionalText(parsed.summary),
    target_direction: normalizeOptionalText(parsed.targetDirection),
    target_level: normalizeOptionalText(parsed.targetLevel),
    profile_status: "needs_review",
  };
  const compactPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );

  const { data: profile, error } = await supabase
    .from("profiles")
    .upsert(
      {
        user_id: user.id,
        ...compactPatch,
      },
      { onConflict: "user_id" },
    )
    .select("id")
    .single();

  if (error || !profile) {
    throw new Error("PROFILE_UPDATE_FAILED");
  }

  return { id: profile.id };
}

function normalizePhotoStoragePath(value: string | null | undefined, userId: string) {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    return normalized;
  }

  if (!normalized.startsWith(`${userId}/`)) {
    throw new Error("INVALID_PHOTO_STORAGE_PATH");
  }

  return normalized;
}

export async function confirmProfileFact(input: z.input<typeof confirmProfileFactSchema>) {
  const parsed = confirmProfileFactSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { data: fact, error } = await supabase
    .from("profile_facts")
    .update({
      evidence_status: "user_confirmed",
      origin: "confirmed",
      user_confirmed: true,
    })
    .eq("id", parsed.factId)
    .eq("user_id", user.id)
    .select("id")
    .single();

  if (error || !fact) {
    throw new Error("PROFILE_FACT_NOT_FOUND");
  }

  return { id: fact.id };
}

export async function updateProfileFact(input: z.input<typeof updateProfileFactSchema>) {
  const parsed = updateProfileFactSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { data: fact, error } = await supabase
    .from("profile_facts")
    .update({
      evidence_status: "user_confirmed",
      fact_value: parsed.value,
      origin: "confirmed",
      user_confirmed: true,
    })
    .eq("id", parsed.factId)
    .eq("user_id", user.id)
    .select("id")
    .single();

  if (error || !fact) {
    throw new Error("PROFILE_FACT_NOT_FOUND");
  }

  return { id: fact.id };
}

export async function deleteProfileFact(input: z.input<typeof confirmProfileFactSchema>) {
  const parsed = confirmProfileFactSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { data: fact, error } = await supabase
    .from("profile_facts")
    .delete()
    .eq("id", parsed.factId)
    .eq("user_id", user.id)
    .select("id")
    .single();

  if (error || !fact) {
    throw new Error("PROFILE_FACT_NOT_FOUND");
  }

  return { id: fact.id };
}

export async function acknowledgeRoleRecommendation(
  input: z.input<typeof acknowledgeRoleRecommendationSchema>,
) {
  const parsed = acknowledgeRoleRecommendationSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { data: recommendation, error: recommendationError } = await supabase
    .from("role_recommendations")
    .update({ user_acknowledged: true })
    .eq("id", parsed.recommendationId)
    .eq("user_id", user.id)
    .select("id, profile_id, role_family, seniority_level")
    .single();

  if (recommendationError || !recommendation) {
    throw new Error("ROLE_RECOMMENDATION_NOT_FOUND");
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      profile_status: "ready",
      target_direction: recommendation.role_family,
      target_level: recommendation.seniority_level,
    })
    .eq("id", recommendation.profile_id)
    .eq("user_id", user.id);

  if (profileError) {
    throw new Error("PROFILE_DIRECTION_UPDATE_FAILED");
  }

  return { id: recommendation.id };
}

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value?.trim();
  return normalized ? normalized : null;
}
