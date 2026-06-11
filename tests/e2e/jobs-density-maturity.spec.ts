import { expect, test } from "@playwright/test";

import {
  authenticateDemoUser,
  hasLaunchReadinessEnv,
  loadLocalEnv,
} from "./helpers/demo-auth";
import {
  cleanRowsByIds,
  createServiceRoleClient,
  insertRow,
  readUserIdByEmail,
} from "./helpers/launch-fixtures";

test.describe("Jobs density maturity", () => {
  test.skip(
    !hasLaunchReadinessEnv(),
    "Launch readiness env and seeded demo credentials are required for Jobs density evidence.",
  );

  test("keeps the first seeded job record in the desktop first viewport", async ({ context, page, request, isMobile }) => {
    test.skip(isMobile, "Seeded Jobs density is a desktop launch-readiness check.");
    loadLocalEnv();

    const admin = createServiceRoleClient();
    const userId = await readUserIdByEmail(process.env.QA_DEMO_EMAIL ?? "");
    const marker = `launch-density-${crypto.randomUUID()}`;
    const cleanup: Record<string, string[]> = { job_ingestions: [] };

    try {
      const jobId = await insertRow(admin, "job_ingestions", {
        user_id: userId,
        job_url: `https://example.com/${marker}`,
        title: "Launch Density Role",
        company: "Launch Density Company",
        extracted_text: `Seeded density job ${marker}`,
        ingestion_status: "succeeded",
        source_type: "url_fetch",
        current_fit_analysis: {
          fitBand: "potential_fit",
          recommendation: "review",
          score: 78,
          summary: "Seeded job for first-viewport density evidence.",
        },
      });
      cleanup.job_ingestions.push(jobId);

      await authenticateDemoUser({ context, request });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await page.locator(".side-nav").getByRole("button", { name: /^Jobs$/i }).click();
      await expect(page.getByRole("heading", { name: /Role decisions/i })).toBeVisible();

      const firstJob = page.locator(".job-record").first();
      await expect(firstJob).toBeVisible();
      const box = await firstJob.boundingBox();

      expect(box?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(420);
    } finally {
      await cleanRowsByIds(admin, "job_ingestions", cleanup.job_ingestions);
    }
  });
});
