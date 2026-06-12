import { NextResponse } from "next/server";
import { z } from "zod";

import { apiAuthErrorResponse, requireProtectedApiSession } from "@/lib/api/auth";
import {
  buildSupportIssueAnalysis,
  supportIssueCreateSchema,
  toUserSupportIssue,
  type UserSupportTicketRow,
} from "@/lib/support/issues";
import { reviewSupportTicketWithAutopilot } from "@/lib/support/autopilot";
import {
  buildL1SupportPacket,
  sanitizeSupportIssueInput,
} from "@/lib/support/privacy";
import { checkRateLimit, getClientRateLimitKey, rateLimitResponse } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const requestId = crypto.randomUUID();

  try {
    const session = await requireProtectedApiSession();
    const supabase = await createClient();

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
      .eq("user_id", session.user.id)
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
    const authResponse = apiAuthErrorResponse({
      error,
      fallbackMessage: "Sign in is required.",
      requestId,
    });
    if (authResponse) return authResponse;

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
    const session = await requireProtectedApiSession();
    const supabase = await createClient();

    const input = supportIssueCreateSchema.parse(await request.json());
    const safeInput = sanitizeSupportIssueInput(input);
    const analysis = buildSupportIssueAnalysis(safeInput);
    const l1SupportPacket = buildL1SupportPacket({
      analysis,
      input: safeInput,
      requestId,
    });
    const existingIssue = await findActiveDuplicateIssue({
      area: safeInput.area,
      errorCode: safeInput.errorCode ?? "USER_REPORTED_ISSUE",
      rootCauseCategory: analysis.rootCauseCategory,
      supabase,
      userId: session.user.id,
    });

    if (existingIssue) {
      const groupedIssue = await createSupportIssueWithMessages({
        analysis,
        existingTicketId: existingIssue.id,
        l1SupportPacket,
        requestId,
        safeInput,
        supabase,
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
          id: groupedIssue.id,
          shortId: groupedIssue.shortId,
          status: autopilotResult?.status ?? groupedIssue.status,
          subject: groupedIssue.subject,
          summary: groupedIssue.summary,
        },
      });
    }

    const ticket = await createSupportIssueWithMessages({
      analysis,
      l1SupportPacket,
      requestId,
      safeInput,
      supabase,
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
        shortId: ticket.shortId,
        status: autopilotResult?.status ?? ticket.status,
        subject: ticket.subject,
        summary: ticket.summary,
      },
    });
  } catch (error) {
    const authResponse = apiAuthErrorResponse({
      error,
      fallbackMessage: "Sign in is required.",
      requestId,
    });
    if (authResponse) return authResponse;

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

type SupportIssueAnalysis = ReturnType<typeof buildSupportIssueAnalysis>;
type L1SupportPacket = ReturnType<typeof buildL1SupportPacket>;
type SanitizedSupportIssueInput = z.infer<typeof supportIssueCreateSchema>;

async function createSupportIssueWithMessages({
  analysis,
  existingTicketId,
  l1SupportPacket,
  requestId,
  safeInput,
  supabase,
}: {
  analysis: SupportIssueAnalysis;
  existingTicketId?: string;
  l1SupportPacket: L1SupportPacket;
  requestId: string;
  safeInput: SanitizedSupportIssueInput;
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  const { data, error } = await supabase.rpc("create_support_issue_with_messages", {
    p_area: safeInput.area,
    p_error_code: safeInput.errorCode ?? "USER_REPORTED_ISSUE",
    p_escalated_to_l2: l1SupportPacket.escalationRequired,
    p_escalation_reason: l1SupportPacket.escalationReason,
    p_existing_ticket_id: existingTicketId ?? null,
    p_fix_status: analysis.fixStatus,
    p_l1_disposition: l1SupportPacket.escalationRequired
      ? "l2_packet_prepared"
      : "intake_packet_prepared",
    p_metadata: buildSupportTicketMetadata({
      analysis,
      l1SupportPacket,
      requestId,
      safeInput,
    }),
    p_priority: analysis.priority,
    p_root_cause: analysis.rootCause,
    p_root_cause_category: analysis.rootCauseCategory,
    p_sensitive_context: buildSensitiveSupportContext({
      analysis,
      l1SupportPacket,
      requestId,
      safeInput,
    }),
    p_sentiment: inferSentiment(safeInput.userMessage ?? safeInput.systemResponse ?? ""),
    p_source: safeInput.source,
    p_status: l1SupportPacket.escalationRequired ? "escalated" : "open",
    p_subject: analysis.title,
    p_suggested_fix: analysis.suggestedFix,
    p_summary: analysis.summary,
    p_system_message: safeInput.systemResponse ?? safeInput.errorMessage ?? null,
    p_user_message: safeInput.userMessage ?? null,
  });

  if (error) {
    throw new Error("SUPPORT_ISSUE_TRANSACTION_FAILED");
  }

  return parseSupportTicketRpcResult(data);
}

function buildSupportTicketMetadata({
  analysis,
  l1SupportPacket,
  requestId,
  safeInput,
}: {
  analysis: SupportIssueAnalysis;
  l1SupportPacket: L1SupportPacket;
  requestId: string;
  safeInput: SanitizedSupportIssueInput;
}) {
  return {
    ...safeInput.metadata,
    errorCode: safeInput.errorCode ?? null,
    l1SupportPacket,
    requestId,
    rootCauseCategory: analysis.rootCauseCategory,
    source: safeInput.source,
    supportContextIncluded: safeInput.supportContextConsent,
    title: analysis.title,
    userMessagePreview: safeInput.userMessage ? safeInput.userMessage.slice(0, 240) : null,
  };
}

function buildSensitiveSupportContext({
  analysis,
  l1SupportPacket,
  requestId,
  safeInput,
}: {
  analysis: SupportIssueAnalysis;
  l1SupportPacket: L1SupportPacket;
  requestId: string;
  safeInput: SanitizedSupportIssueInput;
}) {
  if (!safeInput.supportContextConsent) {
    return null;
  }

  return {
    analysis: {
      priority: analysis.priority,
      rootCauseCategory: analysis.rootCauseCategory,
    },
    errorCode: safeInput.errorCode ?? null,
    errorMessage: safeInput.errorMessage ?? null,
    metadata: safeInput.metadata,
    requestId,
    source: safeInput.source,
    systemResponse: safeInput.systemResponse ?? null,
    supportPacket: l1SupportPacket,
  };
}

function parseSupportTicketRpcResult(data: unknown) {
  if (!data || typeof data !== "object") {
    throw new Error("SUPPORT_ISSUE_TRANSACTION_EMPTY");
  }

  const result = data as Record<string, unknown>;
  const id = typeof result.id === "string" ? result.id : null;
  const status = typeof result.status === "string" ? result.status : null;
  const subject = typeof result.subject === "string" ? result.subject : null;
  const summary = typeof result.summary === "string" ? result.summary : null;

  if (!id || !status || !subject || !summary) {
    throw new Error("SUPPORT_ISSUE_TRANSACTION_INVALID");
  }

  return {
    id,
    shortId: typeof result.shortId === "string" ? result.shortId : `PR-${id.slice(0, 8).toUpperCase()}`,
    status,
    subject,
    summary,
  };
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
