import { z } from "zod";

export const supportIssueStatusSchema = z.enum([
  "open",
  "waiting_on_user",
  "in_progress",
  "resolved",
  "closed",
  "escalated",
]);

export const supportIssuePrioritySchema = z.enum(["low", "normal", "high", "urgent"]);

export const supportIssueFixStatusSchema = z.enum([
  "not_started",
  "investigating",
  "needs_code_fix",
  "fixed",
  "wont_fix",
  "user_action_required",
]);

export const supportIssueCreateSchema = z.object({
  area: z.string().trim().min(1).max(80).default("general"),
  errorCode: z.string().trim().min(1).max(120).optional(),
  errorMessage: z.string().trim().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  source: z.string().trim().min(1).max(80).default("user_report"),
  systemResponse: z.string().trim().max(2000).optional(),
  title: z.string().trim().min(1).max(180).optional(),
  userMessage: z.string().trim().max(2000).optional(),
});

export const supportIssueUpdateSchema = z.object({
  closedReason: z.string().trim().max(800).optional(),
  escalatedToL2: z.boolean().optional(),
  escalationReason: z.string().trim().max(800).optional(),
  fixStatus: supportIssueFixStatusSchema.optional(),
  l1Disposition: z.string().trim().max(80).optional(),
  ownerNotes: z.string().trim().max(2000).optional(),
  priority: supportIssuePrioritySchema.optional(),
  rootCause: z.string().trim().max(1200).optional(),
  rootCauseCategory: z.string().trim().max(80).optional(),
  status: supportIssueStatusSchema.optional(),
  suggestedFix: z.string().trim().max(1200).optional(),
  userVisibleResolution: z.string().trim().max(2000).optional(),
});

export type SupportIssueCreateInput = z.infer<typeof supportIssueCreateSchema>;

type IssueAnalysis = {
  fixStatus: z.infer<typeof supportIssueFixStatusSchema>;
  priority: z.infer<typeof supportIssuePrioritySchema>;
  rootCause: string;
  rootCauseCategory: string;
  summary: string;
  suggestedFix: string;
  title: string;
};

export function buildSupportIssueAnalysis(input: SupportIssueCreateInput): IssueAnalysis {
  const area = input.area.toLowerCase();
  const combined = [
    input.title,
    input.userMessage,
    input.systemResponse,
    input.errorCode,
    input.errorMessage,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (area.includes("master_resume") || /\b(master|ats)\s+resume\b/.test(combined)) {
    return {
      fixStatus: "needs_code_fix",
      priority: "high",
      rootCause:
        "A master resume action failed or produced an output that did not match the expected role-by-role resume structure. The owner should review the resume generation, source reading, and saved resume content for this user.",
      rootCauseCategory: "resume_generation",
      summary:
        "The user tried to fix or update the master resume, but Pramania could not complete the action and gave a dead-end response.",
      suggestedFix:
        "Review the latest generated_resumes row, source reading records, and conversation around the failure. Re-run master resume generation after confirming the role chronology parser is excluding recommendations and preserving company/title/date/location fields.",
      title: input.title ?? "Master resume action failed",
    };
  }

  if (area.includes("profile") || /\b(profile|source|pdf|linkedin|upload|file)\b/.test(combined)) {
    return {
      fixStatus: "investigating",
      priority: "high",
      rootCause:
        "A profile intake or source reading path did not give the user a useful outcome. The owner should inspect the source status, failure reason, and advisor response.",
      rootCauseCategory: "profile_intake",
      summary:
        "The user reported that profile evidence was not processed or used properly.",
      suggestedFix:
        "Check profile_sources, profile_facts, and the latest advisor/error logs for this user. If extraction succeeded but profile/resume did not improve, fix the normalization or resume reconstruction path rather than asking the user to repeat the same input.",
      title: input.title ?? "Profile intake issue",
    };
  }

  if (area.includes("job") || area.includes("application")) {
    return {
      fixStatus: "investigating",
      priority: "normal",
      rootCause:
        "A job or application workflow needs review. The owner should inspect the related ingestion/application row and generated material status.",
      rootCauseCategory: "job_application_flow",
      summary:
        "The user encountered friction in a job, application, or generated-material workflow.",
      suggestedFix:
        "Review the job_ingestions, applications, generated_resumes, and generated_cover_letters records tied to the user and retry the failed step after fixing the underlying route or validation issue.",
      title: input.title ?? "Job or application workflow issue",
    };
  }

  if (
    area.includes("privacy") ||
    area.includes("security") ||
    area.includes("billing") ||
    area.includes("refund") ||
    area.includes("account_recovery") ||
    /\b(delete account|export my data|privacy|security|refund|billing|receipt|invoice|cannot access|wrong email)\b/.test(
      combined,
    )
  ) {
    const isUrgent = area.includes("security") || /\bsecurity|account access|cannot access|breach\b/.test(combined);

    return {
      fixStatus: "investigating",
      priority: isUrgent ? "urgent" : "high",
      rootCause:
        "A trust-critical support request needs human review. The owner should route this through privacy, security, billing/refund, or account recovery handling and avoid exposing unnecessary personal data.",
      rootCauseCategory: area.includes("billing") || area.includes("refund") ? "billing_support" : "trust_request",
      summary:
        "The user created a trust-critical support request that should not be handled as generic product guidance.",
      suggestedFix:
        "Review the user-visible request, support-safe context consent, account metadata, billing ledger if relevant, and privacy/audit retention obligations before taking action. Record the outcome in owner notes.",
      title: input.title ?? "Trust or account support request",
    };
  }

  return {
    fixStatus: "investigating",
    priority: "normal",
    rootCause:
      "The issue needs owner triage. Review supporting logs and the recent conversation to decide whether this is user guidance, a product bug, or a provider limitation.",
    rootCauseCategory: "needs_triage",
    summary:
      "The user reported an issue that needs owner review with supporting logs.",
    suggestedFix:
      "Review recent error events, app events, and conversation context. Mark resolved if the product behaved correctly, cancelled if not actionable, or needs_code_fix if a systemic fix is required.",
    title: input.title ?? "User-reported issue",
  };
}

export function supportIssueShortId(id: string) {
  return `PR-${id.slice(0, 8).toUpperCase()}`;
}
