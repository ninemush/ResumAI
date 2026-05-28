import "server-only";

import {
  buildProfileIntelligence,
  type ProfileIntelligence,
} from "@/lib/profile/profile-intelligence";
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
  storage_path: string | null;
  previewUrl: string | null;
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

export type ProfileMilestone = {
  complete: boolean;
  detail: string;
  key: string;
  label: string;
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
  intelligence: ProfileIntelligence;
  roleRecommendations: RoleRecommendation[];
  sourceCount: number;
  milestones: ProfileMilestone[];
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
      intelligence: buildProfileIntelligence({
        facts: [],
        profile: {
          headline: null,
          summary: null,
          target_direction: null,
          target_level: null,
        },
      }),
      roleRecommendations: [],
      sourceCount: 0,
      milestones: buildProfileMilestones({
        factCount: 0,
        hasHeadline: false,
        hasSummary: false,
        hasTargetDirection: false,
        hasTargetLevel: false,
        sourceCount: 0,
      }),
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
          "id, source_type, source_url, storage_path, original_filename, extraction_status, failure_reason, created_at",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20),
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
  const recentSourcesWithPreviews = await addSourcePreviewUrls(supabase, recentSources ?? []);
  const hasHeadline = Boolean(profile.headline);
  const hasSummary = Boolean(profile.summary);
  const hasTargetDirection = Boolean(profile.target_direction);
  const hasTargetLevel = Boolean(profile.target_level);
  const intelligence = buildProfileIntelligence({
    facts: profileFacts,
    profile: {
      headline: profile.headline,
      summary: profile.summary,
      target_direction: profile.target_direction,
      target_level: profile.target_level,
    },
  });

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
    recentSources: recentSourcesWithPreviews,
    intelligence,
    roleRecommendations: roleRecommendations ?? [],
    sourceCount: sourceCount ?? 0,
    milestones: buildProfileMilestones({
      factCount: profileFacts.length,
      hasHeadline,
      hasSummary,
      hasTargetDirection,
      hasTargetLevel,
      sourceCount: sourceCount ?? 0,
    }),
    readinessScore: calculateReadinessScore({
      factCount: profileFacts.length,
      hasHeadline,
      hasSummary,
      hasTargetDirection,
    }),
    tierName: readTierName(tierAssignments),
  };
}

async function addSourcePreviewUrls(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sources: Omit<ProfileSource, "previewUrl">[],
) {
  return Promise.all(
    sources.map(async (source) => ({
      ...source,
      previewUrl: ["docx", "image", "pdf", "txt", "linkedin"].includes(source.source_type)
        ? await createProfileSourceUrl(supabase, source.storage_path)
        : null,
    })),
  );
}

async function createProfileSourceUrl(
  supabase: Awaited<ReturnType<typeof createClient>>,
  storagePath: string | null,
) {
  if (!storagePath) {
    return null;
  }

  const { data, error } = await supabase.storage
    .from("profile-sources")
    .createSignedUrl(storagePath, 60 * 10);

  if (error) {
    return null;
  }

  return data.signedUrl;
}

function buildProfileMilestones({
  factCount,
  hasHeadline,
  hasSummary,
  hasTargetDirection,
  hasTargetLevel,
  sourceCount,
}: {
  factCount: number;
  hasHeadline: boolean;
  hasSummary: boolean;
  hasTargetDirection: boolean;
  hasTargetLevel: boolean;
  sourceCount: number;
}): ProfileMilestone[] {
  return [
    {
      complete: sourceCount > 0,
      detail: sourceCount > 0 ? `${sourceCount} source added` : "Add a resume, note, or profile link",
      key: "source",
      label: "Source",
    },
    {
      complete: factCount >= 5,
      detail: `${factCount} captured detail${factCount === 1 ? "" : "s"}`,
      key: "evidence",
      label: "Evidence",
    },
    {
      complete: hasTargetDirection && hasTargetLevel,
      detail: hasTargetDirection
        ? hasTargetLevel
          ? "Direction and level are set"
          : "Direction set, level still open"
        : "Choose a target lane",
      key: "direction",
      label: "Direction",
    },
    {
      complete: factCount >= 8,
      detail: `${factCount} proof point${factCount === 1 ? "" : "s"} captured`,
      key: "proof",
      label: "Proof",
    },
    {
      complete: hasHeadline && hasSummary,
      detail: hasSummary ? "Profile story drafted" : "Draft the positioning summary",
      key: "story",
      label: "Story",
    },
  ];
}

function calculateReadinessScore({
  factCount,
  hasHeadline,
  hasSummary,
  hasTargetDirection,
}: {
  factCount: number;
  hasHeadline: boolean;
  hasSummary: boolean;
  hasTargetDirection: boolean;
}) {
  const score =
    Math.min(factCount, 12) * 6 +
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
