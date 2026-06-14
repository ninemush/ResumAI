import { describe, expect, test } from "vitest";

import {
  normalizeDeploymentUrl,
  readReleaseMetadataFromEnv,
} from "@/lib/admin/release-metadata-core";

const now = new Date("2026-06-14T04:00:19.000Z");

describe("release metadata", () => {
  test("normalizes complete Vercel provenance", () => {
    const metadata = readReleaseMetadataFromEnv(
      {
        VERCEL_BRANCH_URL: "ai-resume-app-git-main-resum-ai.vercel.app",
        VERCEL_GIT_COMMIT_REF: "main",
        VERCEL_GIT_COMMIT_SHA: "d2ae26bd4efc9a853c5c4970a15d83ce3dc38758",
        VERCEL_TARGET_ENV: "production",
        VERCEL_URL: "ai-resume-7e74sw96u-resum-ai.vercel.app",
      },
      now,
    );

    expect(metadata).toEqual({
      branchUrl: "https://ai-resume-app-git-main-resum-ai.vercel.app",
      capturedAt: now.toISOString(),
      deploymentUrl: "https://ai-resume-7e74sw96u-resum-ai.vercel.app",
      gitCommitRef: "main",
      gitCommitSha: "d2ae26bd4efc9a853c5c4970a15d83ce3dc38758",
      provenanceAvailable: true,
      targetEnvironment: "production",
    });
  });

  test("falls back cleanly in local development", () => {
    const metadata = readReleaseMetadataFromEnv({}, now);

    expect(metadata).toMatchObject({
      branchUrl: null,
      deploymentUrl: null,
      gitCommitRef: null,
      gitCommitSha: null,
      provenanceAvailable: false,
      targetEnvironment: "development",
    });
  });

  test("marks provenance unavailable when git SHA is missing", () => {
    const metadata = readReleaseMetadataFromEnv(
      {
        VERCEL_GIT_COMMIT_REF: "main",
        VERCEL_TARGET_ENV: "production",
        VERCEL_URL: "ai-resume-7e74sw96u-resum-ai.vercel.app",
      },
      now,
    );

    expect(metadata.gitCommitSha).toBeNull();
    expect(metadata.provenanceAvailable).toBe(false);
  });

  test("normalizes deployment URLs with an https scheme", () => {
    expect(normalizeDeploymentUrl("ai-resume.example.vercel.app")).toBe(
      "https://ai-resume.example.vercel.app",
    );
    expect(normalizeDeploymentUrl("https://pramania.com")).toBe("https://pramania.com");
    expect(normalizeDeploymentUrl("")).toBeNull();
  });
});
