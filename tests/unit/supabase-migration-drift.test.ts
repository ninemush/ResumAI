import { execFileSync } from "node:child_process";

import { describe, expect, test } from "vitest";

const matchedMigrations = `
  Local          | Remote         | Time (UTC)
 ----------------|----------------|---------------------
  20260617120000 | 20260617120000 | 2026-06-17 12:00:00
  20260618120000 | 20260618120000 | 2026-06-18 12:00:00
`;

describe("Supabase migration drift checker", () => {
  test("passes when local and remote migrations match", () => {
    const result = runDriftCheck(matchedMigrations);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("no drift across 2 migration(s)");
  });

  test("fails on local-only migrations", () => {
    const result = runDriftCheck(`
      Local          | Remote         | Time (UTC)
     ----------------|----------------|---------------------
      20260617120000 | 20260617120000 | 2026-06-17 12:00:00
      20260618120000 |                | 2026-06-18 12:00:00
    `);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("local-only migration 20260618120000");
  });

  test("fails on remote-only migrations", () => {
    const result = runDriftCheck(`
      Local          │ Remote         │ Time (UTC)
     ────────────────┼────────────────┼─────────────────────
                     │ 20260618120000 │ 2026-06-18 12:00:00
    `);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("remote-only migration 20260618120000");
  });

  test("fails closed when successful output cannot be parsed", () => {
    const result = runDriftCheck("No linked project output was available.\n");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no migration rows could be parsed");
  });
});

function runDriftCheck(fixture: string) {
  try {
    const stdout = execFileSync("node", ["scripts/check-supabase-migration-drift.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        SUPABASE_MIGRATION_LIST_FIXTURE: fixture,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failed = error as {
      status?: number;
      stderr?: Buffer;
      stdout?: Buffer;
    };

    return {
      status: failed.status ?? 1,
      stdout: failed.stdout?.toString("utf8") ?? "",
      stderr: failed.stderr?.toString("utf8") ?? "",
    };
  }
}
