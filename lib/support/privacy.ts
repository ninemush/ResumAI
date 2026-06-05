import type { z } from "zod";

import { redactOperationalMetadata, redactOperationalText } from "@/lib/security/redaction";

import type { SupportIssueCreateInput } from "@/lib/support/issues";
import type { supportIssuePrioritySchema } from "@/lib/support/issues";

const SSN_PATTERN = /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g;
const DOB_PATTERN =
  /\b(?:dob|date of birth)\s*[:#-]?\s*(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|[A-Z][a-z]+ \d{1,2},? \d{4})\b/gi;
const MEDICAL_RECORD_PATTERN =
  /\b(?:mrn|medical record(?: number)?|patient id)\s*[:#-]?\s*[A-Za-z0-9-]{4,}\b/gi;
const PAYMENT_CARD_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;

const SUPPORT_SAFE_METADATA_KEYS = new Set([
  "action",
  "attachmentConsent",
  "browser",
  "category",
  "clientVersion",
  "errorCode",
  "errorName",
  "feature",
  "includeSupportContext",
  "issueId",
  "path",
  "platform",
  "recentErrorCodes",
  "recentEventTypes",
  "route",
  "screen",
  "severity",
  "sourceSurface",
]);

const MINIMAL_METADATA_KEYS = new Set([
  "attachmentConsent",
  "category",
  "severity",
  "sourceSurface",
]);

type SupportPriority = z.infer<typeof supportIssuePrioritySchema>;

type SupportAnalysis = {
  priority: SupportPriority;
  rootCauseCategory: string;
  summary: string;
  suggestedFix: string;
};

export function sanitizeSupportIssueInput(input: SupportIssueCreateInput): SupportIssueCreateInput {
  const supportContextConsent = hasSupportContextConsent(input);

  return {
    ...input,
    area: redactSupportText(input.area, 80),
    errorCode: input.errorCode ? redactSupportText(input.errorCode, 120) : undefined,
    errorMessage:
      supportContextConsent && input.errorMessage
        ? redactSupportText(input.errorMessage, 500)
        : undefined,
    metadata: buildSupportSafeMetadata(input.metadata, supportContextConsent),
    source: redactSupportText(input.source, 80),
    supportContextConsent,
    systemResponse:
      supportContextConsent && input.systemResponse
        ? redactSupportText(input.systemResponse, 2000)
        : undefined,
    title: input.title ? redactSupportText(input.title, 180) : undefined,
    userMessage: input.userMessage ? redactSupportText(input.userMessage, 2000) : undefined,
  };
}

export function redactSupportText(value: string, maxLength = 2000) {
  const redacted = redactOperationalText(
    value
      .replace(SSN_PATTERN, "[redacted_ssn]")
      .replace(DOB_PATTERN, "[redacted_dob]")
      .replace(MEDICAL_RECORD_PATTERN, "[redacted_medical_record]")
      .replace(PAYMENT_CARD_PATTERN, "[redacted_payment_card]"),
    maxLength,
  );

  return redacted.length > maxLength ? `${redacted.slice(0, maxLength - 1)}...` : redacted;
}

export function buildSupportSafeMetadata(
  metadata: Record<string, unknown>,
  supportContextConsent: boolean,
) {
  const safeMetadata: Record<string, unknown> = {
    supportContextIncluded: supportContextConsent,
  };
  const redactedMetadataKeys: string[] = [];
  const allowedKeys = supportContextConsent ? SUPPORT_SAFE_METADATA_KEYS : MINIMAL_METADATA_KEYS;

  for (const [key, value] of Object.entries(metadata)) {
    if (!allowedKeys.has(key) || isRawSupportContextKey(key)) {
      redactedMetadataKeys.push(key);
      continue;
    }

    safeMetadata[key] = redactOperationalMetadata({ value }).value;
  }

  if (redactedMetadataKeys.length > 0) {
    safeMetadata.redactedMetadataKeys = redactedMetadataKeys.slice(0, 25);
  }

  return safeMetadata;
}

export function buildL1SupportPacket({
  analysis,
  input,
  requestId,
}: {
  analysis: SupportAnalysis;
  input: SupportIssueCreateInput;
  requestId: string;
}) {
  const escalationReason = getEscalationReason(input, analysis);
  const escalationRequired = escalationReason !== null;

  return {
    actionsTaken: [
      "L0 guidance was presented before ticket intake.",
      "Submitted details were redacted before storage.",
      escalationRequired
        ? "L1 prepared this issue for human escalation."
        : "L1 prepared a support-safe troubleshooting packet.",
    ],
    blockers: input.supportContextConsent
      ? []
      : ["Workspace context was not included. Ask for explicit consent before inspecting more context."],
    customerTemperament: inferCustomerTemperament(input.userMessage ?? input.errorMessage ?? ""),
    escalationReason,
    escalationRequired,
    l0Suggestions: getL0Suggestions(input.area),
    logsInspected: input.supportContextConsent
      ? ["User-approved support-safe metadata and submitted error context."]
      : ["No workspace logs or raw context. User did not opt in."],
    recommendedNextAction: escalationRequired
      ? "Route to L2 with privacy, security, billing/refund, or account-access handling as appropriate."
      : analysis.suggestedFix,
    requestId,
    rootCauseCategory: analysis.rootCauseCategory,
    sensitiveConstraints: [
      "Do not expose owner notes to the user.",
      "Use support-safe metadata before requesting raw files, resumes, or conversation transcripts.",
      "Do not ask for government identifiers, payment card numbers, passwords, or employer credentials.",
    ],
    supportContextIncluded: input.supportContextConsent,
    timeline: [
      "User opened support.",
      "L0 help was available before ticket creation.",
      "Ticket intake captured the user's redacted description.",
      escalationRequired ? "L1 escalation packet prepared." : "L1 triage packet prepared.",
    ],
    userVisibleSummary: analysis.summary,
    version: "support_l1_packet_v1",
  };
}

export function getEscalationReason(input: SupportIssueCreateInput, analysis: SupportAnalysis) {
  const combined = [
    input.area,
    input.title,
    input.userMessage,
    input.errorCode,
    input.errorMessage,
    analysis.rootCauseCategory,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (analysis.priority === "urgent") {
    return "Urgent support issue requires human review.";
  }

  if (/\b(privacy|security|refund|billing|account_recovery|account access|delete account|export my data|breach)\b/.test(combined)) {
    return "Trust, account, billing/refund, privacy, or security issue requires L2 review.";
  }

  return null;
}

function hasSupportContextConsent(input: SupportIssueCreateInput) {
  return input.supportContextConsent === true || input.metadata.includeSupportContext === true;
}

function isRawSupportContextKey(key: string) {
  return /\b(raw|resume|profile|conversation|transcript|prompt|response|jobdescription|jobpost|sourceText|ocr|fileContent|fullContext|notes|owner_notes)\b/i.test(
    key,
  );
}

function inferCustomerTemperament(text: string) {
  const normalized = text.toLowerCase();

  if (/\b(angry|furious|unacceptable|horrible|terrible|useless)\b/.test(normalized)) {
    return "angry";
  }

  if (/\b(frustrated|annoying|not working|wrong|failed|broken|bad)\b/.test(normalized)) {
    return "frustrated";
  }

  return "neutral";
}

function getL0Suggestions(area: string) {
  if (area.includes("billing") || area.includes("refund")) {
    return ["Check credit history and receipt details.", "Share only the invoice or charge reference."];
  }

  if (area.includes("privacy") || area.includes("security")) {
    return ["Use the privacy or security request path.", "Do not paste secrets, passwords, or identifiers."];
  }

  if (area.includes("account")) {
    return ["Try password reset and email verification first.", "Avoid sharing backup codes or session details."];
  }

  return ["Retry once after refreshing.", "Include the affected screen, expected result, and the last safe error code."];
}
