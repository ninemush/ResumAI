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
  await expect(page.locator("body")).toContainText(/Pramania|Career clarity/i);
  expect(consoleErrors.join("\n")).not.toMatch(/Hydration failed|server rendered HTML/i);
});
