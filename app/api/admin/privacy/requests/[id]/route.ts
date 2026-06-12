import { NextResponse } from "next/server";
import { z } from "zod";

import { apiAuthErrorResponse, requireProtectedApiSession } from "@/lib/api/auth";
import {
  attachDeletionPlanToRequest,
  completeDeletionReviewForRequest,
} from "@/lib/privacy/deletion-plan";
import { updateAdminPrivacyRequest } from "@/lib/privacy/requests";
import { adminPrivacyRequestUpdateSchema } from "@/lib/privacy/schemas";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const adminPrivacyPatchSchema = adminPrivacyRequestUpdateSchema.extend({
  action: z.enum(["update", "build_deletion_plan", "complete_deletion_review"]).default("update"),
});

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "admin_privacy_request_update"),
    limit: 40,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Privacy request updates are being submitted too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    await requireProtectedApiSession({ requireAdmin: true });
    const { id } = await context.params;
    const input = adminPrivacyPatchSchema.parse(await request.json());

    if (input.action === "build_deletion_plan") {
      const deletionPlan = await attachDeletionPlanToRequest(id);

      return NextResponse.json({
        ok: true,
        deletionPlan,
        requestId,
      });
    }

    if (input.action === "complete_deletion_review") {
      const resolutionSummary = input.resolutionSummary?.trim();

      if (!resolutionSummary) {
        return NextResponse.json(
          {
            ok: false,
            requestId,
            error: {
              category: "validation",
              code: "privacy.resolution_summary_required",
              message: "Add a resolution summary before completing deletion review.",
            },
          },
          { status: 400 },
        );
      }

      const completed = await completeDeletionReviewForRequest({
        requestId: id,
        resolutionSummary,
      });

      return NextResponse.json({
        ok: true,
        completed,
        requestId,
      });
    }

    const privacyRequest = await updateAdminPrivacyRequest({ id, input });

    return NextResponse.json({
      ok: true,
      request: privacyRequest,
      requestId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: {
            category: "validation",
            code: "privacy.invalid_admin_update",
            message: "Use a valid status, notes, or deletion-plan action.",
          },
        },
        { status: 400 },
      );
    }

    const authResponse = apiAuthErrorResponse({
      error,
      fallbackMessage: "Sign in is required.",
      requestId,
    });
    if (authResponse) return authResponse;

    if (error instanceof Error && error.message === "ADMIN_REQUIRED") {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: { category: "auth", code: "admin.required", message: "Owner or admin access is required." },
        },
        { status: 403 },
      );
    }

    console.warn(
      JSON.stringify({
        code: error instanceof Error ? error.message : "UNKNOWN_ADMIN_PRIVACY_ERROR",
        event: "admin_privacy_request_update_failed",
        requestId,
      }),
    );

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "server",
          code: "admin.privacy_request_update_failed",
          message: "Privacy request could not be updated.",
        },
      },
      { status: 500 },
    );
  }
}
