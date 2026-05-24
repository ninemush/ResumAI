import { expect, test } from "@playwright/test";

test("renders the entry page without the Next.js hydration overlay", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/");

  await expect(page).toHaveTitle(/Pramania/);
  await expect(page.getByText("Hydration failed", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Recoverable Error", { exact: false })).toHaveCount(0);
  await expect(page.locator("body")).toContainText(/Pramania/i);
  await expect(page.locator("body")).toContainText(/Turn your experience into a sharper career story/i);
  await expect(page.locator("body")).toContainText(/OverviewFeaturesPricing|Overview/i);
  expect(consoleErrors.join("\n")).not.toMatch(/Hydration failed|server rendered HTML/i);
});
