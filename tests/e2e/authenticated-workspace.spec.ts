import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  authenticateDemoUser,
  buildAuthCookieHeader,
  hasDemoAuthEnv,
  loadLocalEnv,
} from "./helpers/demo-auth";

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
      await expect(page.getByRole("button", { name: /^Profile$/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /^More$/i })).toBeVisible();
      await page.getByRole("button", { name: /^More$/i }).click();
      await expect(page.getByRole("button", { name: /^Library$/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Settings$/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Support$/i })).toBeVisible();
    } else {
      await expect(page.getByRole("button", { name: /^Home$/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /Profile & Resume/i })).toBeVisible();
      await expect(page.getByRole("region", { name: "Since your last visit" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "What needs attention now" })).toBeVisible();
    }
    await expect(page.getByText("Career advisor")).toBeVisible();
    await expect(page.getByText("Turn your experience into a sharper career story")).toHaveCount(0);
    await expect(page.getByText("Hydration failed", { exact: false })).toHaveCount(0);
    expect(consoleErrors.join("\n")).not.toMatch(/Hydration failed|server rendered HTML|readReturnBrief/i);
  });

  test("keeps source intake centered in Pramania chat with only reliably parseable file types", async ({ page }) => {
    await page.goto("/");

    const conversation = page.locator(".conversation-pane");
    await expect(conversation.getByPlaceholder(/Role, link, notes, or resume/i)).toBeVisible();

    const fileInput = conversation.locator('input[type="file"]');
    const accept = await fileInput.getAttribute("accept");
    const fileInputId = await fileInput.getAttribute("id");

    expect(accept).toContain(".pdf");
    expect(accept).toContain(".docx");
    expect(accept).toContain(".txt");
    expect(accept).toContain(".zip");
    expect(accept).toContain(".jpg");
    expect(accept).not.toMatch(/(^|,)\.doc(,|$)/);
    expect(accept).not.toMatch(/\.heic|\.heif/);
    await expect(fileInput).toHaveAttribute(
      "aria-label",
      "Attach resume, career source, or profile file",
    );
    await expect(conversation.getByRole("button", { name: "Attach file" })).toHaveAttribute(
      "aria-controls",
      fileInputId ?? "",
    );
  });

  test("keeps the chat composer controls visible at narrow widths", async ({ page }) => {
    for (const width of [340, 400, 500]) {
      await page.setViewportSize({ width, height: 720 });
      await page.goto("/");

      const input = page.getByPlaceholder(/Role, link, notes, or resume|Notes, role, link, or resume/i);
      await expect(input).toBeVisible();
      await input.fill("nfkdsnfskd");
      const compact = await assertComposerGeometry(page, `compact ${width}px`, false);

      await input.fill("First useful line\nSecond useful line\nThird useful line");
      const expanded = await assertComposerGeometry(page, `three-line ${width}px`, true);
      expect(expanded.form.height, `three-line ${width}px: composer grows`).toBeGreaterThan(compact.form.height);
      expect(expanded.textarea?.scrollHeight ?? 0, `three-line ${width}px: no internal scroll yet`).toBeLessThanOrEqual(
        (expanded.textarea?.clientHeight ?? 0) + 2,
      );

      await input.fill("Line one\nLine two\nLine three\nLine four should scroll\nLine five should scroll");
      const overflowing = await assertComposerGeometry(page, `overflowing ${width}px`, true);
      expect(overflowing.textarea?.scrollHeight ?? 0, `overflowing ${width}px: internal scroll exists`).toBeGreaterThan(
        (overflowing.textarea?.clientHeight ?? 0) + 2,
      );
      expect(overflowing.textarea?.overflowY, `overflowing ${width}px: textarea scrolls`).toBe("auto");
    }
  });

  test("keeps record-heavy workspace pages in focus on mobile", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile workspace focus is a mobile-specific regression check.");

    await page.goto("/");
    await page.getByRole("button", { name: /^Jobs$/i }).last().click();

    await expect(page.getByRole("heading", { name: /Role decisions/i })).toBeVisible();
    await expect(page.getByText("Career advisor")).toBeHidden();
    await expect(page.locator(".mobile-workspace-nav")).toBeVisible();
    await expect(page.locator(".conversation-pane-controls")).toBeHidden();
    await expect(page.locator(".conversation-resize-handle")).toBeHidden();
    await expect(page.locator(".conversation-collapsed-rail")).toBeHidden();
    await expect(page.getByRole("button", { name: /^S$/ })).toBeHidden();
    await expect(page.getByRole("button", { name: /^M$/ })).toBeHidden();
    await expect(page.getByRole("button", { name: /^L$/ })).toBeHidden();
  });

  test("keeps the mobile More drawer keyboard-contained", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile drawer keyboard behavior is mobile-specific.");

    await page.goto("/");
    const moreButton = page.getByRole("button", { name: /^More$/i });
    await moreButton.click();

    const drawer = page.getByRole("dialog", { name: "More workspace destinations" });
    await expect(drawer).toBeVisible();
    await expect(page.getByRole("button", { name: /^Resume$/i })).toBeFocused();

    await page.keyboard.press("Shift+Tab");
    await expect(drawer.getByRole("button").last()).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: /^Resume$/i })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(moreButton).toBeFocused();
  });

  test("keeps profile mode chat-first on mobile without profile overview overlap", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile chat-first layout is a mobile-specific regression check.");

    await page.goto("/");

    await expect(page.getByText("Career advisor")).toBeVisible();
    await expect(page.getByText("Profile home")).toBeHidden();

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

  test("deduplicates advisor chips that navigate to the same place", async ({ page }) => {
    await page.route("**/api/conversation/advisor", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          assistantMessage:
            "You have 14 credits available. You have used 6 of 20 total credits. Recent usage: 2 credits for Drafted job-specific materials on Jun 4.",
          suggestedActions: [
            {
              creditCost: null,
              id: "open-settings-credits",
              kind: "navigate",
              label: "Open Credits",
              reason: "Open Settings to review credit balance and history.",
              view: "settings",
            },
          ],
          suggestedLinks: [
            {
              label: "Open Credits",
              reason: "Review credit balance and history.",
              view: "settings",
            },
            {
              label: "Open Library",
              reason: "Review files and generated materials.",
              view: "library",
            },
          ],
        }),
        status: 200,
      });
    });

    await page.goto("/");

    const input = page.getByPlaceholder(/Role, link, notes, or resume|Notes, role, link, or resume/i);
    await input.fill("What credits do I have?");
    await page.getByRole("button", { name: /Send message/i }).click();

    const latestAssistant = page.locator(".assistant-message").last();
    await expect(latestAssistant.getByText(/14 credits available/i)).toBeVisible();
    await expect(latestAssistant.getByText(/Recent usage: 2 credits/i)).toBeVisible();
    await expect(latestAssistant.getByRole("button", { name: "Go to Settings" })).toHaveCount(1);
    await expect(latestAssistant.getByRole("button", { name: "Go to Library" })).toHaveCount(1);
    await expect(latestAssistant.locator(".advisor-action-row button")).toHaveCount(2);
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
    await expect(page.getByText(/One-time credit pack. No auto-charge or auto-renew/i)).toHaveCount(2);
    await expect(page.getByText("Purchase link pending", { exact: false })).toHaveCount(0);
    await expect(page.getByText("Workspace controls")).toHaveCount(0);
  });

  test("keeps the master resume document from horizontal overflow", async ({ page, isMobile }) => {
    test.skip(isMobile, "The mobile resume layout has its own responsive constraints.");

    await page.goto("/");
    await page.locator(".side-nav").getByRole("button", { name: /Profile & Resume/i }).click();
    await expect(page.getByRole("heading", { name: /Master profile and resume/i })).toBeVisible();
    const proofPanel = page.getByRole("region", { name: /Resume source proof/i });
    await expect(proofPanel).toBeVisible();
    await expect(proofPanel.getByText(/Sources used/i)).toBeVisible();
    await expect(proofPanel.getByText("Chronology", { exact: true })).toBeVisible();
    await expect(proofPanel.getByText(/Claims to verify/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Rebuild resume - 2 credits|Create resume - 2 credits/i })).toBeVisible();

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
    await expect(page.locator(".workspace-shell")).toHaveClass(/owner-focus-mode/);
    await expect(page.locator(".conversation-pane")).toHaveCount(0);
    const ownerHeaderBox = await page.locator(".owner-console-header").boundingBox();
    expect(ownerHeaderBox?.width ?? 0).toBeGreaterThan(560);
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

    await ownerTabs.getByRole("button", { name: /^Promo codes$/i }).click();
    await expect(page.getByRole("heading", { name: /Promo code management/i })).toBeVisible();

    const creditCards = page.locator(".owner-credit-actions .owner-credit-card");
    await expect(creditCards).toHaveCount(2);
    const cardBoxes = await creditCards.evaluateAll((cards) =>
      cards.map((card) => {
        const box = card.getBoundingClientRect();
        return {
          bottom: box.bottom,
          top: box.top,
        };
      }),
    );
    expect(cardBoxes[1].top).toBeGreaterThan(cardBoxes[0].bottom - 1);

    const recipientSearch = page.getByPlaceholder(/Search name, email, or user id/i);
    await expect(recipientSearch).toBeVisible();
    await expect(page.locator("#owner-credit-user-suggestions")).toHaveCount(0);
    await recipientSearch.fill("a");
    await expect(page.locator("#owner-credit-user-suggestions")).toBeVisible();
    await recipientSearch.fill("");
    await expect(page.locator("#owner-credit-user-suggestions")).toHaveCount(0);

    const promoHead = page.locator(".owner-promo-table .owner-table-head");
    await expect(promoHead).toBeVisible();
    const promoColumnCount = await promoHead.evaluate(
      (row) => getComputedStyle(row).gridTemplateColumns.split(" ").filter(Boolean).length,
    );
    expect(promoColumnCount).toBe(4);
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

    await page.locator(".side-nav").getByRole("button", { name: /^Home$/i }).click();
    await expect(page.getByRole("heading", { name: /Master profile and resume/i })).toBeVisible();
  });
});

test.describe("protected API auth gates", () => {
  test.skip(!hasDemoAuthEnv(), "Demo auth env is required for API auth-gate QA.");

  test("blocks password sessions that have not completed email-code verification", async ({ request }) => {
    loadLocalEnv();
    test.skip(
      process.env.AUTH_REQUIRE_EMAIL_CODE !== "true",
      "AUTH_REQUIRE_EMAIL_CODE=true is required for the MFA direct-API regression.",
    );

    const cookie = await buildAuthCookieHeader({
      email: process.env.QA_DEMO_EMAIL ?? "",
      includeEmailMfa: false,
      password: process.env.QA_DEMO_PASSWORD ?? "",
      request,
    });

    const response = await request.get("/api/billing/credits", {
      headers: { cookie },
    });
    const payload = await response.json();

    expect(response.status()).toBe(403);
    expect(payload.error.code).toBe("auth.email_code_required");
  });
});

async function assertComposerGeometry(page: Page, label: string, expectedExpanded: boolean) {
  const metrics = await page.locator(".chat-input").evaluate((form) => {
    function rectFor(selector: string) {
      const element = form.querySelector(selector);
      if (!element) {
        return null;
      }

      const rect = element.getBoundingClientRect();
      const styles = window.getComputedStyle(element);

      return {
        bottom: rect.bottom,
        display: styles.display,
        height: rect.height,
        left: rect.left,
        opacity: Number(styles.opacity || "1"),
        outlineStyle: styles.outlineStyle,
        overflowY: styles.overflowY,
        right: rect.right,
        scrollHeight:
          element instanceof HTMLTextAreaElement ? element.scrollHeight : rect.height,
        clientHeight:
          element instanceof HTMLTextAreaElement ? element.clientHeight : rect.height,
        top: rect.top,
        visibility: styles.visibility,
        width: rect.width,
      };
    }

    const formRect = form.getBoundingClientRect();

    return {
      attach: rectFor(".attach-button"),
      expanded: form.classList.contains("expanded"),
      form: {
        bottom: formRect.bottom,
        height: formRect.height,
        left: formRect.left,
        right: formRect.right,
        top: formRect.top,
        width: formRect.width,
      },
      mic: rectFor(".voice-button"),
      send: rectFor('button[type="submit"]'),
      textarea: rectFor("textarea"),
    };
  });

  expect(metrics.expanded, `${label}: expanded state`).toBe(expectedExpanded);
  expect(metrics.form.height, `${label}: composer height`).toBeGreaterThanOrEqual(52);

  for (const [name, rect] of Object.entries({
    attach: metrics.attach,
    mic: metrics.mic,
    send: metrics.send,
    textarea: metrics.textarea,
  })) {
    expect(rect, `${label}: ${name} exists`).not.toBeNull();
    expect(rect?.display, `${label}: ${name} display`).not.toBe("none");
    expect(rect?.visibility, `${label}: ${name} visibility`).not.toBe("hidden");
    expect(rect?.opacity, `${label}: ${name} opacity`).toBeGreaterThan(0);
    expect(rect?.width ?? 0, `${label}: ${name} width`).toBeGreaterThan(20);
    expect(rect?.height ?? 0, `${label}: ${name} height`).toBeGreaterThan(20);
    expect(rect?.left ?? 0, `${label}: ${name} left inside composer`).toBeGreaterThanOrEqual(metrics.form.left - 1);
    expect(rect?.right ?? 0, `${label}: ${name} right inside composer`).toBeLessThanOrEqual(metrics.form.right + 1);
    expect(rect?.top ?? 0, `${label}: ${name} top inside composer`).toBeGreaterThanOrEqual(metrics.form.top - 1);
    expect(rect?.bottom ?? 0, `${label}: ${name} bottom inside composer`).toBeLessThanOrEqual(metrics.form.bottom + 1);
  }

  expect(metrics.textarea?.outlineStyle, `${label}: textarea outline`).toBe("none");
  expect(metrics.textarea?.left ?? 0, `${label}: textarea after mic`).toBeGreaterThan(metrics.mic?.right ?? 0);
  expect(metrics.send?.left ?? 0, `${label}: send after textarea`).toBeGreaterThan(metrics.textarea?.left ?? 0);
  expect(Math.abs((metrics.attach?.bottom ?? 0) - (metrics.send?.bottom ?? 0)), `${label}: attach bottom-aligned`).toBeLessThanOrEqual(4);
  expect(Math.abs((metrics.mic?.bottom ?? 0) - (metrics.send?.bottom ?? 0)), `${label}: mic bottom-aligned`).toBeLessThanOrEqual(4);
  expect(metrics.send?.bottom ?? 0, `${label}: controls sit near composer bottom`).toBeGreaterThan((metrics.form.bottom ?? 0) - 14);

  return metrics;
}

async function expectCompactRecordIfPresent(page: Page, heading: string, rowSelector: string) {
  if ((await page.locator(rowSelector).count()) === 0) {
    return;
  }

  const headingBox = await page.getByRole("heading", { name: new RegExp(heading, "i") }).boundingBox();
  const rowBox = await page.locator(rowSelector).first().boundingBox();

  expect(rowBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan((headingBox?.y ?? 0) + 260);
  expect(rowBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThan(190);
}
