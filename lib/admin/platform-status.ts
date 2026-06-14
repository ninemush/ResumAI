import "server-only";

import { getMaterialsModel, getProfileIntakeModel } from "@/lib/ai/openai";
import { summarizeOverallStatus, type PlatformHealthState } from "@/lib/admin/platform-health";
import { readReleaseMetadata, type ReleaseMetadata } from "@/lib/admin/release-metadata";
import { createClient } from "@/lib/supabase/server";

export type PlatformStatusCheck = {
  details: string;
  impact: "availability" | "cleanup";
  label: string;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  state: PlatformHealthState;
};

export type PlatformStatusOverview = {
  checks: PlatformStatusCheck[];
  generatedAt: string;
  overallStatus: PlatformHealthState;
  release: ReleaseMetadata;
  recentSignals: {
    activeErrors24h: number;
    applicationExportsReady: number;
    jobFailures24h: number;
    sourceFailures24h: number;
    telemetryEvents24h: number;
  };
};

const dayMs = 24 * 60 * 60 * 1000;

export async function getPlatformStatus(): Promise<PlatformStatusOverview> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("ADMIN_REQUIRED");
  }

  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");

  if (adminError || !isAdmin) {
    throw new Error("ADMIN_REQUIRED");
  }

  const since = new Date(Date.now() - dayMs).toISOString();
  const release = readReleaseMetadata();
  const [
    dbCheck,
    storageCheck,
    aiCheck,
    releaseCheck,
    sourceCheck,
    jobCheck,
    artifactCheck,
    telemetryCheck,
  ] = await Promise.all([
    readDatabaseCheck(supabase),
    readStorageCheck(supabase),
    readAiCheck(supabase, since),
    readReleaseProvenanceCheck(release),
    readSourceExtractionCheck(supabase, since),
    readJobIngestionCheck(supabase, since),
    readArtifactGenerationCheck(supabase),
    readTelemetryCheck(supabase, since),
  ]);
  const checks = [
    dbCheck,
    storageCheck,
    aiCheck,
    releaseCheck,
    sourceCheck,
    jobCheck,
    artifactCheck,
    telemetryCheck,
  ];
  const recentSignals = {
    activeErrors24h: numberFromCheckMeta(telemetryCheck, "active errors"),
    applicationExportsReady: numberFromCheckMeta(artifactCheck, "ready exports"),
    jobFailures24h: numberFromCheckMeta(jobCheck, "failures"),
    sourceFailures24h: numberFromCheckMeta(sourceCheck, "failures"),
    telemetryEvents24h: numberFromCheckMeta(telemetryCheck, "events"),
  };

  return {
    checks,
    generatedAt: new Date().toISOString(),
    overallStatus: summarizeOverallStatus(checks),
    release,
    recentSignals,
  };
}

async function readReleaseProvenanceCheck(release: ReleaseMetadata) {
  const missing = [
    release.gitCommitSha ? null : "Git SHA",
    release.gitCommitRef ? null : "Git branch",
    release.deploymentUrl ? null : "deployment URL",
  ].filter((item): item is string => Boolean(item));
  const isProduction = release.targetEnvironment === "production";
  const degraded = isProduction && !release.provenanceAvailable;

  return {
    details: degraded
      ? `Production release provenance is incomplete. Missing: ${missing.join(", ")}.`
      : release.provenanceAvailable
        ? `Deployment ${shortSha(release.gitCommitSha)} from ${release.gitCommitRef} is traceable.`
        : "Release provenance is not required for this non-production runtime.",
    impact: "availability",
    label: "Release Provenance",
    lastFailureAt: degraded ? release.capturedAt : null,
    lastSuccessAt: release.provenanceAvailable ? release.capturedAt : null,
    state: degraded ? "degraded" : "healthy",
  } satisfies PlatformStatusCheck;
}

async function readDatabaseCheck(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { error } = await supabase.from("profiles").select("id", { count: "exact", head: true });

  return {
    details: error ? "Supabase database query failed." : "Supabase database accepted a read query.",
    impact: "availability",
    label: "Supabase DB",
    lastFailureAt: error ? new Date().toISOString() : null,
    lastSuccessAt: error ? null : new Date().toISOString(),
    state: error ? "down" : "healthy",
  } satisfies PlatformStatusCheck;
}

async function readStorageCheck(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase.storage.from("generated-artifacts").list("", { limit: 1 });

  return {
    details: error
      ? "Generated artifact bucket could not be listed with current owner session."
      : `Generated artifact bucket responded with ${data?.length ?? 0} visible item(s).`,
    impact: "availability",
    label: "Supabase Storage",
    lastFailureAt: error ? new Date().toISOString() : null,
    lastSuccessAt: error ? null : new Date().toISOString(),
    state: error ? "degraded" : "healthy",
  } satisfies PlatformStatusCheck;
}

async function readAiCheck(
  supabase: Awaited<ReturnType<typeof createClient>>,
  since: string,
) {
  const configured = Boolean(process.env.OPENAI_API_KEY);
  const [failures, successes] = await Promise.all([
    supabase
      .from("error_events")
      .select("created_at")
      .or("area.ilike.%ai%,area.ilike.%resume%,error_code.ilike.%AI%,error_code.ilike.%PROVIDER%")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("credit_ledger")
      .select("created_at")
      .in("resource_type", ["master_resume", "application_resume", "cover_letter"])
      .lt("credit_delta", 0)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  const lastFailureAt = failures.data?.[0]?.created_at ?? null;
  const lastSuccessAt = successes.data?.[0]?.created_at ?? null;
  const modelDetails = configured
    ? `Materials model ${safeModelName(getMaterialsModel())}; profile model ${safeModelName(getProfileIntakeModel())}.`
    : "";

  return {
    details: configured
      ? `OpenAI is configured. ${modelDetails}`
      : "OpenAI API key is not configured.",
    impact: "availability",
    label: "OpenAI Configuration",
    lastFailureAt,
    lastSuccessAt,
    state: !configured ? "down" : lastFailureAt && !lastSuccessAt ? "degraded" : "healthy",
  } satisfies PlatformStatusCheck;
}

async function readSourceExtractionCheck(
  supabase: Awaited<ReturnType<typeof createClient>>,
  since: string,
) {
  const { data, error } = await supabase
    .from("profile_sources")
    .select("extraction_status, created_at")
    .gte("created_at", since)
    .limit(1000);
  const failures = data?.filter((row) => row.extraction_status === "failed").length ?? 0;
  const successes = data?.filter((row) => row.extraction_status === "succeeded").length ?? 0;

  return {
    details: error
      ? "Source extraction records could not be read."
      : `${successes} successes, ${failures} failures in the last 24 hours.`,
    impact: "availability",
    label: "Source Extraction",
    lastFailureAt: failures > 0 ? latestDate(data, "failed") : null,
    lastSuccessAt: successes > 0 ? latestDate(data, "succeeded") : null,
    state: error ? "down" : failures > 0 ? "degraded" : "healthy",
  } satisfies PlatformStatusCheck;
}

async function readJobIngestionCheck(
  supabase: Awaited<ReturnType<typeof createClient>>,
  since: string,
) {
  const { data, error } = await supabase
    .from("job_ingestions")
    .select("ingestion_status, created_at")
    .gte("created_at", since)
    .limit(1000);
  const failures = data?.filter((row) => row.ingestion_status === "failed").length ?? 0;
  const successes = data?.filter((row) => row.ingestion_status === "succeeded").length ?? 0;

  return {
    details: error
      ? "Job ingestion records could not be read."
      : `${successes} successes, ${failures} failures in the last 24 hours.`,
    impact: "availability",
    label: "Job Ingestion",
    lastFailureAt: failures > 0 ? latestDate(data, "failed") : null,
    lastSuccessAt: successes > 0 ? latestDate(data, "succeeded") : null,
    state: error ? "down" : failures > 0 ? "degraded" : "healthy",
  } satisfies PlatformStatusCheck;
}

async function readArtifactGenerationCheck(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase
    .from("generated_resumes")
    .select("status, pdf_storage_path, docx_storage_path, updated_at")
    .order("updated_at", { ascending: false })
    .limit(500);
  const ready = data?.filter((row) => row.status === "ready" && row.pdf_storage_path && row.docx_storage_path).length ?? 0;
  const staleReady = data?.filter((row) => row.status === "ready" && (!row.pdf_storage_path || !row.docx_storage_path)).length ?? 0;
  const latestStaleReadyAt =
    data
      ?.filter((row) => row.status === "ready" && (!row.pdf_storage_path || !row.docx_storage_path))
      .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))[0]?.updated_at ?? null;

  return {
    details: error
      ? "Generated resume artifact metadata could not be read."
      : staleReady > 0
        ? `${ready} ready exports, ${staleReady} stale ready records need cleanup.`
        : `${ready} ready exports, 0 stale ready records.`,
    impact: "cleanup",
    label: "PDF/DOCX Generation",
    lastFailureAt: staleReady > 0 ? latestStaleReadyAt : null,
    lastSuccessAt: ready > 0 ? data?.find((row) => row.status === "ready")?.updated_at ?? null : null,
    state: error ? "down" : staleReady > 0 ? "degraded" : "healthy",
  } satisfies PlatformStatusCheck;
}

async function readTelemetryCheck(
  supabase: Awaited<ReturnType<typeof createClient>>,
  since: string,
) {
  const [events, errors] = await Promise.all([
    supabase.from("app_events").select("id", { count: "exact", head: true }).gte("created_at", since),
    supabase
      .from("error_events")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null)
      .gte("created_at", since),
  ]);

  return {
    details:
      events.error || errors.error
        ? "Telemetry or error capture records could not be read."
        : `${events.count ?? 0} events, ${errors.count ?? 0} active errors in the last 24 hours.`,
    impact: "availability",
    label: "Telemetry/Error Capture",
    lastFailureAt: events.error || errors.error ? new Date().toISOString() : null,
    lastSuccessAt: events.error || errors.error ? null : new Date().toISOString(),
    state: events.error || errors.error ? "down" : (errors.count ?? 0) > 0 ? "degraded" : "healthy",
  } satisfies PlatformStatusCheck;
}

function safeModelName(value: string) {
  return value.replace(/[^a-zA-Z0-9._:-]/g, "");
}

function shortSha(value: string | null) {
  return value ? value.slice(0, 7) : "unknown";
}

function latestDate<T extends { created_at: string; extraction_status?: string; ingestion_status?: string }>(
  rows: T[] | null,
  status: string,
) {
  return (
    rows
      ?.filter((row) => row.extraction_status === status || row.ingestion_status === status)
      .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0]?.created_at ?? null
  );
}

function numberFromCheckMeta(check: PlatformStatusCheck, label: string) {
  const match = check.details.match(new RegExp(`(\\d+)\\s+${label}`));
  return match ? Number(match[1]) : 0;
}
