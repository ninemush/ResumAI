import { mkdir, writeFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

import { authenticateDemoUser, hasDemoAuthEnv } from "./helpers/demo-auth";

const workspaceViews = [
  { marker: /Profile home/i, nav: /^Home$/i, shot: "01-home" },
  { marker: /Master profile and resume/i, nav: /Profile & Resume/i, shot: "02-profile-resume" },
  { marker: /Role decisions/i, nav: /^Jobs$/i, shot: "03-jobs" },
  { marker: /Roles you’re pursuing/i, nav: /^Applications$/i, shot: "04-applications" },
  { marker: /Files and generated materials/i, nav: /^Library$/i, shot: "05-library" },
  { marker: /Account, billing, and access/i, nav: /^Settings$/i, shot: "07-settings" },
];

const mobileWorkspaceViews = [
  { marker: /Master profile and resume/i, nav: /^Profile$/i, shot: "02-profile-resume" },
  { marker: /Role decisions/i, nav: /^Jobs$/i, shot: "03-jobs" },
  { marker: /Roles you’re pursuing/i, nav: /^Apps$/i, shot: "04-applications" },
];

test.describe("emulated user journey QA", () => {
  test.skip(!hasDemoAuthEnv(), "Demo auth env is required for signed-in journey QA.");

  test.beforeEach(async ({ context, request }) => {
    await authenticateDemoUser({ context, request });
  });

  test("walks the product like a returning user and records UX signals", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const isMobileProject = testInfo.project.name.toLowerCase().includes("mobile");
    const consoleErrors: string[] = [];
    const findings: Array<{ detail: string; severity: "blocker" | "concern" | "note"; surface: string }> = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    await page.goto("/");
    await page.addStyleTag({
      content: "nextjs-portal { pointer-events: none !important; }",
    });
    await expect(page.getByText("Career advisor")).toBeVisible();
    await expect(page.getByText("Hydration failed", { exact: false })).toHaveCount(0);

    await screenshot(page, testInfo, "00-returning-user-start");
    await auditSurface(page, "Returning home", findings);

    if (isMobileProject) {
      await expect(page.locator(".mobile-workspace-nav")).toBeVisible();
      await expect(page.locator(".side-nav")).toBeHidden();
    } else {
      await page.getByRole("button", { name: /Collapse navigation/i }).click();
      await expect(page.getByRole("button", { name: /Expand navigation/i })).toBeVisible();
      await page.getByRole("button", { name: /Expand navigation/i }).click();
      await expect(page.getByRole("button", { name: /Collapse navigation/i })).toBeVisible();
    }

    const viewsToAudit = isMobileProject ? mobileWorkspaceViews : workspaceViews;
    const navRoot = isMobileProject ? page.locator(".mobile-workspace-nav") : page.locator(".side-nav");

    for (const view of viewsToAudit) {
      await navRoot.getByRole("button", { name: view.nav }).click();
      await expect(page.locator(".workspace-main").getByText(view.marker).first()).toBeVisible();
      await screenshot(page, testInfo, view.shot);
      await auditSurface(page, view.shot, findings);
    }

    if (isMobileProject) {
      await page.locator(".mobile-workspace-nav").getByRole("button", { name: /^Chat$/i }).click();
      await expect(page.locator(".workspace-main")).toBeHidden();
    } else {
      await page.locator(".side-nav").getByRole("button", { name: /^Home$/i }).click();
    }
    await expect(page.getByText("Career advisor")).toBeVisible();

    const input = page.getByPlaceholder(/Notes, role, link, or resume/i);
    await input.fill(
      "Based on what you already know about me, what are the strongest role lanes and what should my resume improve first?",
    );
    await page.getByRole("button", { name: /Send message/i }).click();
    await expect(page.locator(".pending-message")).toBeVisible();

    await input.fill("Also, which metric should I quantify first?");
    await expect(page.getByRole("button", { name: /Send message/i })).toBeEnabled();
    await page.getByRole("button", { name: /Send message/i }).click();
    await expect(
      page.locator(".user-message").filter({ hasText: "which metric should I quantify" }).last(),
    ).toBeVisible();

    await expect(page.locator(".pending-message")).toHaveCount(0, { timeout: 75_000 });
    const latestAssistant = page.locator(".assistant-message").last();
    await expect(latestAssistant).toBeVisible();
    const latestText = await latestAssistant.innerText();

    if (
      /deeper advisor read|profile intake is unavailable|share the resume, role, or profile point again|profile facts|profile signals|captured signals/i.test(
        latestText,
      )
    ) {
      findings.push({
        detail: `Advisor returned low-quality/internal fallback text: ${latestText.slice(0, 280)}`,
        severity: "blocker",
        surface: "Conversation",
      });
    }

    if (latestText.length < 180) {
      findings.push({
        detail: `Advisor response was too thin for a senior career guidance prompt: ${latestText}`,
        severity: "concern",
        surface: "Conversation",
      });
    }

    if (/\*\*|^#|\n-\s*$/m.test(latestText)) {
      findings.push({
        detail: "Advisor response exposed raw markdown or malformed list formatting.",
        severity: "concern",
        surface: "Conversation",
      });
    }

    await screenshot(page, testInfo, "08-chat-advisor-response");
    await testInfo.attach("user-journey-findings.json", {
      body: JSON.stringify({ consoleErrors, findings }, null, 2),
      contentType: "application/json",
    });
    await writeQaArtifact(testInfo, "findings.json", { consoleErrors, findings });
    console.log(
      `USER_JOURNEY_QA ${testInfo.project.name}: ${findings.length} finding(s), ${consoleErrors.length} console error(s).`,
    );

    expect(consoleErrors.join("\n")).not.toMatch(/Hydration failed|server rendered HTML/i);
    expect(findings.filter((finding) => finding.severity === "blocker")).toEqual([]);
  });
});

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const body = await page.screenshot({ fullPage: false });

  await writeQaArtifact(testInfo, `${name}.png`, body);
  await testInfo.attach(`${name}.png`, {
    body,
    contentType: "image/png",
  });
}

async function writeQaArtifact(testInfo: TestInfo, name: string, body: Buffer | unknown) {
  const directory = `qa-artifacts/user-journey-qa/${testInfo.project.name}`;
  await mkdir(directory, { recursive: true });
  await writeFile(
    `${directory}/${name}`,
    Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 2),
  );
}

async function auditSurface(
  page: Page,
  surface: string,
  findings: Array<{ detail: string; severity: "blocker" | "concern" | "note"; surface: string }>,
) {
  const metrics = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const documentOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;

    function isActuallyVisible(element: Element) {
      const rect = element.getBoundingClientRect();
      const styles = window.getComputedStyle(element);
      const horizontallyVisible = rect.right > 0 && rect.left < viewportWidth;
      const verticallyVisible = rect.bottom > 0 && rect.top < viewportHeight;

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        horizontallyVisible &&
        verticallyVisible &&
        styles.display !== "none" &&
        styles.visibility !== "hidden" &&
        Number(styles.opacity || "1") > 0
      );
    }

    const visibleButtons = Array.from(document.querySelectorAll("button, a"))
      .filter((element) => isActuallyVisible(element))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label:
            element.getAttribute("aria-label") ||
            element.textContent?.replace(/\s+/g, " ").trim() ||
            element.getAttribute("title") ||
            "",
          width: rect.width,
        };
      });
    const overflowingTextElements = Array.from(
      document.querySelectorAll("h1, h2, h3, p, span, button, a, textarea, input"),
    )
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const isNavigationOverflow = Boolean(element.closest(".side-nav"));
        return (
          !isNavigationOverflow &&
          isActuallyVisible(element) &&
          (rect.width > viewportWidth + 2 || rect.right > viewportWidth + 8 || rect.left < -8)
        );
      })
      .slice(0, 8)
      .map((element) => element.textContent?.replace(/\s+/g, " ").trim().slice(0, 120) ?? element.tagName);

    return {
      documentOverflow,
      emptyViewportRatio:
        document.body.innerText.trim().length < 400
          ? 1
          : Math.max(0, viewportHeight - (document.querySelector(".workspace-main")?.getBoundingClientRect().height ?? 0)) /
            viewportHeight,
      overflowingTextElements,
      smallControls: visibleButtons
        .filter((button) => button.label.length > 0 && button.width < 24)
        .slice(0, 8),
    };
  });

  if (metrics.documentOverflow > 2) {
    findings.push({
      detail: `Document has ${metrics.documentOverflow}px horizontal overflow.`,
      severity: "blocker",
      surface,
    });
  }

  if (metrics.overflowingTextElements.length > 0) {
    findings.push({
      detail: `Visible content appears outside viewport: ${metrics.overflowingTextElements.join(" | ")}`,
      severity: "concern",
      surface,
    });
  }

  if (metrics.smallControls.length > 0) {
    findings.push({
      detail: `Some visible interactive controls are very small: ${metrics.smallControls
        .map((button) => `${button.label || "unlabelled"} (${Math.round(button.width)}px)`)
        .join(", ")}`,
      severity: "concern",
      surface,
    });
  }
}
