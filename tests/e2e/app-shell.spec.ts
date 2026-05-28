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

test("requires terms acceptance before local account creation", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Full name").fill("Terms Test User");
  await page.getByLabel("Email").fill(`terms-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: /Start my private profile/i }).click();

  await expect(page.getByText(/accept the Terms and Conditions/i)).toBeVisible();
});

test("renders the terms document", async ({ page }) => {
  await page.goto("/terms");

  await expect(page.getByRole("heading", { name: "Terms and Conditions" })).toBeVisible();
  await expect(page.locator("body")).toContainText(/User Responsibility/i);
  await expect(page.locator("body")).toContainText(/No Employment, Hiring, or Outcome Guarantee/i);
});
