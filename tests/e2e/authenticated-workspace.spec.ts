import { expect, test } from "@playwright/test";

import { authenticateDemoUser, hasDemoAuthEnv } from "./helpers/demo-auth";

test.describe("authenticated workspace", () => {
  test.skip(!hasDemoAuthEnv(), "Demo auth env is required for signed-in workspace QA.");

  test.beforeEach(async ({ context, request }) => {
    await authenticateDemoUser({ context, request });
  });

  test("renders the signed-in cockpit without marketing or hydration errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    await page.goto("/");

    await expect(page.getByRole("button", { name: /Cockpit/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Profile & Resume/i })).toBeVisible();
    await expect(page.getByText("Career advisor")).toBeVisible();
    await expect(page.getByText("Turn your experience into a sharper career story")).toHaveCount(0);
    await expect(page.getByText("Hydration failed", { exact: false })).toHaveCount(0);
    expect(consoleErrors.join("\n")).not.toMatch(/Hydration failed|server rendered HTML/i);
  });

  test("keeps record-heavy workspace pages in focus on mobile", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile workspace focus is a mobile-specific regression check.");

    await page.goto("/");
    await page.locator(".side-nav").getByRole("button", { name: /^Jobs$/i }).click();

    await expect(page.getByRole("heading", { name: /Role decisions/i })).toBeVisible();
    await expect(page.getByText("Career advisor")).toBeVisible();

    const jobsBox = await page.getByRole("heading", { name: /Role decisions/i }).boundingBox();
    const advisorBox = await page.getByText("Career advisor").boundingBox();

    expect(jobsBox?.y ?? 0).toBeLessThan(advisorBox?.y ?? Number.POSITIVE_INFINITY);
  });
});
