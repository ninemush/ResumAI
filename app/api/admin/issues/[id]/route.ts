import { NextResponse } from "next/server";
import { z } from "zod";

import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { supportIssueUpdateSchema } from "@/lib/support/issues";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const REOPEN_WINDOW_DAYS = 10;

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "admin_issue_update"),
    limit: 60,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Issue updates are being submitted too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    const { id } = await context.params;
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

    const input = supportIssueUpdateSchema.parse(await request.json());
    const patch = toSupportTicketPatch(input);

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: { code: "support.no_changes", message: "No issue changes were provided." },
        },
        { status: 400 },
      );
    }

    const { data: ticket, error } = await supabase
      .from("support_tickets")
      .update(patch)
      .eq("id", id)
      .select(
        "id, status, priority, fix_status, owner_notes, user_visible_resolution, reopen_until, auto_closed_at, updated_at",
      )
      .single();

    if (error || !ticket) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: {
            code: "admin.issue_update_failed",
            message: "Issue could not be updated. Owner/admin access is required.",
          },
        },
        { status: 403 },
      );
    }

    await supabase.from("support_ticket_messages").insert({
      message: buildAdminAuditMessage(input),
      metadata: { requestId, patch },
      speaker: "admin",
      ticket_id: id,
      user_id: user.id,
    });

    return NextResponse.json({ ok: true, requestId, issue: ticket });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: { code: "support.invalid_update", message: "Issue update was invalid." },
        },
        { status: 400 },
      );
    }

    console.warn(
      JSON.stringify({
        event: "admin_issue_update_failed",
        code: error instanceof Error ? error.message : "UNKNOWN_ADMIN_ISSUE_ERROR",
      }),
    );

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: { code: "admin.issue_update_failed", message: "Issue could not be updated." },
      },
      { status: 500 },
    );
  }
}

function toSupportTicketPatch(input: z.infer<typeof supportIssueUpdateSchema>) {
  const patch: Record<string, unknown> = {};

  if (input.closedReason !== undefined) patch.closed_reason = input.closedReason;
  if (input.escalatedToL2 !== undefined) patch.escalated_to_l2 = input.escalatedToL2;
  if (input.escalationReason !== undefined) patch.escalation_reason = input.escalationReason;
  if (input.fixStatus !== undefined) patch.fix_status = input.fixStatus;
  if (input.l1Disposition !== undefined) patch.l1_disposition = input.l1Disposition;
  if (input.ownerNotes !== undefined) patch.owner_notes = input.ownerNotes;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.rootCause !== undefined) patch.root_cause = input.rootCause;
  if (input.rootCauseCategory !== undefined) patch.root_cause_category = input.rootCauseCategory;
  if (input.userVisibleResolution !== undefined) {
    patch.user_visible_resolution = input.userVisibleResolution;
  }
  if (input.status !== undefined) {
    patch.status = input.status;
    const now = new Date();

    if (input.status === "resolved") {
      patch.resolved_at = now.toISOString();
      patch.reopen_until = new Date(now.getTime() + REOPEN_WINDOW_DAYS * 86_400_000).toISOString();
      patch.auto_closed_at = null;
    } else if (input.status === "closed") {
      patch.resolved_at = now.toISOString();
      patch.reopen_until = null;
    }
  }
  if (input.suggestedFix !== undefined) patch.suggested_fix = input.suggestedFix;

  return patch;
}

function buildAdminAuditMessage(input: z.infer<typeof supportIssueUpdateSchema>) {
  const parts = [
    input.status ? `status=${input.status}` : null,
    input.fixStatus ? `fix=${input.fixStatus}` : null,
    input.priority ? `priority=${input.priority}` : null,
    input.userVisibleResolution ? `user_visible_resolution=${input.userVisibleResolution}` : null,
    input.ownerNotes ? `owner_notes=${input.ownerNotes}` : null,
    input.closedReason ? `reason=${input.closedReason}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? `Owner updated issue: ${parts.join("; ")}` : "Owner updated issue.";
}
