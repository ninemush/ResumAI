import { expect, test } from "@playwright/test";

import {
  buildAuthCookieHeader,
  hasLaunchReadinessEnv,
  loadLocalEnv,
} from "./helpers/demo-auth";
import {
  createServiceRoleClient,
  readUserIdByEmail,
} from "./helpers/launch-fixtures";

test.describe("hostile source ingestion maturity", () => {
  test.skip(
    !hasLaunchReadinessEnv(),
    "Launch readiness env, service role, admin, and two-user QA credentials are required for hostile ingestion evidence.",
  );

  test("rejects unsupported and misleading upload fixtures without creating sources or facts", async ({ request }) => {
    loadLocalEnv();

    const admin = createServiceRoleClient();
    const userId = await readUserIdByEmail(process.env.QA_DEMO_USER_A_EMAIL ?? "");
    const userCookie = await buildAuthCookieHeader({
      email: process.env.QA_DEMO_USER_A_EMAIL ?? "",
      password: process.env.QA_DEMO_USER_A_PASSWORD ?? "",
      request,
    });
    const before = await readSourceAndFactCounts(admin, userId);
    const fixtures = [
      {
        fileSize: 128,
        mimeType: "application/x-msdownload",
        originalFilename: "resume.pdf.exe",
      },
      {
        fileSize: 25_000_001,
        mimeType: "application/pdf",
        originalFilename: "oversized.pdf",
      },
      {
        fileSize: 256,
        mimeType: "application/zip",
        originalFilename: "linkedin-archive.zip",
      },
      {
        fileSize: 256,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        originalFilename: "misleading.pdf",
      },
    ];

    for (const fixture of fixtures) {
      const response = await request.post("/api/profile/sources/upload-intent", {
        data: fixture,
        headers: { cookie: userCookie },
      });
      const payload = await response.json();

      expect(response.ok()).toBe(false);
      expect(["source.invalid_upload_intent", "source.unsupported_upload_type"]).toContain(
        payload.error.code,
      );
    }

    const after = await readSourceAndFactCounts(admin, userId);

    expect(after).toEqual(before);
  });
});

async function readSourceAndFactCounts(
  admin: ReturnType<typeof createServiceRoleClient>,
  userId: string,
) {
  const [sources, facts] = await Promise.all([
    admin
      .from("profile_sources")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    admin
      .from("profile_facts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
  ]);

  expect(sources.error).toBeNull();
  expect(facts.error).toBeNull();

  return {
    facts: facts.count ?? 0,
    sources: sources.count ?? 0,
  };
}
