#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const allowBlocked = process.argv.includes("--allow-blocked");
const capturedAt = new Date().toISOString();
const timestamp = capturedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const outputDir =
  process.env.RELEASE_PROVENANCE_OUTPUT_DIR ?? `qa-artifacts/release-provenance-${timestamp}`;
const targetUrl = normalizeBaseUrl(
  process.env.RELEASE_PROVENANCE_URL ??
    process.env.PLAYWRIGHT_BASE_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "https://pramania.com",
);
const expectedSha = process.env.RELEASE_EXPECTED_SHA ?? readGitSha();
const expectedDeploymentId = process.env.RELEASE_EXPECTED_DEPLOYMENT_ID?.trim() || null;
const expectProduction = process.env.RELEASE_PROVENANCE_EXPECT_PRODUCTION !== "false";

mkdirSync(outputDir, { recursive: true });

if (!expectedSha) {
  const evidence = {
    capturedAt,
    expectedDeploymentId,
    expectedSha: null,
    ok: false,
    reason: "missing_expected_sha",
    status: "blocked",
    targetUrl,
  };
  writeEvidence(evidence);
  console.error(
    "Release provenance verification blocked: Git CLI could not resolve origin/main. Set RELEASE_EXPECTED_SHA explicitly.",
  );
  process.exit(allowBlocked ? 0 : 2);
}

const headers = {
  Accept: "application/json",
};

try {
  const response = await fetch(new URL("/api/release", targetUrl), {
    headers,
  });
  const payload = await response.json().catch(() => null);
  const release = payload?.release ?? null;
  const failures = [];

  if (!response.ok) {
    failures.push(`release endpoint returned HTTP ${response.status}`);
  }

  if (!release) {
    failures.push("release endpoint response did not include release metadata");
  } else {
    if (release.gitCommitSha !== expectedSha) {
      failures.push(`deployed SHA ${release.gitCommitSha ?? "missing"} did not match ${expectedSha}`);
    }

    if (expectProduction && release.targetEnvironment !== "production") {
      failures.push(`target environment was ${release.targetEnvironment ?? "missing"}, not production`);
    }

    if (!release.provenanceAvailable) {
      failures.push("release provenance was marked unavailable by the app");
    }

    if (expectProduction && !release.deploymentId) {
      failures.push("production release did not report a deployment ID");
    }

    if (expectedDeploymentId && release.deploymentId !== expectedDeploymentId) {
      failures.push(
        `deployment ID ${release.deploymentId ?? "missing"} did not match ${expectedDeploymentId}`,
      );
    }
  }

  const evidence = {
    capturedAt,
    expectedDeploymentId,
    expectedSha,
    failures,
    ok: failures.length === 0,
    release,
    responseStatus: response.status,
    status: failures.length === 0 ? "passed" : "failed",
    targetUrl,
  };
  writeEvidence(evidence);

  if (failures.length > 0) {
    console.error(`Release provenance verification failed: ${failures.join("; ")}`);
    process.exit(1);
  }

  console.log(`Release provenance verified for ${expectedSha}. Evidence written to ${outputDir}.`);
} catch (error) {
  const evidence = {
    capturedAt,
    expectedSha,
    ok: false,
    reason: error instanceof Error ? error.message : "unknown_error",
    status: "failed",
    targetUrl,
  };
  writeEvidence(evidence);
  console.error(`Release provenance verification failed: ${evidence.reason}`);
  process.exit(1);
}

function writeEvidence(evidence) {
  writeFileSync(join(outputDir, "release-provenance.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  writeFileSync(join(outputDir, "release-provenance.md"), renderMarkdown(evidence));
}

function renderMarkdown(evidence) {
  const release = evidence.release ?? {};

  return [
    "# Release Provenance Verification",
    "",
    `- Status: ${evidence.status}`,
    `- Captured at: ${evidence.capturedAt}`,
    `- Target URL: ${evidence.targetUrl}`,
    `- Expected SHA: ${evidence.expectedSha ?? "unknown"}`,
    `- Expected deployment ID: ${evidence.expectedDeploymentId ?? "not required"}`,
    `- Deployed SHA: ${release.gitCommitSha ?? "not available"}`,
    `- Branch: ${release.gitCommitRef ?? "not available"}`,
    `- Target environment: ${release.targetEnvironment ?? "not available"}`,
    `- Deployment ID: ${release.deploymentId ?? "not available"}`,
    `- Deployment URL: ${release.deploymentUrl ?? "not available"}`,
    `- Build time: ${release.buildTime ?? "not available"}`,
    `- Provenance available: ${String(Boolean(release.provenanceAvailable))}`,
    evidence.failures?.length ? `- Failures: ${evidence.failures.join("; ")}` : null,
    evidence.reason ? `- Reason: ${evidence.reason}` : null,
    "",
  ].filter(Boolean).join("\n");
}

function normalizeBaseUrl(value) {
  const cleaned = value.trim();

  return /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
}

function readGitSha() {
  try {
    return execFileSync("git", ["rev-parse", "origin/main"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}
