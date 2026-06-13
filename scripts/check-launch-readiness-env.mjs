import { readFileSync } from "node:fs";
import { join } from "node:path";

const localEnvFiles = [".env.local", ".env.qa-demo.local", ".env.qa-v1-demo.local"];
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SITE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "QA_DEMO_EMAIL",
  "QA_DEMO_PASSWORD",
  "QA_DEMO_USER_A_EMAIL",
  "QA_DEMO_USER_A_PASSWORD",
  "QA_DEMO_USER_B_EMAIL",
  "QA_DEMO_USER_B_PASSWORD",
  "QA_ADMIN_EMAIL",
  "QA_ADMIN_PASSWORD",
  "RATE_LIMIT_BACKEND",
  "REVENUECAT_WEBHOOK_SECRET",
];

loadApprovedLocalEnv();

const missing = required.filter((key) => !process.env[key]);

if (process.env.RUN_LAUNCH_READINESS_GATES !== "1") {
  missing.push("RUN_LAUNCH_READINESS_GATES=1");
}

if (process.env.AUTH_REQUIRE_EMAIL_CODE !== "true") {
  missing.push("AUTH_REQUIRE_EMAIL_CODE=true");
}

if (process.env.RATE_LIMIT_BACKEND !== "supabase") {
  missing.push("RATE_LIMIT_BACKEND=supabase");
}

if (missing.length > 0) {
  console.error("Launch-readiness gates cannot run. Missing required configuration:");
  for (const key of missing) {
    console.error(`- ${key}`);
  }
  process.exit(1);
}

console.log("Launch-readiness environment is configured.");

function loadApprovedLocalEnv() {
  for (const file of localEnvFiles) {
    try {
      const content = readFileSync(join(process.cwd(), file), "utf8");
      for (const line of content.split(/\n/)) {
        const parsed = parseEnvLine(line);

        if (!parsed) {
          continue;
        }

        process.env[parsed.key] ||= parsed.value;
      }
    } catch {
      // The launch gates can run in CI or on a local QA machine. Missing local
      // files are fine as long as the environment is already populated.
    }
  }
}

function parseEnvLine(line) {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const separatorIndex = trimmed.indexOf("=");

  if (separatorIndex === -1) {
    return null;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  let value = trimmed.slice(separatorIndex + 1).trim();

  if (!key) {
    return null;
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}
