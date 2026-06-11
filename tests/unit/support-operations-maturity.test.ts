import { describe, expect, test } from "vitest";

import { buildSupportIssueAnalysis, toUserSupportIssue } from "@/lib/support/issues";

describe("support operations maturity", () => {
  test("routes billing, privacy, account access, and inaccurate AI output into owner triage categories", () => {
    const billing = buildSupportIssueAnalysis({
      area: "billing_refund",
      metadata: {},
      source: "support_form",
      supportContextConsent: false,
      title: "Refund request",
      userMessage: "I was charged credits twice and need a refund.",
    });
    const privacy = buildSupportIssueAnalysis({
      area: "privacy",
      metadata: {},
      source: "support_form",
      supportContextConsent: false,
      title: "Delete my account",
      userMessage: "Please delete my account and export my data.",
    });
    const account = buildSupportIssueAnalysis({
      area: "account_recovery",
      metadata: {},
      source: "support_form",
      supportContextConsent: false,
      title: "Cannot access account",
      userMessage: "I cannot access my account after changing email.",
    });
    const aiOutput = buildSupportIssueAnalysis({
      area: "master_resume",
      metadata: {},
      source: "support_form",
      supportContextConsent: false,
      title: "Master resume wrong claim",
      userMessage: "The resume added an unsupported company and inaccurate AI output.",
    });

    expect(billing.rootCauseCategory).toBe("billing_support");
    expect(privacy.rootCauseCategory).toBe("trust_request");
    expect(account.priority).toBe("urgent");
    expect(aiOutput.fixStatus).toBe("needs_code_fix");
    expect([billing, privacy, account]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fixStatus: "investigating" }),
      ]),
    );
  });

  test("keeps owner-only notes out of user-visible support history", () => {
    const userIssue = toUserSupportIssue({
      area: "billing_refund",
      created_at: "2026-06-11T00:00:00.000Z",
      fix_status: "investigating",
      id: "00000000-0000-4000-8000-000000000000",
      owner_notes: "Owner-only ledger and provider reconciliation notes.",
      priority: "high",
      root_cause: "Provider duplicate webhook review.",
      root_cause_category: "billing_support",
      status: "escalated",
      subject: "Refund request",
      suggested_fix: "Check RevenueCat and Stripe.",
      summary: "User requested billing help.",
      updated_at: "2026-06-11T00:00:00.000Z",
      user_visible_resolution: "Human support is reviewing this with billing context.",
    });

    expect(JSON.stringify(userIssue)).not.toContain("Owner-only");
    expect(JSON.stringify(userIssue)).not.toContain("RevenueCat");
    expect(JSON.stringify(userIssue)).not.toContain("Stripe");
    expect(userIssue.statusDetail).toBe("Human support is reviewing the escalation packet.");
  });
});
