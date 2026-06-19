#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const fixture = process.env.SUPABASE_MIGRATION_LIST_FIXTURE;
const output = fixture ?? readMigrationList();

if (output) {
  process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
}

const result = analyzeMigrationList(output);

if (result.parsedRows.length === 0) {
  console.error("Supabase migration drift check failed closed: no migration rows could be parsed.");
  process.exit(1);
}

if (result.failures.length > 0) {
  console.error("Supabase migration drift detected:");
  for (const failure of result.failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Supabase migration state has no drift across ${result.parsedRows.length} migration(s).`);

function readMigrationList() {
  const result = spawnSync("npx", ["supabase", "migration", "list"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    console.error(`Unable to run Supabase migration list: ${result.error.message}`);
    process.exit(1);
  }

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  if (result.status !== 0) {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    process.exit(result.status ?? 1);
  }

  if (stderr) process.stderr.write(stderr);

  return stdout;
}

function analyzeMigrationList(value) {
  const parsedRows = [];
  const failures = [];

  for (const line of value.split(/\r?\n/)) {
    const row = parseMigrationRow(line);

    if (!row) {
      continue;
    }

    parsedRows.push(row);

    if (!row.local) {
      failures.push(`remote-only migration ${row.remote}`);
      continue;
    }

    if (!row.remote) {
      failures.push(`local-only migration ${row.local}`);
      continue;
    }

    if (row.local !== row.remote) {
      failures.push(`local migration ${row.local} did not match remote migration ${row.remote}`);
    }
  }

  return { failures, parsedRows };
}

function parseMigrationRow(line) {
  const cells = line.split(/[|│]/).map((cell) => cell.trim());

  if (cells.length < 2) {
    return null;
  }

  const local = readMigrationVersion(cells[0]);
  const remote = readMigrationVersion(cells[1]);

  if (!local && !remote) {
    return null;
  }

  return { local, remote };
}

function readMigrationVersion(value) {
  return value.match(/\b\d{14}\b/)?.[0] ?? null;
}
