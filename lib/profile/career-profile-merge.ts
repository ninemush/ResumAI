import "server-only";

import {
  CAREER_PROFILE_SCHEMA_VERSION,
  canonicalCareerProfileSchema,
  createEmptyCanonicalCareerProfile,
  parsedProfileSourceSchema,
  type CanonicalCareerProfile,
  type CareerProfileConflict,
  type ParsedProfileSource,
} from "@/lib/profile/career-profile-schema";
import { createClient } from "@/lib/supabase/server";

type MergeCareerProfileInput = {
  lastSourceAnalysisId?: string | null;
  profileId: string;
  userId: string;
};

export type CareerProfileMergeFactRow = {
  confidence: number | null;
  evidence_status?: "user_confirmed" | "source_supported" | "inferred" | "conflict" | "missing_evidence" | null;
  fact_type: string;
  fact_value: string;
  id: string;
  source_ids: string[] | null;
  source_label?: string | null;
  source_type?: string | null;
  user_confirmed: boolean | null;
};

export type CareerProfileMergeProfileRow = {
  display_name: string | null;
  headline: string | null;
  id: string;
  summary: string | null;
  target_direction: string | null;
  target_level: string | null;
};

export type MergeCareerProfileResult = {
  careerProfile: CanonicalCareerProfile;
  careerProfileId: string;
  status: "draft" | "needs_review" | "ready" | "merge_failed" | "deleted";
  versionNumber: number;
};

export async function mergeCareerProfile({
  lastSourceAnalysisId = null,
  profileId,
  userId,
}: MergeCareerProfileInput): Promise<MergeCareerProfileResult> {
  const supabase = await createClient();
  const [
    { data: profile, error: profileError },
    { data: analyses, error: analysesError },
    { data: facts, error: factsError },
    { data: currentProfile, error: currentError },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, headline, summary, target_direction, target_level")
      .eq("id", profileId)
      .eq("user_id", userId)
      .single(),
    supabase
      .from("profile_source_analyses")
      .select("id, content_json, source_id, created_at")
      .eq("profile_id", profileId)
      .eq("user_id", userId)
      .eq("status", "analyzed")
      .order("created_at", { ascending: true })
      .limit(100),
    supabase
      .from("profile_facts")
      .select("id, fact_type, fact_value, confidence, evidence_status, source_ids, source_label, source_type, user_confirmed")
      .eq("profile_id", profileId)
      .eq("user_id", userId)
      .order("user_confirmed", { ascending: false })
      .order("confidence", { ascending: false })
      .limit(120),
    supabase
      .from("career_profiles")
      .select("id, content_json, version_number")
      .eq("profile_id", profileId)
      .eq("user_id", userId)
      .eq("is_current", true)
      .neq("status", "deleted")
      .maybeSingle(),
  ]);

  if (profileError || !profile) {
    throw new Error("PROFILE_NOT_FOUND");
  }

  if (analysesError) {
    throw new Error("PROFILE_SOURCE_ANALYSES_READ_FAILED");
  }

  if (factsError) {
    throw new Error("PROFILE_FACTS_READ_FAILED");
  }

  if (currentError) {
    throw new Error("CAREER_PROFILE_READ_FAILED");
  }

  const previous = currentProfile?.content_json
    ? canonicalCareerProfileSchema.safeParse(currentProfile.content_json).data ?? null
    : null;
  const parsedAnalyses = (analyses ?? [])
    .map((analysis) => parsedProfileSourceSchema.safeParse(analysis.content_json).data)
    .filter((analysis): analysis is ParsedProfileSource => Boolean(analysis));
  const careerProfile = buildCareerProfileFromEvidence({
    analyses: parsedAnalyses,
    facts: facts ?? [],
    previous,
    profile,
  });
  const status = careerProfile.conflicts.length > 0 || careerProfile.openQuestions.length > 0 ? "needs_review" : "ready";
  const nextVersion = (currentProfile?.version_number ?? 0) + 1;

  if (currentProfile?.id) {
    const { error: archiveError } = await supabase
      .from("career_profiles")
      .update({ is_current: false })
      .eq("id", currentProfile.id)
      .eq("user_id", userId);

    if (archiveError) {
      throw new Error("CAREER_PROFILE_ARCHIVE_FAILED");
    }
  }

  const { data: saved, error: saveError } = await supabase
    .from("career_profiles")
    .insert({
      content_json: careerProfile,
      is_current: true,
      last_source_analysis_id: lastSourceAnalysisId,
      merge_metadata: {
        analysisCount: parsedAnalyses.length,
        factCount: facts?.length ?? 0,
        preservedPreviousProfile: Boolean(previous),
      },
      profile_id: profileId,
      schema_version: CAREER_PROFILE_SCHEMA_VERSION,
      status,
      user_id: userId,
      version_number: nextVersion,
    })
    .select("id, version_number, status")
    .single();

  if (saveError || !saved) {
    throw new Error("CAREER_PROFILE_SAVE_FAILED");
  }

  await projectCareerProfileToProfileFields({
    careerProfile,
    profile,
    userId,
  });

  return {
    careerProfile,
    careerProfileId: saved.id,
    status: saved.status,
    versionNumber: saved.version_number,
  };
}

export function buildCareerProfileFromEvidence({
  analyses,
  facts,
  previous,
  profile,
}: {
  analyses: ParsedProfileSource[];
  facts: CareerProfileMergeFactRow[];
  previous: CanonicalCareerProfile | null;
  profile: CareerProfileMergeProfileRow;
}): CanonicalCareerProfile {
  const base = previous ?? createEmptyCanonicalCareerProfile();
  const conflicts: CareerProfileConflict[] = [...base.conflicts];
  const next = canonicalCareerProfileSchema.parse({
    ...createEmptyCanonicalCareerProfile(),
    ...base,
    contact: { ...base.contact },
    identity: {
      ...base.identity,
      fullName: base.identity.fullName ?? profile.display_name,
    },
    headline: base.headline ?? profile.headline,
    summaries: dedupe([...base.summaries, profile.summary].filter(isPresent)),
    targetDirection: base.targetDirection ?? profile.target_direction,
    targetLevel: base.targetLevel ?? profile.target_level,
  });

  for (const analysis of analyses) {
    mergeScalar(next.contact, "email", analysis.contact.email, conflicts, "contact.email");
    mergeScalar(next.contact, "phone", analysis.contact.phone, conflicts, "contact.phone");
    mergeScalar(next.contact, "linkedin", analysis.contact.linkedin, conflicts, "contact.linkedin");
    mergeScalar(next.contact, "location", analysis.contact.location, conflicts, "contact.location");
    mergeScalar(next.contact, "website", analysis.contact.website, conflicts, "contact.website");
    mergeScalar(next.identity, "fullName", analysis.identity.fullName, conflicts, "identity.fullName");
    mergeScalar(next.identity, "currentTitle", analysis.identity.currentTitle, conflicts, "identity.currentTitle");
    mergeScalar(next, "headline", analysis.headline, conflicts, "headline");
    mergeScalar(next, "targetDirection", analysis.targetDirection, conflicts, "targetDirection");
    mergeScalar(next, "targetLevel", analysis.targetLevel, conflicts, "targetLevel");

    next.summaries = dedupe([...next.summaries, ...analysis.summaries]);
    next.roleChronology = mergeRoles(next.roleChronology, analysis.roles, conflicts);
    next.responsibilities = dedupe([...next.responsibilities, ...analysis.roles.flatMap((role) => role.responsibilities)]);
    next.achievements = dedupe([...next.achievements, ...analysis.achievements, ...analysis.roles.flatMap((role) => role.achievements)]);
    next.metrics = dedupe([...next.metrics, ...analysis.metrics]);
    next.skills = dedupe([...next.skills, ...analysis.skills]);
    next.tools = dedupe([...next.tools, ...analysis.tools]);
    next.domains = dedupe([...next.domains, ...analysis.domains]);
    next.education = dedupe([...next.education, ...analysis.education]);
    next.certifications = dedupe([...next.certifications, ...analysis.certifications]);
    next.languages = dedupe([...next.languages, ...analysis.languages]);
    next.projects = dedupe([...next.projects, ...analysis.projects]);
    next.publications = dedupe([...next.publications, ...analysis.publications]);
    next.awards = dedupe([...next.awards, ...analysis.awards]);
    next.volunteering = dedupe([...next.volunteering, ...analysis.volunteering]);
    next.recommendations = dedupe([...next.recommendations, ...analysis.recommendations]);
    next.testimonials = dedupe([...next.testimonials, ...analysis.testimonials]);
    next.extraSections = mergeExtraSections(next.extraSections, analysis.extraSections);
    next.openQuestions = dedupe([...next.openQuestions, ...analysis.openQuestions]);
    next.evidence = [...next.evidence, ...analysis.evidence].slice(0, 120);
  }

  mergeFacts(next, facts, conflicts);
  next.conflicts = conflicts.slice(0, 80);

  return canonicalCareerProfileSchema.parse(next);
}

function mergeScalar<T extends Record<string, unknown>>(
  target: T,
  key: keyof T,
  value: string | null,
  conflicts: CareerProfileConflict[],
  field: string,
) {
  if (!value) {
    return;
  }

  const existing = typeof target[key] === "string" ? target[key] as string : null;

  if (!existing) {
    target[key] = value as T[keyof T];
    return;
  }

  if (normalizeComparable(existing) !== normalizeComparable(value)) {
    conflicts.push({
      evidence: [],
      existingValue: existing,
      field,
      incomingValue: value,
      reason: "Source-supported value differs from the current canonical value.",
    });
  }
}

function mergeRoles(
  existingRoles: CanonicalCareerProfile["roleChronology"],
  incomingRoles: ParsedProfileSource["roles"],
  conflicts: CareerProfileConflict[],
) {
  const roles = [...existingRoles];

  for (const incoming of incomingRoles) {
    const match = roles.find(
      (role) =>
        normalizeComparable(role.title) === normalizeComparable(incoming.title) &&
        normalizeComparable(role.company ?? "") === normalizeComparable(incoming.company ?? ""),
    );

    if (!match) {
      roles.push(incoming);
      continue;
    }

    if (incoming.dates && match.dates && normalizeComparable(incoming.dates) !== normalizeComparable(match.dates)) {
      conflicts.push({
        evidence: incoming.evidence,
        existingValue: match.dates,
        field: "roleChronology.dates",
        incomingValue: incoming.dates,
        reason: "A source gave different dates for an existing role.",
      });
    }

    match.achievements = dedupe([...match.achievements, ...incoming.achievements]);
    match.responsibilities = dedupe([...match.responsibilities, ...incoming.responsibilities]);
    match.evidence = [...match.evidence, ...incoming.evidence].slice(0, 20);
  }

  return roles.slice(0, 40);
}

function mergeExtraSections(
  existing: CanonicalCareerProfile["extraSections"],
  incoming: ParsedProfileSource["extraSections"],
) {
  const sections = [...existing];

  for (const section of incoming) {
    const match = sections.find((candidate) => normalizeComparable(candidate.title) === normalizeComparable(section.title));

    if (!match) {
      sections.push(section);
      continue;
    }

    match.items = dedupe([...match.items, ...section.items]);
    match.evidence = [...match.evidence, ...section.evidence].slice(0, 20);
  }

  return sections.slice(0, 40);
}

function mergeFacts(
  target: CanonicalCareerProfile,
  facts: CareerProfileMergeFactRow[],
  conflicts: CareerProfileConflict[],
) {
  for (const fact of facts) {
    const value = fact.fact_value.trim();

    if (!value) {
      continue;
    }

    const evidence = {
      confidence: fact.confidence,
      excerpt: value,
      evidenceStatus: fact.evidence_status ?? null,
      factId: fact.id,
      sourceId: fact.source_ids?.[0] ?? null,
      sourceLabel: fact.source_label ?? null,
      sourceType: fact.source_type ?? null,
    };

    if (!isTrustedFact(fact)) {
      if (fact.evidence_status === "conflict") {
        conflicts.push({
          evidence: [evidence],
          existingValue: null,
          field: fact.fact_type,
          incomingValue: value,
          reason: "Conflicting evidence needs review before it can shape the canonical profile.",
        });
      }
      if (fact.evidence_status === "missing_evidence" || fact.evidence_status === "inferred") {
        target.openQuestions = dedupe([
          ...target.openQuestions,
          `Can we confirm this ${fact.fact_type.replace(/_/g, " ")} claim with a source: ${value}?`,
        ]);
      }
      target.evidence.push(evidence);
      continue;
    }

    if (fact.fact_type === "skill") target.skills = dedupe([...target.skills, value]);
    if (fact.fact_type === "credential") target.certifications = dedupe([...target.certifications, value]);
    if (fact.fact_type === "education") target.education = dedupe([...target.education, value]);
    if (fact.fact_type === "project") target.projects = dedupe([...target.projects, value]);
    if (fact.fact_type === "accolade") target.awards = dedupe([...target.awards, value]);
    if (fact.fact_type === "industry") target.domains = dedupe([...target.domains, value]);
    if (fact.fact_type === "experience") {
      target.achievements = dedupe([...target.achievements, value]);
    }

    target.evidence.push(evidence);

    if (fact.user_confirmed) {
      continue;
    }

    if (fact.fact_type === "credential" && target.certifications.some((item) => normalizeComparable(item) !== normalizeComparable(value))) {
      conflicts.push({
        evidence: [evidence],
        existingValue: target.certifications[0] ?? null,
        field: "certifications",
        incomingValue: value,
        reason: "Unconfirmed credential evidence needs review before resume use.",
      });
    }
  }
}

function isTrustedFact(fact: CareerProfileMergeFactRow) {
  return (
    fact.user_confirmed === true ||
    fact.evidence_status === "user_confirmed" ||
    fact.evidence_status === "source_supported"
  );
}

async function projectCareerProfileToProfileFields({
  careerProfile,
  profile,
  userId,
}: {
  careerProfile: CanonicalCareerProfile;
  profile: CareerProfileMergeProfileRow;
  userId: string;
}) {
  const supabase = await createClient();
  const updates = {
    display_name: profile.display_name ?? careerProfile.identity.fullName,
    headline: profile.headline ?? careerProfile.headline ?? careerProfile.identity.currentTitle,
    summary: profile.summary ?? careerProfile.summaries[0] ?? null,
    target_direction: profile.target_direction ?? careerProfile.targetDirection,
    target_level: profile.target_level ?? careerProfile.targetLevel,
  };

  const hasUpdate = Object.values(updates).some(Boolean);

  if (!hasUpdate) {
    return;
  }

  await supabase
    .from("profiles")
    .update(updates)
    .eq("id", profile.id)
    .eq("user_id", userId);
}

function dedupe(values: string[]) {
  const seen = new Set<string>();

  return values.filter((value) => {
    const normalized = value.trim();
    const key = normalizeComparable(normalized);

    if (!normalized || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function normalizeComparable(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function isPresent(value: string | null | undefined): value is string {
  return Boolean(value?.trim());
}
