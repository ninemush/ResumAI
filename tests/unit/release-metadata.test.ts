import { describe, expect, test } from "vitest";

import {
  normalizeDeploymentUrl,
  readReleaseMetadataFromEnv,
  toPublicReleaseMetadata,
} from "@/lib/admin/release-metadata-core";

const now = new Date("2026-06-14T04:00:19.000Z");

describe("release metadata", () => {
  test("normalizes complete Vercel provenance", () => {
    const metadata = readReleaseMetadataFromEnv(
      {
        VERCEL_BRANCH_URL: "ai-resume-app-git-main-resum-ai.vercel.app",
        VERCEL_DEPLOYMENT_ID: "dpl_123",
        VERCEL_GIT_COMMIT_REF: "main",
        VERCEL_GIT_COMMIT_SHA: "d2ae26bd4efc9a853c5c4970a15d83ce3dc38758",
        VERCEL_TARGET_ENV: "production",
        VERCEL_URL: "ai-resume-7e74sw96u-resum-ai.vercel.app",
      },
      now,
    );

    expect(metadata).toEqual({
      branchUrl: "https://ai-resume-app-git-main-resum-ai.vercel.app",
      buildTime: now.toISOString(),
      capturedAt: now.toISOString(),
      deploymentId: "dpl_123",
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
      deploymentId: null,
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

  test("uses emergency fallback release metadata when Vercel Git metadata is absent", () => {
    const metadata = readReleaseMetadataFromEnv(
      {
        RELEASE_COMMIT_REF: "main",
        RELEASE_COMMIT_SHA: "8eae07e4efc9a853c5c4970a15d83ce3dc38758",
        RELEASE_DEPLOYMENT_ID: "manual-rollback-20260617",
        RELEASE_DEPLOYMENT_URL: "https://pramania.com",
        VERCEL_TARGET_ENV: "production",
      },
      now,
    );

    expect(metadata).toMatchObject({
      deploymentId: "manual-rollback-20260617",
      deploymentUrl: "https://pramania.com",
      gitCommitRef: "main",
      gitCommitSha: "8eae07e4efc9a853c5c4970a15d83ce3dc38758",
      provenanceAvailable: true,
      targetEnvironment: "production",
    });
  });

  test("prefers Vercel Git metadata over emergency fallback values", () => {
    const metadata = readReleaseMetadataFromEnv(
      {
        RELEASE_COMMIT_REF: "manual-hotfix",
        RELEASE_COMMIT_SHA: "1111111111111111111111111111111111111111",
        RELEASE_DEPLOYMENT_URL: "https://manual.example.com",
        VERCEL_GIT_COMMIT_REF: "main",
        VERCEL_GIT_COMMIT_SHA: "2222222222222222222222222222222222222222",
        VERCEL_TARGET_ENV: "production",
        VERCEL_URL: "git-connected.example.vercel.app",
      },
      now,
    );

    expect(metadata.gitCommitRef).toBe("main");
    expect(metadata.gitCommitSha).toBe("2222222222222222222222222222222222222222");
    expect(metadata.deploymentUrl).toBe("https://git-connected.example.vercel.app");
  });

  test("public release metadata excludes admin-only capture fields", () => {
    const publicMetadata = toPublicReleaseMetadata(
      readReleaseMetadataFromEnv(
        {
          RELEASE_COMMIT_REF: "main",
          RELEASE_COMMIT_SHA: "8eae07e4efc9a853c5c4970a15d83ce3dc38758",
          RELEASE_DEPLOYMENT_ID: "manual-rollback-20260617",
          RELEASE_DEPLOYMENT_URL: "https://pramania.com",
          VERCEL_BRANCH_URL: "ai-resume-app-git-main-resum-ai.vercel.app",
          VERCEL_TARGET_ENV: "production",
        },
        now,
      ),
    );

    expect(publicMetadata).toEqual({
      buildTime: now.toISOString(),
      deploymentId: "manual-rollback-20260617",
      deploymentUrl: "https://pramania.com",
      gitCommitRef: "main",
      gitCommitSha: "8eae07e4efc9a853c5c4970a15d83ce3dc38758",
      provenanceAvailable: true,
      targetEnvironment: "production",
    });
    expect(Object.keys(publicMetadata)).not.toContain("branchUrl");
    expect(Object.keys(publicMetadata)).not.toContain("capturedAt");
    expect(JSON.stringify(publicMetadata)).not.toMatch(/authorization|bearer|cookie|password|secret|service_role/i);
  });

  test("normalizes deployment URLs with an https scheme", () => {
    expect(normalizeDeploymentUrl("ai-resume.example.vercel.app")).toBe(
      "https://ai-resume.example.vercel.app",
    );
    expect(normalizeDeploymentUrl("https://pramania.com")).toBe("https://pramania.com");
    expect(normalizeDeploymentUrl("")).toBeNull();
  });
});
