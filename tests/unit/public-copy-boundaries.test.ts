import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const repoRoot = process.cwd();
const scannedExtensions = new Set([
  ".css",
  ".json",
  ".md",
  ".mjs",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const ignoredDirectories = new Set([
  ".git",
  ".next",
  "coverage",
  "node_modules",
  "public",
  "test-results",
  "tests",
]);
const ignoredFiles = new Set(["package-lock.json"]);
const authSenderEmail = buildPramaniaEmail("noreply");

describe("public launch copy boundaries", () => {
  test("uses V1 credit and submission boundaries on public trust surfaces", () => {
    const publicCopy = [
      "components/auth/auth-panel.tsx",
      "app/privacy/page.tsx",
      "app/ai-use/page.tsx",
      "app/security/page.tsx",
      "lib/conversation/app-capabilities.ts",
    ]
      .map((path) => readFileSync(join(repoRoot, path), "utf8"))
      .join("\n");

    expect(publicCopy).not.toMatch(/subscription/i);
    expect(publicCopy).not.toMatch(/found for the user/i);
    expect(publicCopy).toContain("Credit packs for a focused job search");
    expect(publicCopy).toContain("LinkedIn sign-in is used only for authentication in V1");
    expect(publicCopy).toContain("does not offer authenticated");
    expect(publicCopy).toContain("does not auto-apply to jobs");
    expect(publicCopy).toMatch(/you decide\s+where and when to submit them/);
  });

  test("keeps Pramania email identity boundaries explicit", () => {
    const repositoryText = readRepositoryText();
    const customerFacingText = readPaths(["app", "components", "lib"]);

    expect(repositoryText).not.toContain(buildPramaniaEmail("no.reply"));
    expect(repositoryText).not.toContain(buildPramaniaEmail("founder"));
    expect(repositoryText).not.toContain(buildPramaniaEmail("info"));
    expect(repositoryText).not.toMatch(/[A-Z0-9._%+-]+@(gmail|outlook)\.com/i);

    expect(customerFacingText).not.toContain(authSenderEmail);
    expect(customerFacingText).toContain("hello@pramania.com");
    expect(customerFacingText).toContain("support@pramania.com");
    expect(repositoryText).toContain(authSenderEmail);
  });
});

function readRepositoryText() {
  return readPaths([
    ".env.example",
    ".github",
    "AGENTS.md",
    "API_CONTRACTS.md",
    "ARCHITECTURE.md",
    "BACKLOG.md",
    "CLAUDE.md",
    "DATA_MODEL.md",
    "DEVELOPMENT_CONTRACT.md",
    "IMPLEMENTATION_PLAN.md",
    "OWNER_SETUP.md",
    "PRODUCT_SCOPE.md",
    "PRIVACY_IMPACT.md",
    "QA_LOG.md",
    "README.md",
    "ROLLBACK_PLAN.md",
    "SETUP.md",
    "TEST_STRATEGY.md",
    "THREAT_MODEL.md",
    "USER_FLOWS.md",
    "UX_STATES.md",
    "app",
    "components",
    "docs",
    "lib",
    "supabase",
  ]);
}

function readPaths(paths: string[]) {
  return paths
    .flatMap((path) => collectTextFiles(join(repoRoot, path)))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
}

function collectTextFiles(path: string): string[] {
  const stats = statSync(path);

  if (stats.isDirectory()) {
    return readdirSync(path)
      .filter((entry) => !ignoredDirectories.has(entry))
      .flatMap((entry) => collectTextFiles(join(path, entry)));
  }

  const filename = path.split("/").at(-1) ?? path;
  if (ignoredFiles.has(filename)) {
    return [];
  }

  const extension = filename.startsWith(".env") ? ".txt" : `.${filename.split(".").at(-1) ?? ""}`;
  return scannedExtensions.has(extension) ? [path] : [];
}

function buildPramaniaEmail(localPart: string) {
  return `${localPart}@${["pramania", "com"].join(".")}`;
}
