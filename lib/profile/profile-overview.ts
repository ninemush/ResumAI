import "server-only";

import { createClient } from "@/lib/supabase/server";

type ProfileFact = {
  id: string;
  fact_type: string;
  fact_value: string;
  confidence: number | null;
  user_confirmed: boolean;
  created_at: string;
};

type ProfileSource = {
  id: string;
  source_type: string;
  source_url: string | null;
  original_filename: string | null;
  extraction_status: string;
  failure_reason: string | null;
  created_at: string;
};

type RoleRecommendation = {
  id: string;
  role_family: string;
  role_titles: string[];
  seniority_level: string | null;
  rationale: string;
  assumptions: string[];
  open_questions: string[];
  confidence: number | null;
  user_acknowledged: boolean;
  created_at: string;
};

export type ProfileOverview = {
  profile: {
    id: string;
    displayName: string | null;
    headline: string | null;
    photoStoragePath: string | null;
    photoUrl: string | null;
    summary: string | null;
    targetDirection: string | null;
    targetLevel: string | null;
    status: string;
  } | null;
  factsByType: Record<string, ProfileFact[]>;
  factCount: number;
  confirmedFactCount: number;
  recentSources: ProfileSource[];
  roleRecommendations: RoleRecommendation[];
  sourceCount: number;
  readinessScore: number;
  tierName: string | null;
};

export async function getProfileOverview(userId: string): Promise<ProfileOverview> {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id, display_name, headline, photo_storage_path, summary, target_direction, target_level, profile_status",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (!profile) {
    return {
      profile: null,
      factsByType: {},
      factCount: 0,
      confirmedFactCount: 0,
      recentSources: [],
      roleRecommendations: [],
      sourceCount: 0,
      readinessScore: 0,
      tierName: null,
    };
  }

  const [
    { data: facts },
    { count: sourceCount },
    { data: recentSources },
    { data: roleRecommendations },
    { data: tierAssignments },
  ] =
    await Promise.all([
      supabase
        .from("profile_facts")
        .select("id, fact_type, fact_value, confidence, user_confirmed, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("profile_sources")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
      supabase
        .from("profile_sources")
        .select(
          "id, source_type, source_url, original_filename, extraction_status, failure_reason, created_at",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("role_recommendations")
        .select(
          "id, role_family, role_titles, seniority_level, rationale, assumptions, open_questions, confidence, user_acknowledged, created_at",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(3),
      supabase
        .from("user_tiers")
        .select("tiers(name)")
        .eq("user_id", userId)
        .eq("status", "active")
        .limit(1),
    ]);

  const profileFacts = facts ?? [];
  const factsByType = profileFacts.reduce<Record<string, ProfileFact[]>>(
    (groups, fact) => {
      const type = titleize(fact.fact_type);
      groups[type] = [...(groups[type] ?? []), fact];
      return groups;
    },
    {},
  );
  const confirmedFactCount = profileFacts.filter((fact) => fact.user_confirmed).length;
  const photoUrl = await createProfilePhotoUrl(supabase, profile.photo_storage_path);

  return {
    profile: {
      id: profile.id,
      displayName: profile.display_name,
      headline: profile.headline,
      photoStoragePath: profile.photo_storage_path,
      photoUrl,
      summary: profile.summary,
      targetDirection: profile.target_direction,
      targetLevel: profile.target_level,
      status: profile.profile_status,
    },
    factsByType,
    factCount: profileFacts.length,
    confirmedFactCount,
    recentSources: recentSources ?? [],
    roleRecommendations: roleRecommendations ?? [],
    sourceCount: sourceCount ?? 0,
    readinessScore: calculateReadinessScore({
      factCount: profileFacts.length,
      confirmedFactCount,
      hasHeadline: Boolean(profile.headline),
      hasSummary: Boolean(profile.summary),
      hasTargetDirection: Boolean(profile.target_direction),
    }),
    tierName: readTierName(tierAssignments),
  };
}

function calculateReadinessScore({
  factCount,
  confirmedFactCount,
  hasHeadline,
  hasSummary,
  hasTargetDirection,
}: {
  factCount: number;
  confirmedFactCount: number;
  hasHeadline: boolean;
  hasSummary: boolean;
  hasTargetDirection: boolean;
}) {
  const score =
    Math.min(factCount, 12) * 4 +
    Math.min(confirmedFactCount, 8) * 3 +
    (hasHeadline ? 12 : 0) +
    (hasSummary ? 12 : 0) +
    (hasTargetDirection ? 16 : 0);

  return Math.min(100, score);
}

async function createProfilePhotoUrl(
  supabase: Awaited<ReturnType<typeof createClient>>,
  storagePath: string | null,
) {
  if (!storagePath) {
    return null;
  }

  const { data, error } = await supabase.storage
    .from("profile-photos")
    .createSignedUrl(storagePath, 60 * 10);

  if (error) {
    return null;
  }

  return data.signedUrl;
}

function readTierName(
  tierAssignments: { tiers: { name: string } | { name: string }[] | null }[] | null,
) {
  const tier = tierAssignments?.[0]?.tiers;

  if (Array.isArray(tier)) {
    return tier[0]?.name ?? null;
  }

  return tier?.name ?? null;
}

function titleize(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
