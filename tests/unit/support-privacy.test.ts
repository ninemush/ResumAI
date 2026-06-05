import { describe, expect, test } from "vitest";

import { buildSupportIssueAnalysis, toUserSupportIssue } from "@/lib/support/issues";
import { buildL1SupportPacket, sanitizeSupportIssueInput } from "@/lib/support/privacy";

describe("support privacy", () => {
  test("redacts sensitive support details and drops raw context without opt-in", () => {
    const sanitized = sanitizeSupportIssueInput({
      area: "product",
      errorMessage: "The workspace failed with token sk_secretvalue1234567890",
      metadata: {
        category: "product",
        conversationTranscript: "Full raw transcript with email user@example.com",
        includeSupportContext: false,
        rawResumeText: "Private resume content",
        severity: "normal",
        sourceSurface: "support_form",
      },
      source: "support_form",
      supportContextConsent: false,
      systemResponse: "Internal raw response",
      title: "Problem for user@example.com",
      userMessage: "DOB 01/02/1990, MRN: AB12345, SSN 123-45-6789, card 4111 1111 1111 1111",
    });

    expect(sanitized.errorMessage).toBeUndefined();
    expect(sanitized.systemResponse).toBeUndefined();
    expect(sanitized.title).toContain("[redacted_email]");
    expect(sanitized.userMessage).toContain("[redacted_dob]");
    expect(sanitized.userMessage).toContain("[redacted_medical_record]");
    expect(sanitized.userMessage).toContain("[redacted_ssn]");
    expect(sanitized.userMessage).toContain("[redacted_payment_card]");
    expect(sanitized.metadata).toMatchObject({
      category: "product",
      severity: "normal",
      sourceSurface: "support_form",
      supportContextIncluded: false,
    });
    expect(JSON.stringify(sanitized.metadata)).not.toContain("Private resume content");
    expect(JSON.stringify(sanitized.metadata)).not.toContain("Full raw transcript");
  });

  test("public support issue mapping excludes owner-only triage fields", () => {
    const publicIssue = toUserSupportIssue({
      area: "security",
      created_at: "2026-06-05T00:00:00.000Z",
      fix_status: "investigating",
      id: "00000000-0000-4000-8000-000000000001",
      owner_notes: "Do not show this internal note",
      priority: "urgent",
      root_cause: "Internal cause",
      root_cause_category: "trust_request",
      status: "escalated",
      subject: "Security concern",
      suggested_fix: "Internal fix",
      summary: "Support is reviewing this.",
      updated_at: "2026-06-05T00:00:00.000Z",
    });

    expect(publicIssue).toEqual({
      area: "security",
      auto_closed_at: null,
      closed_reason: null,
      created_at: "2026-06-05T00:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000001",
      priority: "urgent",
      reopen_until: null,
      shortId: "PR-00000000",
      status: "escalated",
      statusDetail: "Human support is reviewing the escalation packet.",
      subject: "Security concern",
      summary: "Support is reviewing this.",
      updated_at: "2026-06-05T00:00:00.000Z",
      user_visible_resolution: null,
    });
    expect(JSON.stringify(publicIssue)).not.toContain("owner");
    expect(JSON.stringify(publicIssue)).not.toContain("Internal");
  });

  test("L1 packet escalates trust issues with support-safe constraints", () => {
    const input = sanitizeSupportIssueInput({
      area: "privacy",
      metadata: { category: "privacy", severity: "high", sourceSurface: "support_form" },
      source: "support_form",
      supportContextConsent: false,
      title: "Delete my account",
      userMessage: "Please delete my data.",
    });
    const analysis = buildSupportIssueAnalysis(input);
    const packet = buildL1SupportPacket({
      analysis,
      input,
      requestId: "req_test",
    });

    expect(packet.escalationRequired).toBe(true);
    expect(packet.escalationReason).toContain("requires L2 review");
    expect(packet.logsInspected).toEqual(["No workspace logs or raw context. User did not opt in."]);
    expect(packet.sensitiveConstraints).toContain("Do not expose owner notes to the user.");
  });
});
