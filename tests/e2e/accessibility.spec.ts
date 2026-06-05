import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { authenticateDemoUser, hasDemoAuthEnv } from "./helpers/demo-auth";

const publicPages = [
  { name: "entry", path: "/" },
  { name: "terms", path: "/terms" },
  { name: "privacy", path: "/privacy" },
  { name: "credits", path: "/credits" },
];

test.describe("accessibility smoke", () => {
  test.skip(
    process.env.RUN_ACCESSIBILITY_GATES !== "1",
    "Set RUN_ACCESSIBILITY_GATES=1 for nightly or pre-release accessibility gates.",
  );

  for (const pageInfo of publicPages) {
    test(`${pageInfo.name} page has no critical accessibility violations`, async ({ page }, testInfo) => {
      await page.goto(pageInfo.path);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const seriousViolations = results.violations.filter((violation) =>
        ["critical", "serious"].includes(violation.impact ?? ""),
      );

      await testInfo.attach(`${pageInfo.name}-axe-results.json`, {
        body: JSON.stringify(results.violations, null, 2),
        contentType: "application/json",
      });

      expect(seriousViolations).toEqual([]);
    });
  }

  test("signed-in workspace has no critical accessibility violations", async ({ context, page, request }, testInfo) => {
    test.skip(!hasDemoAuthEnv(), "Demo auth env is required for signed-in accessibility smoke.");

    await authenticateDemoUser({ context, request });
    await page.goto("/");

    const results = await new AxeBuilder({ page })
      .exclude("nextjs-portal")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const criticalViolations = results.violations.filter((violation) => violation.impact === "critical");

    await testInfo.attach("workspace-axe-results.json", {
      body: JSON.stringify(results.violations, null, 2),
      contentType: "application/json",
    });

    expect(criticalViolations).toEqual([]);
  });
});
