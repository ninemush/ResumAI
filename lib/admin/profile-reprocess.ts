import "server-only";

import { z } from "zod";

import { logAdminUserAccesses } from "@/lib/admin/access-audit";
import {
  buildCareerProfileFromEvidence,
  type CareerProfileMergeFactRow,
  type CareerProfileMergeProfileRow,
} from "@/lib/profile/career-profile-merge";
import {
  CAREER_PROFILE_SCHEMA_VERSION,
  PROFILE_SOURCE_ANALYSIS_SCHEMA_VERSION,
  canonicalCareerProfileSchema,
  parsedProfileSourceSchema,
  type CanonicalCareerProfile,
  type ParsedProfileSource,
} from "@/lib/profile/career-profile-schema";
import {
  PROFILE_SOURCE_ANALYSIS_MODEL,
  PROFILE_SOURCE_ANALYSIS_PROMPT_VERSION,
  buildAnalysisWarnings,
  estimateSourceConfidence,
  parseProfileSourceText,
} from "@/lib/profile/profile-source-analysis";
import {
  enrichMasterResumeWithOptionalSourceEvidence,
  type SourceEvidence,
} from "@/lib/resumes/master-resume";
import { parseResumeContent, type ResumeContent } from "@/lib/resumes/resume-content";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const adminProfileReprocessSchema = z
  .object({
    dryRun: z.boolean().default(true),
    limit: z.number().int().min(1).max(500).default(250),
    repairMasterResumes: z.boolean().default(true),
    userId: z.string().trim().uuid().optional(),
  })
  .default({
    dryRun: true,
    limit: 250,
    repairMasterResumes: true,
  });

type ProfileSourceRow = {
  created_at: string | null;
  extracted_text: string | null;
  id: string;
  original_filename: string | null;
  profile_id: string;
  source_type: string;
  source_url: string | null;
  updated_at: string | null;
  user_id: string;
};

type AnalysisRow = {
  content_json: unknown;
  id: string;
  source_id: string;
};

type CurrentCareerProfileRow = {
  content_json: unknown;
  id: string;
  version_number: number;
};

type LatestMasterResumeRow = {
  content_json: unknown;
  docx_storage_path: string | null;
  id: string;
  pdf_storage_path: string | null;
  status: string;
};

export type ProfileReprocessReport = {
  careerProfileChanged: boolean;
  latestResumeChanged: boolean;
  parsedProjectCount: number;
  profileId: string;
  sourceCount: number;
  sourceFailures: number;
  sourcesAnalyzed: number;
  userId: string;
};

export type ProfileReprocessResult = {
  auditEventId: string | null;
  careerProfilesChanged: number;
  dryRun: boolean;
  hasMore: boolean;
  latestMasterResumesChanged: number;
  parsedProjectCount: number;
  profilesScanned: number;
  repairMasterResumes: boolean;
  reports: ProfileReprocessReport[];
  sourceFailures: number;
  sourcesAnalyzed: number;
  targets: {
    limit: number;
    userId: string | null;
  };
};

export async function reprocessProfileEvidenceWithServiceRole(
  input: z.input<typeof adminProfileReprocessSchema>,
  options: {
    actorUserId?: string | null;
  } = {},
): Promise<ProfileReprocessResult> {
  return runProfileEvidenceReprocess(adminProfileReprocessSchema.parse(input), {
    actorUserId: options.actorUserId ?? null,
  });
}

export async function reprocessProfileEvidenceForUsers(
  input: z.input<typeof adminProfileReprocessSchema>,
): Promise<ProfileReprocessResult> {
  const parsed = adminProfileReprocessSchema.parse(input);
  const sessionClient = await createClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user) {
    throw new Error("ADMIN_REQUIRED");
  }

  const { data: isAdmin, error: adminError } = await sessionClient.rpc("is_admin");

  if (adminError || !isAdmin) {
    throw new Error("ADMIN_REQUIRED");
  }

  return runProfileEvidenceReprocess(parsed, {
    actorUserId: user.id,
    accessAuditClient: sessionClient,
  });
}

async function runProfileEvidenceReprocess(
  parsed: z.output<typeof adminProfileReprocessSchema>,
  {
    accessAuditClient,
    actorUserId,
  }: {
    accessAuditClient?: Awaited<ReturnType<typeof createClient>>;
    actorUserId: string | null;
  },
): Promise<ProfileReprocessResult> {
  const adminClient = createAdminClient();
  const profiles = await readTargetProfiles(adminClient, {
    limit: parsed.limit,
    userId: parsed.userId,
  });
  const reports: ProfileReprocessReport[] = [];

  for (const profile of profiles) {
    reports.push(
      await reprocessProfile({
        adminClient,
        dryRun: parsed.dryRun,
        profile,
        repairMasterResumes: parsed.repairMasterResumes,
      }),
    );
  }

  await logAdminUserAccesses({
    accessReason: parsed.dryRun ? "admin_profile_reprocess_dry_run" : "admin_profile_reprocess_apply",
    actorUserId,
    metadata: {
      dryRun: parsed.dryRun,
      limit: parsed.limit,
      profileCount: profiles.length,
      repairMasterResumes: parsed.repairMasterResumes,
      userId: parsed.userId ?? null,
    },
    resourceType: "profile_source_reprocess",
    supabase: accessAuditClient ?? adminClient,
    targetUserIds: profiles.map((profile) => profile.user_id),
    visibilityLevel: "sensitive_source_review",
  });

  let auditEventId: string | null = null;
  const changedReports = reports.filter(
    (report) => report.careerProfileChanged || report.latestResumeChanged,
  );

  if (!parsed.dryRun && changedReports.length > 0) {
    const { data: auditEvent, error: auditError } = await adminClient
      .from("audit_events")
      .insert({
        actor_user_id: actorUserId,
        event_type: "admin.profile_reprocess.applied",
        metadata: {
          careerProfilesChanged: changedReports.filter((report) => report.careerProfileChanged).length,
          latestMasterResumesChanged: changedReports.filter((report) => report.latestResumeChanged).length,
          parsedProjectCount: sumReports(reports, "parsedProjectCount"),
          profileCount: profiles.length,
          repairMasterResumes: parsed.repairMasterResumes,
          reports: changedReports.slice(0, 100),
          sourceCount: sumReports(reports, "sourceCount"),
          sourceFailures: sumReports(reports, "sourceFailures"),
          sourcesAnalyzed: sumReports(reports, "sourcesAnalyzed"),
          userId: parsed.userId ?? null,
        },
        resource_id: changedReports[0]?.profileId ?? null,
        resource_type: "profile_source_reprocess",
        user_id: parsed.userId ?? null,
      })
      .select("id")
      .single();

    if (auditError || !auditEvent) {
      throw new Error("PROFILE_REPROCESS_AUDIT_FAILED");
    }

    auditEventId = auditEvent.id;
  }

  return {
    auditEventId,
    careerProfilesChanged: reports.filter((report) => report.careerProfileChanged).length,
    dryRun: parsed.dryRun,
    hasMore: profiles.length === parsed.limit && !parsed.userId,
    latestMasterResumesChanged: reports.filter((report) => report.latestResumeChanged).length,
    parsedProjectCount: sumReports(reports, "parsedProjectCount"),
    profilesScanned: profiles.length,
    repairMasterResumes: parsed.repairMasterResumes,
    reports: reports
      .filter(
        (report) =>
          report.careerProfileChanged ||
          report.latestResumeChanged ||
          report.parsedProjectCount > 0 ||
          report.sourceFailures > 0,
      )
      .slice(0, 100),
    sourcesAnalyzed: sumReports(reports, "sourcesAnalyzed"),
    sourceFailures: sumReports(reports, "sourceFailures"),
    targets: {
      limit: parsed.limit,
      userId: parsed.userId ?? null,
    },
  };
}

async function reprocessProfile({
  adminClient,
  dryRun,
  profile,
  repairMasterResumes,
}: {
  adminClient: ReturnType<typeof createAdminClient>;
  dryRun: boolean;
  profile: CareerProfileMergeProfileRow & { user_id: string };
  repairMasterResumes: boolean;
}): Promise<ProfileReprocessReport> {
  const [sources, existingAnalyses, facts, currentProfile] = await Promise.all([
    readProfileSources(adminClient, profile),
    readExistingAnalyses(adminClient, profile),
    readProfileFacts(adminClient, profile),
    readCurrentCareerProfile(adminClient, profile),
  ]);
  const parsedSourceResults = parseSourceRows(sources);
  const parsedSources = parsedSourceResults.parsedSources;
  const parsedExistingAnalyses = existingAnalyses
    .map((analysis) => parsedProfileSourceSchema.safeParse(analysis.content_json).data)
    .filter((analysis): analysis is ParsedProfileSource => Boolean(analysis));
  const previous = currentProfile?.content_json
    ? canonicalCareerProfileSchema.safeParse(currentProfile.content_json).data ?? null
    : null;
  const nextCareerProfile = buildCareerProfileFromEvidence({
    analyses: [...parsedExistingAnalyses, ...parsedSources.map((result) => result.parsed)],
    facts,
    previous,
    profile,
  });
  const careerProfileChanged = didCareerProfileChange(previous, nextCareerProfile);
  let latestResumeChanged = false;
  let lastSourceAnalysisId: string | null = null;

  if (!dryRun) {
    for (const result of parsedSources) {
      const analysisId = await insertSourceAnalysis(adminClient, result.source, result.parsed);
      lastSourceAnalysisId = analysisId;
    }

    if (careerProfileChanged || !currentProfile) {
      await saveCurrentCareerProfile(adminClient, {
        currentProfile,
        lastSourceAnalysisId,
        nextCareerProfile,
        profile,
      });
    }

    await projectCareerProfileFields(adminClient, profile, nextCareerProfile);
  }

  if (repairMasterResumes) {
    latestResumeChanged = await repairLatestMasterResume(adminClient, {
      dryRun,
      nextCareerProfile,
      profile,
      sources,
    });
  }

  return {
    careerProfileChanged,
    latestResumeChanged,
    parsedProjectCount: parsedSources.reduce((total, result) => total + result.parsed.projects.length, 0),
    profileId: profile.id,
    sourceCount: sources.length,
    sourceFailures: parsedSourceResults.sourceFailures,
    sourcesAnalyzed: parsedSources.length,
    userId: profile.user_id,
  };
}

async function readTargetProfiles(
  adminClient: ReturnType<typeof createAdminClient>,
  { limit, userId }: { limit: number; userId?: string },
) {
  let query = adminClient
    .from("profiles")
    .select("id, user_id, display_name, headline, summary, target_direction, target_level")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error("PROFILE_REPROCESS_PROFILE_READ_FAILED");
  }

  return (data ?? []) as (CareerProfileMergeProfileRow & { user_id: string })[];
}

async function readProfileSources(
  adminClient: ReturnType<typeof createAdminClient>,
  profile: CareerProfileMergeProfileRow & { user_id: string },
) {
  const { data, error } = await adminClient
    .from("profile_sources")
    .select("id, user_id, profile_id, source_type, source_url, original_filename, extracted_text, created_at, updated_at")
    .eq("profile_id", profile.id)
    .eq("user_id", profile.user_id)
    .not("extracted_text", "is", null)
    .neq("extraction_status", "deleted")
    .order("updated_at", { ascending: false })
    .limit(30);

  if (error) {
    throw new Error("PROFILE_REPROCESS_SOURCE_READ_FAILED");
  }

  return ((data ?? []) as ProfileSourceRow[]).filter((source) => Boolean(source.extracted_text?.trim()));
}

async function readExistingAnalyses(
  adminClient: ReturnType<typeof createAdminClient>,
  profile: CareerProfileMergeProfileRow & { user_id: string },
) {
  const { data, error } = await adminClient
    .from("profile_source_analyses")
    .select("id, source_id, content_json")
    .eq("profile_id", profile.id)
    .eq("user_id", profile.user_id)
    .eq("status", "analyzed")
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) {
    throw new Error("PROFILE_REPROCESS_ANALYSIS_READ_FAILED");
  }

  return (data ?? []) as AnalysisRow[];
}

async function readProfileFacts(
  adminClient: ReturnType<typeof createAdminClient>,
  profile: CareerProfileMergeProfileRow & { user_id: string },
) {
  const { data, error } = await adminClient
    .from("profile_facts")
    .select("id, fact_type, fact_value, confidence, evidence_status, source_ids, source_label, source_type, user_confirmed")
    .eq("profile_id", profile.id)
    .eq("user_id", profile.user_id)
    .order("user_confirmed", { ascending: false })
    .order("confidence", { ascending: false })
    .limit(120);

  if (error) {
    throw new Error("PROFILE_REPROCESS_FACT_READ_FAILED");
  }

  return (data ?? []) as CareerProfileMergeFactRow[];
}

async function readCurrentCareerProfile(
  adminClient: ReturnType<typeof createAdminClient>,
  profile: CareerProfileMergeProfileRow & { user_id: string },
) {
  const { data, error } = await adminClient
    .from("career_profiles")
    .select("id, version_number, content_json")
    .eq("profile_id", profile.id)
    .eq("user_id", profile.user_id)
    .eq("is_current", true)
    .neq("status", "deleted")
    .maybeSingle();

  if (error) {
    throw new Error("PROFILE_REPROCESS_CAREER_PROFILE_READ_FAILED");
  }

  return data as CurrentCareerProfileRow | null;
}

function parseSourceRows(sources: ProfileSourceRow[]) {
  const parsedSources: { parsed: ParsedProfileSource; source: ProfileSourceRow }[] = [];
  let sourceFailures = 0;

  for (const source of sources) {
    const text = source.extracted_text?.trim();

    if (!text) {
      continue;
    }

    try {
      const parsed = parsedProfileSourceSchema.parse(
        parseProfileSourceText({
          sourceId: source.id,
          sourceLabel: source.original_filename ?? source.source_url ?? source.source_type,
          sourceType: source.source_type,
          text,
        }),
      );

      parsedSources.push({ parsed, source });
    } catch {
      sourceFailures += 1;
    }
  }

  return {
    parsedSources,
    sourceFailures,
  };
}

async function insertSourceAnalysis(
  adminClient: ReturnType<typeof createAdminClient>,
  source: ProfileSourceRow,
  parsed: ParsedProfileSource,
) {
  const { data, error } = await adminClient
    .from("profile_source_analyses")
    .insert({
      confidence: estimateSourceConfidence(parsed),
      content_json: parsed,
      failure_reason: null,
      model: PROFILE_SOURCE_ANALYSIS_MODEL,
      profile_id: source.profile_id,
      prompt_version: PROFILE_SOURCE_ANALYSIS_PROMPT_VERSION,
      schema_version: PROFILE_SOURCE_ANALYSIS_SCHEMA_VERSION,
      source_id: source.id,
      status: "analyzed",
      user_id: source.user_id,
      warnings: buildAnalysisWarnings(parsed),
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error("PROFILE_REPROCESS_ANALYSIS_SAVE_FAILED");
  }

  return data.id as string;
}

async function saveCurrentCareerProfile(
  adminClient: ReturnType<typeof createAdminClient>,
  {
    currentProfile,
    lastSourceAnalysisId,
    nextCareerProfile,
    profile,
  }: {
    currentProfile: CurrentCareerProfileRow | null;
    lastSourceAnalysisId: string | null;
    nextCareerProfile: CanonicalCareerProfile;
    profile: CareerProfileMergeProfileRow & { user_id: string };
  },
) {
  if (currentProfile?.id) {
    const { error: archiveError } = await adminClient
      .from("career_profiles")
      .update({ is_current: false })
      .eq("id", currentProfile.id)
      .eq("user_id", profile.user_id);

    if (archiveError) {
      throw new Error("PROFILE_REPROCESS_CAREER_PROFILE_ARCHIVE_FAILED");
    }
  }

  const status =
    nextCareerProfile.conflicts.length > 0 || nextCareerProfile.openQuestions.length > 0
      ? "needs_review"
      : "ready";
  const { error } = await adminClient
    .from("career_profiles")
    .insert({
      content_json: nextCareerProfile,
      is_current: true,
      last_source_analysis_id: lastSourceAnalysisId,
      merge_metadata: {
        adminBackfill: true,
        preservedPreviousProfile: Boolean(currentProfile),
      },
      profile_id: profile.id,
      schema_version: CAREER_PROFILE_SCHEMA_VERSION,
      status,
      user_id: profile.user_id,
      version_number: (currentProfile?.version_number ?? 0) + 1,
    });

  if (error) {
    throw new Error("PROFILE_REPROCESS_CAREER_PROFILE_SAVE_FAILED");
  }
}

async function projectCareerProfileFields(
  adminClient: ReturnType<typeof createAdminClient>,
  profile: CareerProfileMergeProfileRow & { user_id: string },
  careerProfile: CanonicalCareerProfile,
) {
  const updates = {
    display_name: profile.display_name ?? careerProfile.identity.fullName,
    headline: profile.headline ?? careerProfile.headline ?? careerProfile.identity.currentTitle,
    summary: profile.summary ?? careerProfile.summaries[0] ?? null,
    target_direction: profile.target_direction ?? careerProfile.targetDirection,
    target_level: profile.target_level ?? careerProfile.targetLevel,
  };
  const hasUpdate = Object.entries(updates).some(
    ([key, value]) => value && value !== profile[key as keyof CareerProfileMergeProfileRow],
  );

  if (!hasUpdate) {
    return;
  }

  const { error } = await adminClient
    .from("profiles")
    .update(updates)
    .eq("id", profile.id)
    .eq("user_id", profile.user_id);

  if (error) {
    throw new Error("PROFILE_REPROCESS_PROFILE_UPDATE_FAILED");
  }
}

async function repairLatestMasterResume(
  adminClient: ReturnType<typeof createAdminClient>,
  {
    dryRun,
    nextCareerProfile,
    profile,
    sources,
  }: {
    dryRun: boolean;
    nextCareerProfile: CanonicalCareerProfile;
    profile: CareerProfileMergeProfileRow & { user_id: string };
    sources: ProfileSourceRow[];
  },
) {
  const { data, error } = await adminClient
    .from("generated_resumes")
    .select("id, content_json, status, pdf_storage_path, docx_storage_path")
    .eq("profile_id", profile.id)
    .eq("user_id", profile.user_id)
    .eq("resume_type", "master")
    .is("application_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("PROFILE_REPROCESS_MASTER_RESUME_READ_FAILED");
  }

  const latestResume = data as LatestMasterResumeRow | null;

  if (!latestResume) {
    return false;
  }

  const before = parseResumeContent(latestResume.content_json);
  const after = enrichMasterResumeWithOptionalSourceEvidence(
    before,
    buildSourceEvidence(nextCareerProfile, sources),
  );

  if (!didResumeChange(before, after)) {
    return false;
  }

  if (dryRun) {
    return true;
  }

  const { error: updateError } = await adminClient
    .from("generated_resumes")
    .update({
      content_json: after,
      docx_storage_path: null,
      pdf_storage_path: null,
      status: "draft",
    })
    .eq("id", latestResume.id)
    .eq("user_id", profile.user_id);

  if (updateError) {
    throw new Error("PROFILE_REPROCESS_MASTER_RESUME_UPDATE_FAILED");
  }

  return true;
}

function buildSourceEvidence(
  careerProfile: CanonicalCareerProfile,
  sources: ProfileSourceRow[],
): SourceEvidence[] {
  return [
    {
      created_at: null,
      extracted_text: JSON.stringify(careerProfile),
      id: "00000000-0000-0000-0000-000000000000",
      original_filename: "Canonical career profile backfill",
      source_type: "career_profile",
      source_url: null,
    },
    ...sources.map((source) => ({
      created_at: source.created_at,
      extracted_text: source.extracted_text,
      id: source.id,
      original_filename: source.original_filename,
      source_type: source.source_type,
      source_url: source.source_url,
    })),
  ];
}

function didCareerProfileChange(
  previous: CanonicalCareerProfile | null,
  next: CanonicalCareerProfile,
) {
  return stableJson(previous) !== stableJson(next);
}

function didResumeChange(before: ResumeContent, after: ResumeContent) {
  return stableJson(before) !== stableJson(after);
}

function sumReports(
  reports: ProfileReprocessReport[],
  key: "parsedProjectCount" | "sourceCount" | "sourceFailures" | "sourcesAnalyzed",
) {
  return reports.reduce((total, report) => total + report[key], 0);
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}
