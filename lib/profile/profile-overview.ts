import "server-only";

import {
  buildProfileIntelligence,
  type ProfileIntelligence,
} from "@/lib/profile/profile-intelligence";
import { extractExperienceSectionsFromText } from "@/lib/resumes/source-experience";
import { createClient } from "@/lib/supabase/server";

type ProfileFact = {
  id: string;
  fact_type: string;
  fact_value: string;
  confidence: number | null;
  source_ids: string[];
  user_confirmed: boolean;
  created_at: string;
};

type ProfileSource = {
  id: string;
  source_type: string;
  source_url: string | null;
  storage_path: string | null;
  downloadUrl: string | null;
  detectedCompanyNames: string[];
  detectedRoleCount: number;
  detectedRoleTitles: string[];
  extractedTextPreview: string | null;
  linkedFactCount: number;
  linkedFactTypes: string[];
  readableCharacterCount: number;
  previewUrl: string | null;
  original_filename: string | null;
  readinessLabel: string;
  valueBadges: string[];
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
        .select("id, fact_type, fact_value, confidence, source_ids, user_confirmed, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("profile_sources")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
      supabase
        .from("profile_sources")
        .select(
          "id, source_type, source_url, storage_path, original_filename, extracted_text, extraction_status, failure_reason, created_at",
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
  const recentSourcesWithPreviews = await addSourcePreviewUrls(supabase, recentSources ?? [], profileFacts);
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
  sources: (Omit<
    ProfileSource,
    | "detectedCompanyNames"
    | "detectedRoleCount"
    | "detectedRoleTitles"
    | "downloadUrl"
    | "extractedTextPreview"
    | "linkedFactCount"
    | "linkedFactTypes"
    | "previewUrl"
    | "readableCharacterCount"
    | "readinessLabel"
    | "valueBadges"
  > & {
    extracted_text?: string | null;
  })[],
  facts: ProfileFact[],
) {
  return Promise.all(
    sources.map(async ({ extracted_text: extractedText, ...source }) => {
      const detectedExperience = summarizeDetectedExperience(extractedText);
      const linkedFacts = facts.filter((fact) => fact.source_ids.includes(source.id));
      const linkedFactTypes = Array.from(new Set(linkedFacts.map((fact) => titleize(fact.fact_type)))).sort();
      const readableCharacterCount = extractedText?.replace(/\s+/g, " ").trim().length ?? 0;

      return {
        ...source,
        detectedCompanyNames: detectedExperience.companyNames,
        detectedRoleCount: detectedExperience.roleCount,
        detectedRoleTitles: detectedExperience.roleTitles,
        downloadUrl: source.storage_path ? `/api/profile/sources/${source.id}/download` : null,
        extractedTextPreview: formatSourceTextPreview(extractedText),
        linkedFactCount: linkedFacts.length,
        linkedFactTypes,
        readableCharacterCount,
        previewUrl: ["docx", "image", "pdf", "txt", "linkedin"].includes(source.source_type)
          ? await createProfileSourceUrl(supabase, source.storage_path)
          : null,
        readinessLabel: formatSourceReadinessLabel({
          extractionStatus: source.extraction_status,
          linkedFactCount: linkedFacts.length,
          readableCharacterCount,
        }),
        valueBadges: buildSourceValueBadges({
          detectedRoleCount: detectedExperience.roleCount,
          factTypes: linkedFactTypes,
          readableCharacterCount,
          sourceType: source.source_type,
        }),
      };
    }),
  );
}

function summarizeDetectedExperience(value: string | null | undefined) {
  const sections = value ? extractExperienceSectionsFromText(value) : [];

  return {
    companyNames: uniqueNonEmpty(sections.map((section) => section.company)).slice(0, 4),
    roleCount: sections.length,
    roleTitles: uniqueNonEmpty(sections.map((section) => section.roleTitle)).slice(0, 4),
  };
}

function formatSourceReadinessLabel({
  extractionStatus,
  linkedFactCount,
  readableCharacterCount,
}: {
  extractionStatus: string;
  linkedFactCount: number;
  readableCharacterCount: number;
}) {
  if (extractionStatus === "failed") return "Needs a clearer copy";
  if (extractionStatus === "processing" || extractionStatus === "pending") return "Reading";
  if (linkedFactCount > 0) return "Linked to profile";
  if (readableCharacterCount > 0) return "Readable evidence";
  return "Saved";
}

function buildSourceValueBadges({
  detectedRoleCount,
  factTypes,
  readableCharacterCount,
  sourceType,
}: {
  detectedRoleCount: number;
  factTypes: string[];
  readableCharacterCount: number;
  sourceType: string;
}) {
  const badges = new Set<string>();

  if (readableCharacterCount > 0) badges.add("Readable text");
  if (factTypes.length > 0) badges.add("Profile facts");
  if (detectedRoleCount > 0 || factTypes.some((type) => /experience|project/i.test(type))) {
    badges.add("Resume evidence");
    badges.add("Job-fit signal");
  }
  if (/credential|education|certification|accolade/i.test(factTypes.join(" "))) {
    badges.add("Credentials");
  }
  if (sourceType === "linkedin" || sourceType === "portfolio") {
    badges.add("Public profile");
  }

  return Array.from(badges).slice(0, 5);
}

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim();
    const key = normalized?.toLowerCase();

    if (!normalized || !key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(normalized);
  }

  return unique;
}

function formatSourceTextPreview(value: string | null | undefined) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  return normalized.length > 420 ? `${normalized.slice(0, 420)}...` : normalized;
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
      detail: factCount >= 5 ? "Enough background to draft from" : "Add role, scope, or achievement detail",
      key: "evidence",
      label: "Background",
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
      detail: factCount >= 8 ? "Ready to sharpen resume bullets" : "Add outcomes, metrics, or scope",
      key: "proof",
      label: "Impact",
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
