import { expect, test } from "@playwright/test";

import {
  buildAuthCookieHeader,
  hasTwoUserIsolationEnv,
  loadLocalEnv,
} from "./helpers/demo-auth";

test.describe("two-user data isolation", () => {
  test.skip(
    !hasTwoUserIsolationEnv(),
    "Two-user QA credentials are required for launch RLS/isolation evidence.",
  );

  test("keeps profile sources, privacy requests, support issues, credits, and admin routes user-scoped", async ({ request }) => {
    loadLocalEnv();

    const userACookies = await buildAuthCookieHeader({
      email: process.env.QA_DEMO_USER_A_EMAIL ?? "",
      password: process.env.QA_DEMO_USER_A_PASSWORD ?? "",
      request,
    });
    const userBCookies = await buildAuthCookieHeader({
      email: process.env.QA_DEMO_USER_B_EMAIL ?? "",
      password: process.env.QA_DEMO_USER_B_PASSWORD ?? "",
      request,
    });

    const sourceResponse = await request.post("/api/profile/sources", {
      data: {
        sourceType: "natural_language",
        text: "Two-user isolation test profile source for User A only.",
      },
      headers: { cookie: userACookies },
    });
    const sourcePayload = await sourceResponse.json();

    expect(sourceResponse.ok()).toBe(true);
    expect(sourcePayload.source.id).toMatch(/[0-9a-f-]{36}/i);

    const userASources = await request.get("/api/profile/sources", {
      headers: { cookie: userACookies },
    });
    const userBSources = await request.get("/api/profile/sources", {
      headers: { cookie: userBCookies },
    });
    const userASourcesPayload = await userASources.json();
    const userBSourcesPayload = await userBSources.json();

    expect(userASourcesPayload.sources.some((source: { id: string }) => source.id === sourcePayload.source.id)).toBe(true);
    expect(userBSourcesPayload.sources.some((source: { id: string }) => source.id === sourcePayload.source.id)).toBe(false);

    const userBDeleteSource = await request.delete(`/api/profile/sources/${sourcePayload.source.id}`, {
      headers: { cookie: userBCookies },
    });
    const userBDeletePayload = await userBDeleteSource.json();

    expect(userBDeleteSource.status()).toBe(404);
    expect(userBDeletePayload.error.code).toBe("source.not_found");

    const privacyResponse = await request.post("/api/privacy/requests", {
      data: {
        requestType: "deletion",
        subject: "Two-user isolation deletion probe",
      },
      headers: { cookie: userACookies },
    });
    const privacyPayload = await privacyResponse.json();

    expect(privacyResponse.ok()).toBe(true);
    expect(privacyPayload.request.id).toMatch(/[0-9a-f-]{36}/i);

    const userBPrivacy = await request.get("/api/privacy/requests", {
      headers: { cookie: userBCookies },
    });
    const userBPrivacyPayload = await userBPrivacy.json();

    expect(userBPrivacyPayload.requests.some((item: { id: string }) => item.id === privacyPayload.request.id)).toBe(false);

    const supportResponse = await request.post("/api/support/issues", {
      data: {
        area: "privacy",
        source: "two-user-isolation-test",
        subject: "Two-user isolation support probe",
        systemResponse: "Support route isolation check.",
        userMessage: "This should only be visible to User A.",
      },
      headers: { cookie: userACookies },
    });
    const supportPayload = await supportResponse.json();

    expect(supportResponse.ok()).toBe(true);
    expect(supportPayload.issue.id).toMatch(/[0-9a-f-]{36}/i);

    const userBSupport = await request.get("/api/support/issues", {
      headers: { cookie: userBCookies },
    });
    const userBSupportPayload = await userBSupport.json();

    expect(userBSupportPayload.issues.some((issue: { id: string }) => issue.id === supportPayload.issue.id)).toBe(false);

    const userBCredits = await request.get("/api/billing/history", {
      headers: { cookie: userBCookies },
    });
    const userBCreditsPayload = await userBCredits.json();

    expect(userBCredits.ok()).toBe(true);
    expect(JSON.stringify(userBCreditsPayload)).not.toContain(sourcePayload.source.id);

    const nonAdminMetrics = await request.get("/api/admin/metrics", {
      headers: { cookie: userBCookies },
    });
    const nonAdminMetricsPayload = await nonAdminMetrics.json();

    expect(nonAdminMetrics.status()).toBe(403);
    expect(nonAdminMetricsPayload.error.code).toBe("admin.required");
  });
});
