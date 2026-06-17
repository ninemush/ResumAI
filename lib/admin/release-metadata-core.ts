export type ReleaseMetadata = {
  branchUrl: string | null;
  buildTime: string;
  capturedAt: string;
  deploymentId: string | null;
  deploymentUrl: string | null;
  gitCommitRef: string | null;
  gitCommitSha: string | null;
  provenanceAvailable: boolean;
  targetEnvironment: string;
};

export type PublicReleaseMetadata = Omit<ReleaseMetadata, "branchUrl" | "capturedAt">;

type ReleaseEnvironment = Record<string, string | undefined>;

export function readReleaseMetadataFromEnv(
  env: ReleaseEnvironment,
  now: Date = new Date(),
  buildTimeFallback: Date = now,
): ReleaseMetadata {
  const gitCommitSha = readCleanValue(env.VERCEL_GIT_COMMIT_SHA) ?? readCleanValue(env.RELEASE_COMMIT_SHA);
  const gitCommitRef = readCleanValue(env.VERCEL_GIT_COMMIT_REF) ?? readCleanValue(env.RELEASE_COMMIT_REF);
  const deploymentUrl =
    normalizeDeploymentUrl(env.VERCEL_URL) ?? normalizeDeploymentUrl(env.RELEASE_DEPLOYMENT_URL);
  const branchUrl = normalizeDeploymentUrl(env.VERCEL_BRANCH_URL);
  const deploymentId = readCleanValue(env.VERCEL_DEPLOYMENT_ID) ?? readCleanValue(env.RELEASE_DEPLOYMENT_ID);
  const targetEnvironment =
    readCleanValue(env.VERCEL_TARGET_ENV) ?? readCleanValue(env.VERCEL_ENV) ?? "development";
  const buildTime = readCleanValue(env.RELEASE_BUILD_TIME) ?? buildTimeFallback.toISOString();
  const provenanceAvailable = Boolean(gitCommitSha && gitCommitRef && deploymentUrl);

  return {
    branchUrl,
    buildTime,
    capturedAt: now.toISOString(),
    deploymentId,
    deploymentUrl,
    gitCommitRef,
    gitCommitSha,
    provenanceAvailable,
    targetEnvironment,
  };
}

export function toPublicReleaseMetadata(metadata: ReleaseMetadata): PublicReleaseMetadata {
  return {
    buildTime: metadata.buildTime,
    deploymentId: metadata.deploymentId,
    deploymentUrl: metadata.deploymentUrl,
    gitCommitRef: metadata.gitCommitRef,
    gitCommitSha: metadata.gitCommitSha,
    provenanceAvailable: metadata.provenanceAvailable,
    targetEnvironment: metadata.targetEnvironment,
  };
}

export function normalizeDeploymentUrl(value: string | undefined) {
  const cleaned = readCleanValue(value);

  if (!cleaned) return null;
  if (/^https?:\/\//i.test(cleaned)) return cleaned;

  return `https://${cleaned}`;
}

function readCleanValue(value: string | undefined) {
  const cleaned = value?.trim();

  return cleaned ? cleaned : null;
}
