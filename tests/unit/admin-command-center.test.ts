import { describe, expect, test } from "vitest";

import {
  countActionableComplianceItems,
  countAvailabilityPlatformIssues,
  countCleanupPlatformItems,
  computePromoCodeState,
  formatAdminRootCauseLabel,
  groupPrivacyRequestsById,
  promoNeedsOwnerAction,
  summarizeOutcomePatternWithSample,
  supportTicketNeedsOwnerAction,
  userMatchesAdminQuickFilter,
} from "@/lib/admin/command-center";
import { summarizeOverallStatus } from "@/lib/admin/platform-health";
import type { OwnerMetrics } from "@/lib/admin/owner-metrics";
import type { PlatformStatusOverview } from "@/lib/admin/platform-status";

const now = new Date("2026-06-13T12:00:00.000Z");

describe("admin command center helpers", () => {
  test("computes promo code display state from expiry, active flag, and redemption count", () => {
    expect(
      computePromoCodeState(
        {
          expiresAt: "2026-06-14T00:00:00.000Z",
          isActive: true,
          maxRedemptions: 10,
          redeemedCount: 3,
        },
        now,
      ),
    ).toBe("Active");
    expect(
      computePromoCodeState(
        {
          expiresAt: "2026-06-12T00:00:00.000Z",
          isActive: true,
          maxRedemptions: 10,
          redeemedCount: 3,
        },
        now,
      ),
    ).toBe("Expired");
    expect(
      computePromoCodeState(
        {
          expiresAt: null,
          isActive: true,
          maxRedemptions: 3,
          redeemedCount: 3,
        },
        now,
      ),
    ).toBe("Fully redeemed");
    expect(
      computePromoCodeState(
        {
          expiresAt: null,
          isActive: false,
          maxRedemptions: 3,
          redeemedCount: 0,
        },
        now,
      ),
    ).toBe("Inactive");
  });

  test("groups repeated privacy request rows by request id", () => {
    const grouped = groupPrivacyRequestsById([
      {
        createdAt: "2026-06-10T00:00:00.000Z",
        dueAt: "2026-06-20T00:00:00.000Z",
        id: "request-1",
        requestType: "export",
        status: "open",
        subject: "Export my data",
        userId: "user-1",
      },
      {
        createdAt: "2026-06-10T00:00:00.000Z",
        dueAt: "2026-06-20T00:00:00.000Z",
        id: "request-1",
        requestType: "export",
        status: "open",
        subject: "Export my data",
        userId: "user-1",
      },
      {
        createdAt: "2026-06-11T00:00:00.000Z",
        dueAt: null,
        id: "request-2",
        requestType: "deletion",
        status: "reviewing",
        subject: null,
        userId: "user-2",
      },
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({ count: 2, id: "request-1" });
    expect(grouped[1]).toMatchObject({ count: 1, id: "request-2" });
  });

  test("matches user quick filters for blocked users", () => {
    const metrics = buildMetricsFixture();
    const [blockedUser, healthyUser] = metrics.usersList;

    expect(userMatchesAdminQuickFilter(blockedUser, "needs_attention", metrics, now)).toBe(true);
    expect(userMatchesAdminQuickFilter(blockedUser, "no_credits", metrics, now)).toBe(true);
    expect(userMatchesAdminQuickFilter(blockedUser, "recent_failure", metrics, now)).toBe(true);
    expect(userMatchesAdminQuickFilter(healthyUser, "needs_attention", metrics, now)).toBe(false);
  });

  test("formats noisy root-cause payloads into owner-readable labels", () => {
    expect(
      formatAdminRootCauseLabel(
        'Input Limit ([ { "Origin": "String", "Code": "Too Big", "Path": [ "AssistantMessage" ] } ])',
      ),
    ).toBe("Input too long: assistant message");
    expect(
      formatAdminRootCauseLabel(
        'Input Limit ([ { "Origin": "String", "Code": "Too Big", "Path": [ "ProfileDraft", "Summary" ] } ])',
      ),
    ).toBe("Input too long: profile summary");
    expect(formatAdminRootCauseLabel("Client Runtime", "ReferenceError")).toBe("Client reference error");
  });

  test("counts only actionable badges and ignores historical inactive promos", () => {
    expect(
      promoNeedsOwnerAction({
        expiresAt: "2026-06-12T00:00:00.000Z",
        isActive: true,
        maxRedemptions: 0,
        redeemedCount: 0,
      }, now),
    ).toBe(true);
    expect(
      promoNeedsOwnerAction({
        expiresAt: null,
        isActive: false,
        maxRedemptions: 0,
        redeemedCount: 0,
      }, now),
    ).toBe(false);
    expect(supportTicketNeedsOwnerAction({ status: "waiting_on_user" } as OwnerMetrics["supportTickets"][number])).toBe(false);
    expect(supportTicketNeedsOwnerAction({ status: "open" } as OwnerMetrics["supportTickets"][number])).toBe(true);
  });

  test("counts grouped actionable compliance rows once", () => {
    expect(
      countActionableComplianceItems({
        incidents: {
          open: 1,
          overdueNotificationReview: 1,
        },
        privacyRequests: {
          open: 2,
          overdue: 1,
          recentOpen: [
            {
              createdAt: "2026-06-10T00:00:00.000Z",
              dueAt: "2026-06-20T00:00:00.000Z",
              id: "request-1",
              requestType: "export",
              status: "open",
              subject: "Export my data",
              userId: "user-1",
            },
            {
              createdAt: "2026-06-10T00:00:00.000Z",
              dueAt: "2026-06-20T00:00:00.000Z",
              id: "request-1",
              requestType: "export",
              status: "open",
              subject: "Export my data",
              userId: "user-1",
            },
          ],
        },
      } as Parameters<typeof countActionableComplianceItems>[0]),
    ).toBe(4);
  });

  test("keeps cleanup-only platform checks out of overall degraded status", () => {
    const status = buildPlatformStatusFixture();

    expect(summarizeOverallStatus(status.checks)).toBe("healthy");
    expect(countAvailabilityPlatformIssues(status)).toBe(0);
    expect(countCleanupPlatformItems(status)).toBe(1);
  });

  test("counts missing release provenance as an availability issue", () => {
    const status = buildPlatformStatusFixture();
    status.checks.push({
      details: "Production release provenance is incomplete. Missing: Git SHA.",
      impact: "availability",
      label: "Release Provenance",
      lastFailureAt: now.toISOString(),
      lastSuccessAt: null,
      state: "degraded",
    });

    expect(summarizeOverallStatus(status.checks)).toBe("degraded");
    expect(countAvailabilityPlatformIssues(status)).toBe(1);
  });

  test("outcome summaries include sample size and caution for tiny samples", () => {
    expect(
      summarizeOutcomePatternWithSample({
        founder: {
          applications: 3,
          interviewRate: 0.33,
          selectionRate: 0,
        },
      }),
    ).toContain("Sample size: 3 records");
    expect(
      summarizeOutcomePatternWithSample({
        founder: {
          applications: 3,
          interviewRate: 0.33,
          selectionRate: 0,
        },
      }),
    ).toContain("directional only");
  });
});

function buildPlatformStatusFixture(): PlatformStatusOverview {
  return {
    checks: [
      {
        details: "Supabase database accepted a read query.",
        impact: "availability",
        label: "Supabase DB",
        lastFailureAt: null,
        lastSuccessAt: now.toISOString(),
        state: "healthy",
      },
      {
        details: "0 ready exports, 1 stale ready records need cleanup.",
        impact: "cleanup",
        label: "PDF/DOCX Generation",
        lastFailureAt: "2026-06-13T10:00:00.000Z",
        lastSuccessAt: null,
        state: "degraded",
      },
    ],
    generatedAt: now.toISOString(),
    overallStatus: "healthy",
    release: {
      branchUrl: "https://ai-resume-app-git-main-resum-ai.vercel.app",
      capturedAt: now.toISOString(),
      deploymentUrl: "https://ai-resume-7e74sw96u-resum-ai.vercel.app",
      gitCommitRef: "main",
      gitCommitSha: "d2ae26bd4efc9a853c5c4970a15d83ce3dc38758",
      provenanceAvailable: true,
      targetEnvironment: "production",
    },
    recentSignals: {
      activeErrors24h: 0,
      applicationExportsReady: 0,
      jobFailures24h: 0,
      sourceFailures24h: 0,
      telemetryEvents24h: 0,
    },
  };
}

function buildMetricsFixture(): OwnerMetrics {
  return {
    applications: { byStatus: {}, converted: 0, logged: 0 },
    errorDetails: [
      {
        area: "resume_export",
        code: "PDF_FAILED",
        createdAt: "2026-06-13T08:00:00.000Z",
        fixRequired: true,
        id: "error-1",
        rationale: "PDF export failed twice.",
        rootCause: "export_failure",
        severity: "high",
        source: "server",
        status: "open",
        summary: "PDF export failed",
        userEmail: "blocked@example.com",
      },
    ],
    featureUsage: {},
    generatedAt: now.toISOString(),
    jobs: { failed: 0, ingested: 0, succeeded: 0 },
    materials: {
      coverLetterPdfs: 0,
      generatedCoverLetters: 0,
      generatedResumes: 0,
      resumePdfs: 0,
    },
    outcomes: {
      averageHoursToFirstResponse: 0,
      byResumeType: {},
      byRoleFamily: {},
      bySourceType: {},
      byTier: {},
      interviewRate: 0,
      rejectionRate: 0,
      selectionRate: 0,
    },
    period: {
      days: 30,
      endedAt: now.toISOString(),
      startedAt: "2026-05-14T12:00:00.000Z",
    },
    profitability: {
      aiVariableCostUsd: 0,
      assumptions: [],
      consumptionEvidence: [],
      costPerActiveUserUsd: 0,
      creditsPurchased: 0,
      creditsUsed: 0,
      grossMarginPercent: 0,
      grossProfitUsd: 0,
      paidCreditsUsed: 0,
      paymentFeesUsd: 0,
      platformFixedCostUsd: 0,
      revenuePerActiveUserUsd: 0,
      revenueUsd: 0,
      totalCostUsd: 0,
      userEconomics: [],
    },
    profiles: { created: 0, draft: 0, needsReview: 0, ready: 0 },
    sources: {},
    support: { l1Resolved: 0, status: "ok", ticketsEscalated: 0, ticketsOpen: 0 },
    supportTickets: [],
    systemHealth: {
      clientErrors: 0,
      fixRequired: 1,
      jobIngestionFailures: 0,
      profileExtractionFailures: 0,
    },
    trends: { daily: [], pageUsage: [] },
    users: {
      active7d: 1,
      active30d: 1,
      activeInPeriod: 1,
      newInPeriod: 1,
      totalSignedUp: 2,
    },
    usersList: [
      {
        applications: 0,
        createdAt: "2026-06-01T12:00:00.000Z",
        creditsAvailable: 0,
        creditsUsed: 0,
        creditsUsedAllTime: 0,
        displayName: "Blocked User",
        email: "blocked@example.com",
        lastActivityAt: "2026-06-13T10:00:00.000Z",
        lastSignInAt: "2026-06-13T10:00:00.000Z",
        openTickets: 0,
        profileStatus: "draft",
        resumes: 0,
        sources: 0,
        tier: "starter",
        userId: "blocked-user",
      },
      {
        applications: 1,
        createdAt: "2026-06-01T12:00:00.000Z",
        creditsAvailable: 12,
        creditsUsed: 1,
        creditsUsedAllTime: 1,
        displayName: "Healthy User",
        email: "healthy@example.com",
        lastActivityAt: "2026-06-13T10:00:00.000Z",
        lastSignInAt: "2026-06-13T10:00:00.000Z",
        openTickets: 0,
        profileStatus: "ready",
        resumes: 1,
        sources: 2,
        tier: "starter",
        userId: "healthy-user",
      },
    ],
  };
}
