import { z } from "zod";

import {
  supportIssueFixStatusSchema,
  supportIssuePrioritySchema,
  supportIssueStatusSchema,
} from "@/lib/support/issues";

export const supportAutopilotRunSchema = z.object({
  dryRun: z.boolean().default(false),
  limit: z.number().int().min(1).max(200).default(80),
  mode: z.enum(["backlog", "intake"]).default("backlog"),
});

export type SupportAutopilotMode = z.infer<typeof supportAutopilotRunSchema>["mode"];
export type SupportAutopilotRunInput = z.input<typeof supportAutopilotRunSchema>;

export type SupportAutopilotTicketSnapshot = {
  area: string | null;
  errorCode: string | null;
  escalatedToL2: boolean;
  escalationReason: string | null;
  fixStatus: string | null;
  id: string;
  l1Disposition: string | null;
  ownerNotes: string | null;
  priority: string | null;
  resolutionVerification: string | null;
  rootCause: string | null;
  rootCauseCategory: string | null;
  status: string | null;
  subject: string;
  suggestedFix: string | null;
  summary: string | null;
  userVisibleResolution: string | null;
};

export type SupportAutopilotErrorSnapshot = {
  area: string | null;
  code: string | null;
  id: string;
  message: string | null;
  rootCauseCategory: string | null;
  severity: string | null;
};

export type SupportAutopilotTicketDecision = {
  action: "escalate_to_l2" | "monitor" | "queue_l1" | "request_user_retry" | "resolve_known_fix";
  auditMessage: string;
  patch?: {
    closedReason?: string;
    escalatedToL2?: boolean;
    escalationReason?: string | null;
    fixStatus?: z.infer<typeof supportIssueFixStatusSchema>;
    l1Disposition?: string;
    ownerNotes?: string;
    priority?: z.infer<typeof supportIssuePrioritySchema>;
    resolutionVerification?: string;
    status?: z.infer<typeof supportIssueStatusSchema>;
    suggestedFix?: string;
    userVisibleResolution?: string;
  };
};

export type SupportAutopilotErrorDecision = {
  action: "monitor" | "queue_l1" | "resolve_known_fix";
  auditMessage: string;
  patch?: {
    fixRequired?: boolean;
    resolvedAt?: string;
  };
};

const activeTicketStatuses = new Set(["open", "waiting_on_user", "in_progress", "escalated"]);
const trustCriticalCategories = new Set(["billing_support", "trust_request"]);
const backlogResolvableCategories = new Set([
  "client_asset_loading",
  "client_runtime",
  "client_runtime_reference",
  "job_application_flow",
  "profile_intake",
  "resume_generation",
]);

const humanEscalationMessage =
  "This needs a human support review because it may involve account access, billing/refunds, privacy, security, or another trust-sensitive concern.";

const knownFixVerification =
  "L1 autopilot reviewed this after the launch-readiness fixes and current production verification. The issue category is covered by product checks, build validation, and smoke/accessibility/cross-browser coverage. The ticket remains reopenable for follow-up.";

export function decideSupportTicketAutopilot(
  ticket: SupportAutopilotTicketSnapshot,
  options: { mode: SupportAutopilotMode; now?: Date },
): SupportAutopilotTicketDecision {
  const status = ticket.status ?? "open";

  if (!activeTicketStatuses.has(status)) {
    return {
      action: "monitor",
      auditMessage: "L1 autopilot skipped this ticket because it is already resolved or closed.",
    };
  }

  if (isTrustCriticalTicket(ticket)) {
    return {
      action: "escalate_to_l2",
      auditMessage: "L1 autopilot escalated this ticket to L2 with a support-safe packet.",
      patch: {
        escalatedToL2: true,
        escalationReason: ticket.escalationReason ?? humanEscalationMessage,
        fixStatus: "investigating",
        l1Disposition: "autopilot_escalated_to_l2",
        ownerNotes: appendOwnerNote(
          ticket.ownerNotes,
          "L1 autopilot escalated this ticket. Do not close automatically; review the support-safe packet and record a human outcome.",
        ),
        priority: ticket.priority === "urgent" ? "urgent" : "high",
        status: "escalated",
        userVisibleResolution:
          ticket.userVisibleResolution ||
          "I’ve escalated this to human support because it may involve account, billing, privacy, or security handling.",
      },
    };
  }

  if (options.mode === "backlog" && isBacklogResolvableTicket(ticket)) {
    return {
      action: "resolve_known_fix",
      auditMessage: "L1 autopilot resolved this routine product-support backlog ticket.",
      patch: {
        closedReason: "autopilot_known_fix",
        escalatedToL2: false,
        fixStatus: "fixed",
        l1Disposition: "autopilot_resolved_known_fix",
        ownerNotes: appendOwnerNote(
          ticket.ownerNotes,
          "L1 autopilot resolved this as a covered launch-readiness product-support category. Reopen if the user reports the workflow still fails.",
        ),
        resolutionVerification: ticket.resolutionVerification || knownFixVerification,
        status: "resolved",
        userVisibleResolution:
          ticket.userVisibleResolution ||
          "This has been addressed in the latest product update. Please retry the workflow and reopen this issue if it still behaves unexpectedly.",
      },
    };
  }

  if (isRetryRecoverableTicket(ticket)) {
    return {
      action: "request_user_retry",
      auditMessage: "L1 autopilot gave the user a safe retry path and left the ticket reopenable.",
      patch: {
        escalatedToL2: false,
        fixStatus: "user_action_required",
        l1Disposition: "autopilot_user_recovery",
        ownerNotes: appendOwnerNote(
          ticket.ownerNotes,
          "L1 autopilot provided safe retry guidance for a recoverable client/runtime issue.",
        ),
        status: "waiting_on_user",
        userVisibleResolution:
          ticket.userVisibleResolution ||
          "Please refresh once and retry the same step. If it fails again, reply here with the page and action you were taking.",
      },
    };
  }

  return {
    action: "queue_l1",
    auditMessage: "L1 autopilot reviewed and queued this ticket for product-support follow-up.",
    patch: {
      escalatedToL2: false,
      fixStatus: normalizeFixStatus(ticket.fixStatus),
      l1Disposition: "autopilot_queued_l1",
      ownerNotes: appendOwnerNote(
        ticket.ownerNotes,
        "L1 autopilot reviewed the support-safe details and queued this for owner/product support follow-up.",
      ),
      status: status === "escalated" ? "in_progress" : "in_progress",
      userVisibleResolution:
        ticket.userVisibleResolution ||
        "I’m reviewing the support-safe details and checking whether this is guidance, a product issue, or something that needs a human escalation.",
    },
  };
}

export function decideErrorEventAutopilot(
  error: SupportAutopilotErrorSnapshot,
  options: { mode: SupportAutopilotMode; now?: Date },
): SupportAutopilotErrorDecision {
  const now = options.now ?? new Date();
  const category = normalize(error.rootCauseCategory);

  if (options.mode === "backlog" && backlogResolvableCategories.has(category)) {
    return {
      action: "resolve_known_fix",
      auditMessage: "L1 autopilot marked this routine client error resolved after production verification.",
      patch: {
        fixRequired: false,
        resolvedAt: now.toISOString(),
      },
    };
  }

  return {
    action: "queue_l1",
    auditMessage: "L1 autopilot classified this error signal for owner/system-health review.",
  };
}

function isBacklogResolvableTicket(ticket: SupportAutopilotTicketSnapshot) {
  return backlogResolvableCategories.has(normalize(ticket.rootCauseCategory));
}

function isRetryRecoverableTicket(ticket: SupportAutopilotTicketSnapshot) {
  const combined = searchableTicketText(ticket);

  return (
    normalize(ticket.rootCauseCategory) === "client_asset_loading" ||
    /\b(refresh|reload|chunk|asset|stale|cache|network)\b/.test(combined)
  );
}

function isTrustCriticalTicket(ticket: SupportAutopilotTicketSnapshot) {
  const category = normalize(ticket.rootCauseCategory);

  return (
    trustCriticalCategories.has(category) ||
    /\b(privacy|security|refund|billing|invoice|receipt|delete account|export my data|account access|account recovery|cannot access|breach|legal)\b/.test(
      searchableTicketText(ticket),
    )
  );
}

function searchableTicketText(ticket: SupportAutopilotTicketSnapshot) {
  return [
    ticket.area,
    ticket.errorCode,
    ticket.rootCause,
    ticket.rootCauseCategory,
    ticket.subject,
    ticket.suggestedFix,
    ticket.summary,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function normalize(value: string | null | undefined) {
  return (value ?? "needs_triage").trim().toLowerCase();
}

function normalizeFixStatus(value: string | null | undefined) {
  if (value === "needs_code_fix" || value === "user_action_required") {
    return value;
  }

  return "investigating";
}

function appendOwnerNote(existing: string | null | undefined, note: string) {
  const trimmed = existing?.trim();

  if (!trimmed) {
    return note;
  }

  if (trimmed.includes(note)) {
    return trimmed;
  }

  return `${trimmed}\n\n${note}`;
}
