import { expect, test } from "@playwright/test";

import {
  buildAdminAuthCookieHeader,
  buildAuthCookieHeader,
  hasLaunchReadinessEnv,
  loadLocalEnv,
} from "./helpers/demo-auth";
import { createServiceRoleClient } from "./helpers/launch-fixtures";

test.describe("owner operations maturity", () => {
  test.skip(
    !hasLaunchReadinessEnv(),
    "Launch readiness env, service role, admin, and QA credentials are required for owner operations evidence.",
  );

  test("allows owners to export selected-period metrics as CSV and writes audit evidence", async ({ request }) => {
    loadLocalEnv();

    const adminCookie = await buildAdminAuthCookieHeader({ request });
    const response = await request.get("/api/admin/metrics/export?periodDays=30", {
      headers: { cookie: adminCookie },
    });
    const csv = await response.text();

    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["content-disposition"]).toContain(
      "pramania-owner-metrics-30d-sanitized.csv",
    );
    expect(csv).toContain("# summary");
    expect(csv).toContain("credits_used");
    expect(csv).toContain("# user_economics");
    expect(csv).toContain("# credit_consumption_evidence");

    const admin = createServiceRoleClient();
    const { data: auditRows, error } = await admin
      .from("admin_access_audit_events")
      .select("id, access_reason, resource_type, visibility_level, created_at")
      .eq("access_reason", "owner_metrics_read")
      .eq("resource_type", "owner_metrics")
      .order("created_at", { ascending: false })
      .limit(1);

    expect(error).toBeNull();
    expect(auditRows?.[0]).toMatchObject({
      access_reason: "owner_metrics_read",
      resource_type: "owner_metrics",
      visibility_level: "user_support_context",
    });
  });

  test("includes release provenance in owner-only platform status", async ({ request }) => {
    loadLocalEnv();

    const adminCookie = await buildAdminAuthCookieHeader({ request });
    const response = await request.get("/api/admin/platform-status", {
      headers: { cookie: adminCookie },
    });
    const payload = await response.json();

    expect(response.ok()).toBe(true);
    expect(payload.status.release).toMatchObject({
      buildTime: expect.any(String),
      capturedAt: expect.any(String),
      provenanceAvailable: expect.any(Boolean),
      targetEnvironment: expect.any(String),
    });
    expect(Object.keys(payload.status.release).sort()).toEqual([
      "branchUrl",
      "buildTime",
      "capturedAt",
      "deploymentId",
      "deploymentUrl",
      "gitCommitRef",
      "gitCommitSha",
      "provenanceAvailable",
      "targetEnvironment",
    ]);
    expect(payload.status.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          impact: "availability",
          label: "Release Provenance",
        }),
      ]),
    );
    expect(JSON.stringify(payload.status.release)).not.toMatch(
      /authorization|bearer|cookie|password|secret|service_role/i,
    );
  });

  test("denies non-admin metrics CSV export", async ({ request }) => {
    loadLocalEnv();

    const userCookie = await buildAuthCookieHeader({
      email: process.env.QA_DEMO_USER_A_EMAIL ?? "",
      password: process.env.QA_DEMO_USER_A_PASSWORD ?? "",
      request,
    });
    const response = await request.get("/api/admin/metrics/export?periodDays=30", {
      headers: { cookie: userCookie },
    });
    const payload = await response.json();

    expect(response.status()).toBe(403);
    expect(payload.error.code).toBe("admin.required");
  });
});
