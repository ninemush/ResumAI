import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

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

  test("keeps profile mode chat-first on mobile without cockpit overlap", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile chat-first layout is a mobile-specific regression check.");

    await page.goto("/");

    await expect(page.getByText("Career advisor")).toBeVisible();
    await expect(page.getByText("Profile cockpit")).toBeVisible();

    const shellClassName = await page.locator(".workspace-shell").evaluate((element) => element.className);
    const layoutBoxes = await page.evaluate(() => {
      const conversation = document.querySelector(".conversation-pane")?.getBoundingClientRect();
      const workspace = document.querySelector(".workspace-main")?.getBoundingClientRect();

      return {
        conversation: conversation
          ? {
              bottom: conversation.bottom,
              top: conversation.top,
            }
          : null,
        workspace: workspace
          ? {
              bottom: workspace.bottom,
              top: workspace.top,
            }
          : null,
      };
    });

    expect(shellClassName).toContain("conversation-first");
    expect(layoutBoxes.conversation?.top ?? Number.POSITIVE_INFINITY).toBeLessThan(
      layoutBoxes.workspace?.top ?? 0,
    );
    expect(layoutBoxes.conversation?.bottom ?? 0).toBeLessThanOrEqual(
      (layoutBoxes.workspace?.top ?? Number.POSITIVE_INFINITY) + 1,
    );
  });

  test("answers broad advisor questions from saved workspace context", async ({ page, isMobile }) => {
    test.skip(isMobile, "Advisor quality is viewport-independent and only needs one signed-in probe.");
    test.setTimeout(75_000);

    await page.goto("/");

    const response = await page.evaluate(async () => {
      const request = await fetch("/api/conversation/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message:
            "Based on what you already know about me, what career advice would you give and what metrics am I missing?",
          surface: "profile",
        }),
      });

      return {
        body: await request.json(),
        status: request.status,
      };
    });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.assistantMessage).toEqual(expect.any(String));
    expect(response.body.assistantMessage.length).toBeGreaterThan(160);
    expect(response.body.assistantMessage).not.toMatch(
      /deeper advisor read|profile intake is unavailable|share the resume, role, or profile point again|captured signals|profile facts/i,
    );
  });

  test("keeps record-heavy desktop surfaces compact and action oriented", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop record density is covered separately from mobile focus.");

    await page.goto("/");

    await page.locator(".side-nav").getByRole("button", { name: /^Jobs$/i }).click();
    await expect(page.getByRole("heading", { name: /Role decisions/i })).toBeVisible();
    await expect(page.getByText("Roles under review")).toHaveCount(0);
    await expectCompactRecordIfPresent(page, "Role decisions", ".job-record");

    await page.locator(".side-nav").getByRole("button", { name: /^Applications$/i }).click();
    await expect(page.getByRole("heading", { name: /Application pipeline/i })).toBeVisible();
    await expect(page.getByText("Follow-up tracker")).toHaveCount(0);
    await expectCompactRecordIfPresent(page, "Application pipeline", ".application-record");

    await page.locator(".side-nav").getByRole("button", { name: /^Artifacts$/i }).click();
    await expect(page.getByRole("heading", { name: /Generated materials/i })).toBeVisible();
    await expectCompactRecordIfPresent(page, "Generated materials", ".artifact-record");

    await page.locator(".side-nav").getByRole("button", { name: /^Sources$/i }).click();
    await expect(page.getByRole("heading", { name: /Source library/i })).toBeVisible();
    await expect(page.getByText("Knowledgebase", { exact: false })).toHaveCount(0);
    await expect(page.getByText("Captured details", { exact: false })).toHaveCount(0);
    await expect(page.getByText("profile signals", { exact: false })).toHaveCount(0);

    await page.locator(".side-nav").getByRole("button", { name: /^Settings$/i }).click();
    await expect(page.getByRole("heading", { name: /Account and privacy/i })).toBeVisible();
    await expect(page.getByText("Workspace controls")).toHaveCount(0);
  });

  test("keeps the master resume document from horizontal overflow", async ({ page, isMobile }) => {
    test.skip(isMobile, "The mobile resume layout has its own responsive constraints.");

    await page.goto("/");
    await page.locator(".side-nav").getByRole("button", { name: /Profile & Resume/i }).click();
    await expect(page.getByRole("heading", { name: /Master profile and resume/i })).toBeVisible();

    const preview = page.locator(".resume-document-preview").first();
    await expect(preview).toBeVisible();

    const overflow = await preview.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));

    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
  });

  test("warns before leaving unsaved master resume edits", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop navigation guard is covered here; mobile uses the same view switch handler.");

    await page.goto("/");
    await page.locator(".side-nav").getByRole("button", { name: /Profile & Resume/i }).click();
    await expect(page.getByRole("heading", { name: /Master profile and resume/i })).toBeVisible();

    const headline = page.getByLabel("Resume headline");
    await expect(headline).toBeVisible();
    await headline.fill("Temporary QA headline");

    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toMatch(/unsaved resume edits/i);
      await dialog.dismiss();
    });

    await page.locator(".side-nav").getByRole("button", { name: /^Cockpit$/i }).click();
    await expect(page.getByRole("heading", { name: /Master profile and resume/i })).toBeVisible();
  });
});

async function expectCompactRecordIfPresent(page: Page, heading: string, rowSelector: string) {
  if ((await page.locator(rowSelector).count()) === 0) {
    return;
  }

  const headingBox = await page.getByRole("heading", { name: new RegExp(heading, "i") }).boundingBox();
  const rowBox = await page.locator(rowSelector).first().boundingBox();

  expect(rowBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan((headingBox?.y ?? 0) + 260);
  expect(rowBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThan(190);
}
