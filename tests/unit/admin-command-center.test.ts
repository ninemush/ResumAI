import { describe, expect, test } from "vitest";

import {
  computePromoCodeState,
  groupPrivacyRequestsById,
  summarizeOutcomePatternWithSample,
  userMatchesAdminQuickFilter,
} from "@/lib/admin/command-center";
import type { OwnerMetrics } from "@/lib/admin/owner-metrics";

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
