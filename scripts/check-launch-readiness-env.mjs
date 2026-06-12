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
