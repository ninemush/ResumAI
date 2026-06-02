import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { authenticateDemoUser, hasDemoAuthEnv } from "./helpers/demo-auth";

test.describe("authenticated workspace", () => {
  test.skip(!hasDemoAuthEnv(), "Demo auth env is required for signed-in workspace QA.");

  test.beforeEach(async ({ context, request }) => {
    await authenticateDemoUser({ context, request });
  });

  test("renders the signed-in workspace without marketing or hydration errors", async ({ page, isMobile }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    await page.goto("/");

    if (isMobile) {
      await expect(page.getByText("Career advisor")).toBeVisible();
      await expect(page.getByRole("button", { name: /^Chat$/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Resume$/i })).toBeVisible();
    } else {
      await expect(page.getByRole("button", { name: /Cockpit/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /Profile & Resume/i })).toBeVisible();
    }
    await expect(page.getByText("Career advisor")).toBeVisible();
    await expect(page.getByText("Turn your experience into a sharper career story")).toHaveCount(0);
    await expect(page.getByText("Hydration failed", { exact: false })).toHaveCount(0);
    expect(consoleErrors.join("\n")).not.toMatch(/Hydration failed|server rendered HTML/i);
  });

  test("keeps source intake centered in Pramania chat with only reliably parseable file types", async ({ page }) => {
    await page.goto("/");

    const conversation = page.locator(".conversation-pane");
    await expect(conversation.getByPlaceholder(/Share background, role, link, or resume/i)).toBeVisible();

    const accept = await conversation.locator('input[type="file"]').getAttribute("accept");

    expect(accept).toContain(".pdf");
    expect(accept).toContain(".docx");
    expect(accept).toContain(".txt");
    expect(accept).toContain(".zip");
    expect(accept).toContain(".jpg");
    expect(accept).not.toMatch(/(^|,)\.doc(,|$)/);
    expect(accept).not.toMatch(/\.heic|\.heif/);
  });

  test("keeps record-heavy workspace pages in focus on mobile", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile workspace focus is a mobile-specific regression check.");

    await page.goto("/");
    await page.getByRole("button", { name: /^Jobs$/i }).last().click();

    await expect(page.getByRole("heading", { name: /Role decisions/i })).toBeVisible();
    await expect(page.getByText("Career advisor")).toBeHidden();
    await expect(page.locator(".mobile-workspace-nav")).toBeVisible();
  });

  test("keeps profile mode chat-first on mobile without cockpit overlap", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile chat-first layout is a mobile-specific regression check.");

    await page.goto("/");

    await expect(page.getByText("Career advisor")).toBeVisible();
    await expect(page.getByText("Profile cockpit")).toBeHidden();

    const shellClassName = await page.locator(".workspace-shell").evaluate((element) => element.className);
    const layoutState = await page.evaluate(() => {
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
        workspaceVisible: Boolean(
          workspace &&
            workspace.width > 0 &&
            workspace.height > 0 &&
            getComputedStyle(document.querySelector(".workspace-main") as Element).display !== "none",
        ),
      };
    });

    expect(shellClassName).toContain("conversation-first");
    expect(layoutState.conversation?.top ?? Number.POSITIVE_INFINITY).toBeLessThan(240);
    expect(layoutState.workspaceVisible).toBe(false);
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
    await expect(page.getByRole("heading", { name: /Roles you’re pursuing/i })).toBeVisible();
    await expect(page.getByText("Follow-up tracker")).toHaveCount(0);
    await expectCompactRecordIfPresent(page, "Roles you’re pursuing", ".application-record");

    await page.locator(".side-nav").getByRole("button", { name: /^Library$/i }).click();
    await expect(page.getByRole("heading", { name: /Files and generated materials/i })).toBeVisible();
    await page.getByRole("tab", { name: /Generated/i }).click();
    await expect(page.getByRole("heading", { name: /Generated resumes and letters/i })).toBeVisible();
    await expectCompactRecordIfPresent(page, "Generated resumes and letters", ".artifact-record");

    await page.getByRole("tab", { name: /Uploaded/i }).click();
    await expect(page.getByRole("heading", { name: /Uploaded files and links/i })).toBeVisible();
    await expect(page.getByText("Knowledgebase", { exact: false })).toHaveCount(0);
    await expect(page.getByText("Captured details", { exact: false })).toHaveCount(0);
    await expect(page.getByText("profile signals", { exact: false })).toHaveCount(0);

    await page.locator(".side-nav").getByRole("button", { name: /^Settings$/i }).click();
    await expect(page.getByRole("heading", { name: /Account, billing, and access/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Credit usage/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Purchase history/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Send reset link/i })).toBeVisible();
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

    const sectionOrder = await preview.evaluate((element) =>
      Array.from(element.querySelectorAll("h3")).map((heading) => heading.textContent?.trim()),
    );
    const skillsIndex = sectionOrder.indexOf("Core Skills");
    const highlightsIndex = sectionOrder.indexOf("Selected Highlights");
    const experienceIndex = sectionOrder.indexOf("Professional Experience");

    expect(skillsIndex).toBeGreaterThanOrEqual(0);
    expect(highlightsIndex).toBeGreaterThan(skillsIndex);
    expect(experienceIndex).toBeGreaterThan(highlightsIndex);

    const roleMetaOverflow = await preview.locator(".resume-role-meta-row").evaluateAll((rows) =>
      rows.map((row) => ({
        clientWidth: row.clientWidth,
        scrollWidth: row.scrollWidth,
      })),
    );

    for (const row of roleMetaOverflow) {
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 2);
    }
  });

  test("shows an operational owner console when the signed-in account is an owner", async ({ page, isMobile }) => {
    test.skip(isMobile, "Owner console desktop density is the critical launch surface.");

    await page.goto("/");

    const ownerNav = page.locator(".side-nav").getByRole("button", { name: /^Owner Console$/i });
    test.skip((await ownerNav.count()) === 0, "Demo account is not configured as owner/admin.");

    await ownerNav.click();

    await expect(page.getByRole("main", { name: /Operating command center/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Today/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /30 days/i })).toBeVisible();
    await expect(page.getByRole("region", { name: /Operating metrics/i })).toBeVisible();

    await expect(page.getByRole("button", { name: /^Users$/i })).toBeVisible();
    const ownerTabs = page.getByLabel("Owner console sections");

    await ownerTabs.getByRole("button", { name: /^Users$/i }).click();
    await expect(page.getByRole("heading", { name: /User operating list/i })).toBeVisible();
    await expect(page.getByPlaceholder(/Search users/i)).toBeVisible();

    await ownerTabs.getByRole("button", { name: /^Errors$/i }).click();
    await expect(page.getByRole("heading", { name: /Errors and root-cause review/i })).toBeVisible();

    await ownerTabs.getByRole("button", { name: /^Support$/i }).click();
    await expect(page.getByRole("heading", { name: /Support queue/i })).toBeVisible();

    await ownerTabs.getByRole("button", { name: /^Outcomes$/i }).click();
    await expect(page.getByRole("heading", { name: /Outcome by tier/i })).toBeVisible();
  });

  test("warns before leaving unsaved master resume edits", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop navigation guard is covered here; mobile uses the same view switch handler.");

    await page.goto("/");
    await page.locator(".side-nav").getByRole("button", { name: /Profile & Resume/i }).click();
    await expect(page.getByRole("heading", { name: /Master profile and resume/i })).toBeVisible();

    await page.getByRole("button", { name: /Edit resume/i }).click();
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
