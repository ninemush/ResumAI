import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  decideErrorEventAutopilot,
  decideSupportTicketAutopilot,
  supportAutopilotRunSchema,
  type SupportAutopilotErrorSnapshot,
  type SupportAutopilotMode,
  type SupportAutopilotRunInput,
  type SupportAutopilotTicketDecision,
  type SupportAutopilotTicketSnapshot,
} from "@/lib/support/autopilot-policy";
import { markLinkedErrorEventsResolved } from "@/lib/support/error-events";

const REOPEN_WINDOW_DAYS = 10;

type SupportTicketRow = {
  area: string | null;
  error_code: string | null;
  escalated_to_l2: boolean | null;
  escalation_reason: string | null;
  fix_status: string | null;
  id: string;
  l1_disposition: string | null;
  linked_error_event_id: string | null;
  metadata: Record<string, unknown> | null;
  owner_notes: string | null;
  priority: string | null;
  resolution_verification: string | null;
  root_cause: string | null;
  root_cause_category: string | null;
  status: string | null;
  subject: string;
  suggested_fix: string | null;
  summary: string | null;
  user_id: string | null;
  user_visible_resolution: string | null;
};

type ErrorEventRow = {
  area: string | null;
  error_code: string | null;
  id: string;
  message: string | null;
  metadata: Record<string, unknown> | null;
  root_cause_category: string | null;
  severity: string | null;
  user_id: string | null;
};

export type SupportAutopilotRunResult = {
  dryRun: boolean;
  errorsQueued: number;
  errorsResolved: number;
  mode: SupportAutopilotMode;
  reviewed: number;
  skipped: number;
  ticketsEscalated: number;
  ticketsQueued: number;
  ticketsResolved: number;
  ticketsWaitingOnUser: number;
};

export async function reviewSupportTicketWithAutopilot({
  dryRun = false,
  mode,
  requestId,
  supabase,
  ticketId,
}: {
  dryRun?: boolean;
  mode: SupportAutopilotMode;
  requestId: string;
  supabase: SupabaseClient;
  ticketId: string;
}) {
  const { data: ticket, error } = await supabase
    .from("support_tickets")
    .select(ticketSelect)
    .eq("id", ticketId)
    .single();

  if (error || !ticket) {
    throw new Error("SUPPORT_AUTOPILOT_TICKET_READ_FAILED");
  }

  const row = ticket as unknown as SupportTicketRow;
  const decision = decideSupportTicketAutopilot(toTicketSnapshot(row), { mode });

  if (!dryRun && decision.patch) {
    await applyTicketDecision({
      decision,
      requestId,
      supabase,
      ticket: row,
    });
  }

  return {
    action: decision.action,
    status: decision.patch?.status ?? row.status,
    ticketId,
  };
}

export async function runSupportAutopilot(
  supabase: SupabaseClient,
  input: SupportAutopilotRunInput = {},
): Promise<SupportAutopilotRunResult> {
  const options = supportAutopilotRunSchema.parse(input);
  const requestId = crypto.randomUUID();
  const result: SupportAutopilotRunResult = {
    dryRun: options.dryRun,
    errorsQueued: 0,
    errorsResolved: 0,
    mode: options.mode,
    reviewed: 0,
    skipped: 0,
    ticketsEscalated: 0,
    ticketsQueued: 0,
    ticketsResolved: 0,
    ticketsWaitingOnUser: 0,
  };

  const { data: tickets, error: ticketsError } = await supabase
    .from("support_tickets")
    .select(ticketSelect)
    .in("status", ["open", "waiting_on_user", "in_progress", "escalated"])
    .order("created_at", { ascending: true })
    .limit(options.limit);

  if (ticketsError) {
    throw new Error("SUPPORT_AUTOPILOT_TICKETS_READ_FAILED");
  }

  for (const ticket of (tickets ?? []) as unknown as SupportTicketRow[]) {
    const decision = decideSupportTicketAutopilot(toTicketSnapshot(ticket), {
      mode: options.mode,
    });

    result.reviewed += 1;

    if (!decision.patch) {
      result.skipped += 1;
      continue;
    }

    if (!options.dryRun) {
      await applyTicketDecision({
        decision,
        requestId,
        supabase,
        ticket,
      });
    }

    if (decision.action === "escalate_to_l2") result.ticketsEscalated += 1;
    if (decision.action === "queue_l1") result.ticketsQueued += 1;
    if (decision.action === "request_user_retry") result.ticketsWaitingOnUser += 1;
    if (decision.action === "resolve_known_fix") result.ticketsResolved += 1;
  }

  const remainingErrorLimit = Math.max(options.limit - result.reviewed, 0);

  if (remainingErrorLimit > 0) {
    const { data: errors, error: errorsError } = await supabase
      .from("error_events")
      .select("id, user_id, area, error_code, message, severity, root_cause_category, metadata")
      .is("resolved_at", null)
      .order("created_at", { ascending: true })
      .limit(remainingErrorLimit);

    if (errorsError) {
      throw new Error("SUPPORT_AUTOPILOT_ERRORS_READ_FAILED");
    }

    for (const errorEvent of (errors ?? []) as unknown as ErrorEventRow[]) {
      const decision = decideErrorEventAutopilot(toErrorSnapshot(errorEvent), {
        mode: options.mode,
      });

      result.reviewed += 1;

      if (!decision.patch) {
        result.errorsQueued += 1;
        continue;
      }

      if (!options.dryRun) {
        await applyErrorDecision({
          auditMessage: decision.auditMessage,
          errorEvent,
          patch: decision.patch,
          requestId,
          supabase,
        });
      }

      if (decision.action === "resolve_known_fix") result.errorsResolved += 1;
    }
  }

  return result;
}

async function applyTicketDecision({
  decision,
  requestId,
  supabase,
  ticket,
}: {
  decision: SupportAutopilotTicketDecision;
  requestId: string;
  supabase: SupabaseClient;
  ticket: SupportTicketRow;
}) {
  const patch = toTicketPatch(decision, ticket);

  const { error } = await supabase.from("support_tickets").update(patch).eq("id", ticket.id);

  if (error) {
    throw new Error("SUPPORT_AUTOPILOT_TICKET_UPDATE_FAILED");
  }

  await supabase.from("support_ticket_messages").insert({
    message: decision.auditMessage,
    metadata: {
      action: decision.action,
      requestId,
      source: "support_autopilot",
    },
    speaker: "system",
    ticket_id: ticket.id,
    user_id: ticket.user_id,
  });

  if (decision.patch?.status === "resolved" && decision.patch.fixStatus === "fixed") {
    await markLinkedErrorEventsResolved(supabase, ticket);
  }
}

function toTicketPatch(decision: SupportAutopilotTicketDecision, ticket: SupportTicketRow) {
  const decisionPatch = decision.patch ?? {};
  const now = new Date();
  const patch: Record<string, unknown> = {
    metadata: {
      ...(ticket.metadata ?? {}),
      supportAutopilot: {
        action: decision.action,
        reviewedAt: now.toISOString(),
        version: "support_autopilot_v1",
      },
    },
  };

  if (decisionPatch.closedReason !== undefined) patch.closed_reason = decisionPatch.closedReason;
  if (decisionPatch.escalatedToL2 !== undefined) patch.escalated_to_l2 = decisionPatch.escalatedToL2;
  if (decisionPatch.escalationReason !== undefined) {
    patch.escalation_reason = decisionPatch.escalationReason;
  }
  if (decisionPatch.fixStatus !== undefined) patch.fix_status = decisionPatch.fixStatus;
  if (decisionPatch.l1Disposition !== undefined) patch.l1_disposition = decisionPatch.l1Disposition;
  if (decisionPatch.ownerNotes !== undefined) patch.owner_notes = decisionPatch.ownerNotes;
  if (decisionPatch.priority !== undefined) patch.priority = decisionPatch.priority;
  if (decisionPatch.resolutionVerification !== undefined) {
    patch.resolution_verification = decisionPatch.resolutionVerification;
    patch.verified_at = now.toISOString();
  }
  if (decisionPatch.suggestedFix !== undefined) patch.suggested_fix = decisionPatch.suggestedFix;
  if (decisionPatch.userVisibleResolution !== undefined) {
    patch.user_visible_resolution = decisionPatch.userVisibleResolution;
  }
  if (decisionPatch.status !== undefined) {
    patch.status = decisionPatch.status;

    if (decisionPatch.status === "resolved") {
      patch.resolved_at = now.toISOString();
      patch.reopen_until = new Date(now.getTime() + REOPEN_WINDOW_DAYS * 86_400_000).toISOString();
      patch.auto_closed_at = null;
    }
  }

  return patch;
}

async function applyErrorDecision({
  auditMessage,
  errorEvent,
  patch,
  requestId,
  supabase,
}: {
  auditMessage: string;
  errorEvent: ErrorEventRow;
  patch: { fixRequired?: boolean; resolvedAt?: string };
  requestId: string;
  supabase: SupabaseClient;
}) {
  const { error } = await supabase
    .from("error_events")
    .update({
      fix_required: patch.fixRequired,
      metadata: {
        ...(errorEvent.metadata ?? {}),
        supportAutopilot: {
          action: "resolve_known_fix",
          message: auditMessage,
          requestId,
          reviewedAt: new Date().toISOString(),
          version: "support_autopilot_v1",
        },
      },
      resolved_at: patch.resolvedAt,
    })
    .eq("id", errorEvent.id);

  if (error) {
    throw new Error("SUPPORT_AUTOPILOT_ERROR_UPDATE_FAILED");
  }
}

function toTicketSnapshot(ticket: SupportTicketRow): SupportAutopilotTicketSnapshot {
  return {
    area: ticket.area,
    errorCode: ticket.error_code,
    escalatedToL2: ticket.escalated_to_l2 ?? false,
    escalationReason: ticket.escalation_reason,
    fixStatus: ticket.fix_status,
    id: ticket.id,
    l1Disposition: ticket.l1_disposition,
    ownerNotes: ticket.owner_notes,
    priority: ticket.priority,
    resolutionVerification: ticket.resolution_verification,
    rootCause: ticket.root_cause,
    rootCauseCategory: ticket.root_cause_category,
    status: ticket.status,
    subject: ticket.subject,
    suggestedFix: ticket.suggested_fix,
    summary: ticket.summary,
    userVisibleResolution: ticket.user_visible_resolution,
  };
}

function toErrorSnapshot(error: ErrorEventRow): SupportAutopilotErrorSnapshot {
  return {
    area: error.area,
    code: error.error_code,
    id: error.id,
    message: error.message,
    rootCauseCategory: error.root_cause_category,
    severity: error.severity,
  };
}

const ticketSelect = [
  "id",
  "user_id",
  "status",
  "priority",
  "subject",
  "summary",
  "l1_disposition",
  "metadata",
  "escalated_to_l2",
  "escalation_reason",
  "area",
  "error_code",
  "root_cause_category",
  "root_cause",
  "suggested_fix",
  "fix_status",
  "owner_notes",
  "user_visible_resolution",
  "resolution_verification",
  "linked_error_event_id",
].join(", ");
