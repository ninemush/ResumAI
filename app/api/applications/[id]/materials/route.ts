import { NextResponse } from "next/server";

import {
  buildCreditsApiError,
  consumeCredits,
  requireCredits,
} from "@/lib/billing/credits";
import {
  generateApplicationMaterials,
  generateApplicationMaterialsSchema,
} from "@/lib/applications/material-generation";
import {
  getMaterialReview,
  updateMaterialReview,
  updateMaterialReviewSchema,
} from "@/lib/applications/material-review";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const params = await context.params;

  try {
    const review = await getMaterialReview({ applicationId: params.id });

    return NextResponse.json({
      ok: true,
      requestId,
      review,
    });
  } catch (error) {
    const { category, code, message, status } = toApiError(error);

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: { category, code, message },
      },
      { status },
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const params = await context.params;
  const parsed = generateApplicationMaterialsSchema.safeParse({
    applicationId: params.id,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "application.invalid_id",
          message: "Choose a valid application.",
        },
      },
      { status: 400 },
    );
  }

  const rateLimit = checkRateLimit({
    key: getClientRateLimitKey(request, "application_materials_generate"),
    limit: 8,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message:
        "Application packet generation is being requested too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    await requireSignedInUser();
    await requireCredits("applicationMaterialsGenerate");
    const result = await generateApplicationMaterials(parsed.data);
    await consumeCredits({
      feature: "applicationMaterialsGenerate",
      metadata: {
        cover_letter_id: result.coverLetterId,
        resume_id: result.resumeId,
      },
      resourceId: params.id,
      resourceType: "application_materials",
    });

    return NextResponse.json({
      ok: true,
      requestId,
      ...result,
    });
  } catch (error) {
    if (isBillingError(error)) {
      const apiError = buildCreditsApiError(error);

      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: apiError,
        },
        { status: apiError.status },
      );
    }

    const { category, code, message, status } = toApiError(error);

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category,
          code,
          message,
        },
      },
      { status },
    );
  }
}

function isBillingError(error: unknown) {
  return error instanceof Error && error.message.startsWith("CREDITS_");
}

async function requireSignedInUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const rateLimit = checkRateLimit({
    key: getClientRateLimitKey(request, "application_materials_update"),
    limit: 60,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message:
        "Material edits are being saved too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }
  const params = await context.params;
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "request.invalid_json",
          message: "Invalid JSON body.",
        },
      },
      { status: 400 },
    );
  }

  const parsed = updateMaterialReviewSchema.safeParse({
    ...(typeof body === "object" && body ? body : {}),
    applicationId: params.id,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "application.invalid_material_update",
          message:
            "Use valid resume sections or cover-letter text before saving.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const review = await updateMaterialReview(parsed.data);

    return NextResponse.json({
      ok: true,
      requestId,
      review,
    });
  } catch (error) {
    const { category, code, message, status } = toApiError(error);

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: { category, code, message },
      },
      { status },
    );
  }
}

function toApiError(error: unknown) {
  if (error instanceof Error) {
    if (error.message === "AUTH_REQUIRED") {
      return {
        category: "auth",
        code: "auth.required",
        message: "Please sign in before generating materials.",
        status: 401,
      };
    }

    if (error.message === "APPLICATION_NOT_FOUND") {
      return {
        category: "not_found",
        code: "application.not_found",
        message: "That application could not be found.",
        status: 404,
      };
    }

    if (error.message === "MATERIAL_UPDATE_REQUIRED") {
      return {
        category: "validation",
        code: "application.material_update_required",
        message: "Change resume or cover-letter content before saving.",
        status: 400,
      };
    }

    if (error.message === "JOB_TEXT_REQUIRED") {
      return {
        category: "validation",
        code: "application.job_text_required",
        message:
          "The job post needs enough detail before I can draft credible job-specific materials.",
        status: 422,
      };
    }

    if (
      error.message === "RESUME_NOT_FOUND" ||
      error.message === "COVER_LETTER_NOT_FOUND"
    ) {
      return {
        category: "not_found",
        code: "application.materials_not_found",
        message:
          "Draft the job-specific materials before reviewing or editing them.",
        status: 404,
      };
    }

    if (error.message === "PROFILE_CONTEXT_TOO_THIN") {
      return {
        category: "validation",
        code: "profile.context_too_thin",
        message:
          "I need a little more profile evidence before creating credible application materials.",
        status: 422,
      };
    }

    if (error.message === "MASTER_RESUME_READ_FAILED") {
      return {
        category: "server",
        code: "resume.master_read_failed",
        message:
          "I could not read the master resume context for this generation.",
        status: 500,
      };
    }

    if (error.message === "QUOTA_EVENT_RECORD_FAILED") {
      return {
        category: "server",
        code: "application.material_quota_audit_failed",
        message:
          "The materials were generated, but usage tracking could not be finalized.",
        status: 500,
      };
    }
  }

  return {
    category: "server",
    code: "application.material_generation_failed",
    message: "Unable to generate application materials right now.",
    status: 500,
  };
}
