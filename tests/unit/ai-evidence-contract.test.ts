import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const repoRoot = process.cwd();

describe("AI evidence contract", () => {
  test("master resume prompt forbids unsupported high-impact claims", () => {
    const source = readFileSync(join(repoRoot, "lib/resumes/master-resume.ts"), "utf8");

    expect(source).toContain("Confirmed and source-supported facts may");
    expect(source).toContain("needs_confirmation, conflict, or");
    expect(source).toContain("must not appear as hard claims");
    expect(source).toContain("reviewerNotes, keywordGaps, or direct confirmation questions");
    expect(source).toMatch(/do\s+not make up numbers/);
  });

  test("application material prompt routes unresolved evidence into review notes", () => {
    const source = readFileSync(join(repoRoot, "lib/applications/material-generation.ts"), "utf8");

    expect(source).toContain("Use confirmed and source-supported facts as claims");
    expect(source).toContain("Treat inferred");
    expect(source).toContain("conflicting, or missing-evidence facts as review notes");
    expect(source).toContain("do not present them as hard truth");
    expect(source).toContain("unsupported");
    expect(source).toContain("what the user should verify before export");
  });

  test("prompt code recognizes each launch evidence status explicitly", () => {
    const combinedSource = [
      readFileSync(join(repoRoot, "lib/resumes/master-resume.ts"), "utf8"),
      readFileSync(join(repoRoot, "lib/applications/material-generation.ts"), "utf8"),
      readFileSync(join(repoRoot, "lib/profile/profile-intake.ts"), "utf8"),
    ].join("\n");

    for (const status of [
      "user_confirmed",
      "source_supported",
      "inferred",
      "conflict",
      "missing_evidence",
    ]) {
      expect(combinedSource).toContain(status);
    }
  });
});
