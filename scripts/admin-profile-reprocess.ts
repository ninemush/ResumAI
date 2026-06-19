import { existsSync, readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";

type CliOptions = {
  actorUserId: string | null;
  dryRun: boolean;
  limit: number;
  repairMasterResumes: boolean;
  userId?: string;
};

loadEnvFile(".env.production.local");
loadEnvFile(".env.local");
installServerOnlyStub();

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { reprocessProfileEvidenceWithServiceRole } = await import("../lib/admin/profile-reprocess");
  const result = await reprocessProfileEvidenceWithServiceRole(
    {
      dryRun: options.dryRun,
      limit: options.limit,
      repairMasterResumes: options.repairMasterResumes,
      userId: options.userId,
    },
    {
      actorUserId: options.actorUserId,
    },
  );

  console.log(JSON.stringify(result, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    actorUserId: readValue(args, "--actor-user-id") ?? process.env.ADMIN_BACKFILL_ACTOR_USER_ID ?? null,
    dryRun: !args.includes("--apply"),
    limit: Number(readValue(args, "--limit") ?? 250),
    repairMasterResumes: !args.includes("--skip-resume-repair"),
    userId: readValue(args, "--user-id") ?? undefined,
  };

  if (args.includes("--help")) {
    console.log(
      [
        "Usage: node_modules/.bin/tsx scripts/admin-profile-reprocess.ts [options]",
        "",
        "Options:",
        "  --apply                 Apply changes. Omit for dry-run.",
        "  --limit=N               Maximum profiles to scan, 1-500. Default 250.",
        "  --user-id=UUID          Reprocess one user only.",
        "  --skip-resume-repair    Rebuild career profiles only.",
        "  --actor-user-id=UUID    Optional actor id for audit records.",
      ].join("\n"),
    );
    process.exit(0);
  }

  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 500) {
    throw new Error("Use --limit with an integer from 1 to 500.");
  }

  return options;
}

function readValue(args: string[], name: string) {
  const prefixed = args.find((arg) => arg.startsWith(`${name}=`));

  if (prefixed) {
    return prefixed.slice(name.length + 1).trim() || null;
  }

  const index = args.indexOf(name);

  if (index >= 0) {
    return args[index + 1]?.trim() || null;
  }

  return null;
}

function loadEnvFile(filename: string) {
  const filePath = path.join(process.cwd(), filename);

  if (!existsSync(filePath)) {
    return;
  }

  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");

    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();

    if (process.env[key]) {
      continue;
    }

    process.env[key] = unquoteEnvValue(line.slice(equalsIndex + 1).trim());
  }
}

function unquoteEnvValue(value: string) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function installServerOnlyStub() {
  type ResolveFilename = (
    request: string,
    parent: unknown,
    isMain: boolean,
    options?: unknown,
  ) => string;
  const moduleWithResolver = Module as unknown as {
    _resolveFilename: ResolveFilename;
  };
  const originalResolveFilename = moduleWithResolver._resolveFilename;
  const serverOnlyStubPath = path.join(process.cwd(), "scripts/server-only-stub.cjs");

  moduleWithResolver._resolveFilename = function resolveFilename(
    request: string,
    parent: unknown,
    isMain: boolean,
    options?: unknown,
  ) {
    if (request === "server-only") {
      return serverOnlyStubPath;
    }

    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
}
