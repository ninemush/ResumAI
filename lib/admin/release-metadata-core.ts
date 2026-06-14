export type ReleaseMetadata = {
  branchUrl: string | null;
  capturedAt: string;
  deploymentUrl: string | null;
  gitCommitRef: string | null;
  gitCommitSha: string | null;
  provenanceAvailable: boolean;
  targetEnvironment: string;
};

type ReleaseEnvironment = Record<string, string | undefined>;

export function readReleaseMetadataFromEnv(
  env: ReleaseEnvironment,
  now: Date = new Date(),
): ReleaseMetadata {
  const gitCommitSha = readCleanValue(env.VERCEL_GIT_COMMIT_SHA);
  const gitCommitRef = readCleanValue(env.VERCEL_GIT_COMMIT_REF);
  const deploymentUrl = normalizeDeploymentUrl(env.VERCEL_URL);
  const branchUrl = normalizeDeploymentUrl(env.VERCEL_BRANCH_URL);
  const targetEnvironment =
    readCleanValue(env.VERCEL_TARGET_ENV) ?? readCleanValue(env.VERCEL_ENV) ?? "development";
  const provenanceAvailable = Boolean(gitCommitSha && gitCommitRef && deploymentUrl);

  return {
    branchUrl,
    capturedAt: now.toISOString(),
    deploymentUrl,
    gitCommitRef,
    gitCommitSha,
    provenanceAvailable,
    targetEnvironment,
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
