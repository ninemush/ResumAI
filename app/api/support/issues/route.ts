import { NextResponse } from "next/server";
import { z } from "zod";

import {
  buildSupportIssueAnalysis,
  supportIssueCreateSchema,
  supportIssueShortId,
} from "@/lib/support/issues";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
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

    const input = supportIssueCreateSchema.parse(await request.json());
    const analysis = buildSupportIssueAnalysis(input);

    const { data: errorEvent } = await supabase
      .from("error_events")
      .insert({
        area: input.area,
        error_code: input.errorCode ?? "USER_REPORTED_ISSUE",
        fix_required: analysis.fixStatus === "needs_code_fix",
        message: input.errorMessage ?? input.systemResponse ?? input.userMessage ?? analysis.summary,
        metadata: {
          ...input.metadata,
          requestId,
          source: input.source,
          title: analysis.title,
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
        area: input.area,
        error_code: input.errorCode ?? "USER_REPORTED_ISSUE",
        fix_status: analysis.fixStatus,
        linked_error_event_id: errorEvent?.id ?? null,
        l1_disposition: "not_started",
        metadata: {
          ...input.metadata,
          requestId,
          systemResponse: input.systemResponse ?? null,
        },
        priority: analysis.priority,
        root_cause: analysis.rootCause,
        root_cause_category: analysis.rootCauseCategory,
        sentiment: inferSentiment(input.userMessage ?? input.systemResponse ?? ""),
        source: input.source,
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

    if (input.userMessage) {
      await supabase.from("support_ticket_messages").insert({
        message: input.userMessage,
        metadata: { requestId },
        speaker: "user",
        ticket_id: ticket.id,
        user_id: user.id,
      });
    }

    if (input.systemResponse || input.errorMessage) {
      await supabase.from("support_ticket_messages").insert({
        message: input.systemResponse ?? input.errorMessage ?? analysis.summary,
        metadata: { requestId, errorCode: input.errorCode ?? null },
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
