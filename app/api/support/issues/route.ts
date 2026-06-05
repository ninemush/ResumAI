import { NextResponse } from "next/server";
import { z } from "zod";

import {
  buildSupportIssueAnalysis,
  supportIssueCreateSchema,
  supportIssueShortId,
} from "@/lib/support/issues";
import { checkRateLimit, getClientRateLimitKey, rateLimitResponse } from "@/lib/security/rate-limit";
import { redactOperationalMetadata, redactOperationalText } from "@/lib/security/redaction";
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
      issues: (issues ?? []).map((issue) => {
        const ticket = issue as unknown as {
          area: string;
          created_at: string;
          fix_status: string;
          id: string;
          auto_closed_at: string | null;
          closed_reason: string | null;
          priority: string;
          reopen_until: string | null;
          root_cause: string | null;
          root_cause_category: string | null;
          status: string;
          subject: string;
          suggested_fix: string | null;
          summary: string;
          updated_at: string;
          user_visible_resolution: string | null;
        };
        const visibleStatus = readVisibleSupportStatus(ticket.status, ticket.reopen_until);

        return {
          area: ticket.area,
          auto_closed_at: ticket.auto_closed_at,
          closed_reason: ticket.closed_reason,
          created_at: ticket.created_at,
          fix_status: ticket.fix_status,
          id: ticket.id,
          priority: ticket.priority,
          reopen_until: ticket.reopen_until,
          root_cause: ticket.root_cause,
          root_cause_category: ticket.root_cause_category,
          shortId: supportIssueShortId(ticket.id),
          status: visibleStatus,
          subject: ticket.subject,
          suggested_fix: ticket.suggested_fix,
          summary: ticket.summary,
          updated_at: ticket.updated_at,
          user_visible_resolution: ticket.user_visible_resolution,
        };
      }),
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
    const safeInput = {
      ...input,
      area: redactOperationalText(input.area, 80),
      errorCode: input.errorCode ? redactOperationalText(input.errorCode, 120) : undefined,
      errorMessage: input.errorMessage ? redactOperationalText(input.errorMessage, 500) : undefined,
      metadata: redactOperationalMetadata(input.metadata),
      source: redactOperationalText(input.source, 80),
      systemResponse: input.systemResponse
        ? redactOperationalText(input.systemResponse, 2000)
        : undefined,
      title: input.title ? redactOperationalText(input.title, 180) : undefined,
      userMessage: input.userMessage ? redactOperationalText(input.userMessage, 2000) : undefined,
    };
    const analysis = buildSupportIssueAnalysis(safeInput);

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
        fix_status: analysis.fixStatus,
        linked_error_event_id: errorEvent?.id ?? null,
        l1_disposition: "not_started",
        metadata: {
          ...safeInput.metadata,
          errorCode: safeInput.errorCode ?? null,
          errorMessage: safeInput.errorMessage ?? null,
          requestId,
          source: safeInput.source,
          systemResponse: safeInput.systemResponse ?? null,
          userMessage: safeInput.userMessage ?? null,
        },
        priority: analysis.priority,
        root_cause: analysis.rootCause,
        root_cause_category: analysis.rootCauseCategory,
        sentiment: inferSentiment(safeInput.userMessage ?? safeInput.systemResponse ?? ""),
        source: safeInput.source,
        status: "open",
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

    if (safeInput.userMessage) {
      await supabase.from("support_ticket_messages").insert({
        message: safeInput.userMessage,
        metadata: { requestId },
        speaker: "user",
        ticket_id: ticket.id,
        user_id: user.id,
      });
    }

    if (safeInput.systemResponse || safeInput.errorMessage) {
      await supabase.from("support_ticket_messages").insert({
        message: safeInput.systemResponse ?? safeInput.errorMessage ?? analysis.summary,
        metadata: { requestId, errorCode: safeInput.errorCode ?? null },
        speaker: "system",
        ticket_id: ticket.id,
        user_id: user.id,
      });
    }

    return NextResponse.json({
      ok: true,
      requestId,
      issue: {
        id: ticket.id,
        shortId: supportIssueShortId(ticket.id),
        status: ticket.status,
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

function readVisibleSupportStatus(status: string, reopenUntil: string | null) {
  if (status !== "resolved" || !reopenUntil) {
    return status;
  }

  return new Date(reopenUntil).getTime() < Date.now() ? "closed" : status;
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
