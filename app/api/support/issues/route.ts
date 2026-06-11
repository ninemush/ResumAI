import { NextResponse } from "next/server";
import { z } from "zod";

import {
  buildSupportIssueAnalysis,
  supportIssueCreateSchema,
  supportIssueShortId,
  toUserSupportIssue,
  type UserSupportTicketRow,
} from "@/lib/support/issues";
import { reviewSupportTicketWithAutopilot } from "@/lib/support/autopilot";
import {
  buildL1SupportPacket,
  getEscalationReason,
  sanitizeSupportIssueInput,
} from "@/lib/support/privacy";
import { checkRateLimit, getClientRateLimitKey, rateLimitResponse } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const requestId = crypto.randomUUID();

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: { code: "auth.required", message: "Sign in is required." },
        },
        { status: 401 },
      );
    }

    const { data: issues, error } = await supabase
      .from("support_tickets")
      .select(
        [
          "id",
          "area",
          "created_at",
          "updated_at",
          "status",
          "priority",
          "subject",
          "summary",
          "root_cause",
          "root_cause_category",
          "suggested_fix",
          "fix_status",
          "user_visible_resolution",
          "reopen_until",
          "auto_closed_at",
          "closed_reason",
        ].join(", "),
      )
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(25);

    if (error) {
      throw new Error("SUPPORT_ISSUES_READ_FAILED");
    }

    return NextResponse.json({
      ok: true,
      requestId,
      issues: ((issues ?? []) as unknown as UserSupportTicketRow[]).map((issue) =>
        toUserSupportIssue(issue),
      ),
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "support_issues_read_failed",
        code: error instanceof Error ? error.message : "UNKNOWN_SUPPORT_ISSUES_ERROR",
      }),
    );

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: { code: "support.issues_failed", message: "Support issues could not be loaded." },
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "support_issue_create"),
    limit: 20,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Support issues are being logged too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: { code: "auth.required", message: "Sign in is required." },
        },
        { status: 401 },
      );
    }

    const input = supportIssueCreateSchema.parse(await request.json());
    const safeInput = sanitizeSupportIssueInput(input);
    const analysis = buildSupportIssueAnalysis(safeInput);
    const l1SupportPacket = buildL1SupportPacket({
      analysis,
      input: safeInput,
      requestId,
    });
    const escalationReason = getEscalationReason(safeInput, analysis);
    const existingIssue = await findActiveDuplicateIssue({
      area: safeInput.area,
      errorCode: safeInput.errorCode ?? "USER_REPORTED_ISSUE",
      rootCauseCategory: analysis.rootCauseCategory,
      supabase,
      userId: user.id,
    });

    if (existingIssue) {
      await appendSupportIssueMessages({
        errorCode: safeInput.errorCode ?? null,
        errorMessage: safeInput.errorMessage,
        requestId,
        supabase,
        systemResponse: safeInput.systemResponse,
        ticketId: existingIssue.id,
        userId: user.id,
        userMessage: safeInput.userMessage,
      });

      const autopilotResult = await safelyRunIntakeAutopilot({
        requestId,
        ticketId: existingIssue.id,
      });

      return NextResponse.json({
        ok: true,
        requestId,
        issue: {
          groupedWithExisting: true,
          id: existingIssue.id,
          shortId: supportIssueShortId(existingIssue.id),
          status: autopilotResult?.status ?? existingIssue.status,
          subject: existingIssue.subject,
          summary: existingIssue.summary,
        },
      });
    }

    const { data: errorEvent } = await supabase
      .from("error_events")
      .insert({
        area: safeInput.area,
        error_code: safeInput.errorCode ?? "USER_REPORTED_ISSUE",
        fix_required: analysis.fixStatus === "needs_code_fix",
        message:
          safeInput.errorMessage ??
          safeInput.systemResponse ??
          safeInput.userMessage ??
          analysis.summary,
        metadata: {
          ...safeInput.metadata,
          errorMessage: safeInput.errorMessage ?? null,
          requestId,
          source: safeInput.source,
          systemResponse: safeInput.systemResponse ?? null,
          title: analysis.title,
          userMessage: safeInput.userMessage ?? null,
        },
        rationale: analysis.rootCause,
        root_cause_category: analysis.rootCauseCategory,
        severity: analysis.priority === "urgent" ? "critical" : analysis.priority === "high" ? "high" : "medium",
        user_id: user.id,
      })
      .select("id")
      .single();

    const { data: ticket, error: ticketError } = await supabase
      .from("support_tickets")
      .insert({
        area: safeInput.area,
        error_code: safeInput.errorCode ?? "USER_REPORTED_ISSUE",
        escalated_to_l2: l1SupportPacket.escalationRequired,
        escalation_reason: escalationReason,
        fix_status: analysis.fixStatus,
        linked_error_event_id: errorEvent?.id ?? null,
        l1_disposition: l1SupportPacket.escalationRequired
          ? "l2_packet_prepared"
          : "intake_packet_prepared",
        metadata: {
          ...safeInput.metadata,
          errorCode: safeInput.errorCode ?? null,
          errorMessage: safeInput.errorMessage ?? null,
          l1SupportPacket,
          requestId,
          source: safeInput.source,
          supportContextIncluded: safeInput.supportContextConsent,
          systemResponse: safeInput.systemResponse ?? null,
          userMessagePreview: safeInput.userMessage ? safeInput.userMessage.slice(0, 240) : null,
        },
        priority: analysis.priority,
        root_cause: analysis.rootCause,
        root_cause_category: analysis.rootCauseCategory,
        sentiment: inferSentiment(safeInput.userMessage ?? safeInput.systemResponse ?? ""),
        source: safeInput.source,
        status: l1SupportPacket.escalationRequired ? "escalated" : "open",
        subject: analysis.title,
        suggested_fix: analysis.suggestedFix,
        summary: analysis.summary,
        user_id: user.id,
      })
      .select("id, status, subject, summary")
      .single();

    if (ticketError || !ticket) {
      throw new Error("SUPPORT_ISSUE_INSERT_FAILED");
    }

    await appendSupportIssueMessages({
      errorCode: safeInput.errorCode ?? null,
      errorMessage: safeInput.errorMessage,
      requestId,
      supabase,
      systemResponse: safeInput.systemResponse,
      ticketId: ticket.id,
      userId: user.id,
      userMessage: safeInput.userMessage,
    });

    const autopilotResult = await safelyRunIntakeAutopilot({
      requestId,
      ticketId: ticket.id,
    });

    return NextResponse.json({
      ok: true,
      requestId,
      issue: {
        id: ticket.id,
        shortId: supportIssueShortId(ticket.id),
        status: autopilotResult?.status ?? ticket.status,
        subject: ticket.subject,
        summary: ticket.summary,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: { code: "support.invalid_issue", message: "Issue details were invalid." },
        },
        { status: 400 },
      );
    }

    console.warn(
      JSON.stringify({
        event: "support_issue_create_failed",
        code: error instanceof Error ? error.message : "UNKNOWN_SUPPORT_ISSUE_ERROR",
      }),
    );

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: { code: "support.issue_failed", message: "Issue could not be logged." },
      },
      { status: 500 },
    );
  }
}

async function safelyRunIntakeAutopilot({
  requestId,
  ticketId,
}: {
  requestId: string;
  ticketId: string;
}) {
  try {
    return await reviewSupportTicketWithAutopilot({
      mode: "intake",
      requestId,
      supabase: createAdminClient(),
      ticketId,
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "support_autopilot_intake_failed",
        code: error instanceof Error ? error.message : "UNKNOWN_SUPPORT_AUTOPILOT_INTAKE_ERROR",
        requestId,
        ticketId,
      }),
    );

    return null;
  }
}

async function findActiveDuplicateIssue({
  area,
  errorCode,
  rootCauseCategory,
  supabase,
  userId,
}: {
  area: string;
  errorCode: string;
  rootCauseCategory: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}) {
  const { data } = await supabase
    .from("support_tickets")
    .select("id, status, subject, summary")
    .eq("user_id", userId)
    .eq("area", area)
    .eq("root_cause_category", rootCauseCategory)
    .eq("error_code", errorCode)
    .in("status", ["open", "waiting_on_user", "in_progress", "escalated"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as
    | {
        id: string;
        status: string;
        subject: string;
        summary: string;
      }
    | null;
}

async function appendSupportIssueMessages({
  errorCode,
  errorMessage,
  requestId,
  supabase,
  systemResponse,
  ticketId,
  userId,
  userMessage,
}: {
  errorCode: string | null;
  errorMessage?: string;
  requestId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
  systemResponse?: string;
  ticketId: string;
  userId: string;
  userMessage?: string;
}) {
  if (userMessage) {
    await supabase.from("support_ticket_messages").insert({
      message: userMessage,
      metadata: { requestId },
      speaker: "user",
      ticket_id: ticketId,
      user_id: userId,
    });
  }

  if (systemResponse || errorMessage) {
    await supabase.from("support_ticket_messages").insert({
      message: systemResponse ?? errorMessage ?? "Support issue recurrence captured.",
      metadata: { requestId, errorCode },
      speaker: "system",
      ticket_id: ticketId,
      user_id: userId,
    });
  }
}

function inferSentiment(text: string) {
  const normalized = text.toLowerCase();

  if (/\b(angry|furious|unacceptable|horrible|terrible|useless)\b/.test(normalized)) {
    return "angry";
  }

  if (/\b(frustrated|annoying|not working|wrong|failed|broken|bad)\b/.test(normalized)) {
    return "frustrated";
  }

  return "neutral";
}
