import { NextResponse } from "next/server";

import {
  generateApplicationMaterials,
  generateApplicationMaterialsSchema,
} from "@/lib/applications/material-generation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
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

  try {
    const result = await generateApplicationMaterials(parsed.data);

    return NextResponse.json({
      ok: true,
      requestId,
      ...result,
    });
  } catch (error) {
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

    if (error.message === "JOB_TEXT_REQUIRED") {
      return {
        category: "validation",
        code: "application.job_text_required",
        message: "The job post needs readable text before I can generate targeted materials.",
        status: 422,
      };
    }

    if (error.message === "PROFILE_CONTEXT_TOO_THIN") {
      return {
        category: "validation",
        code: "profile.context_too_thin",
        message: "I need a little more profile evidence before generating credible materials.",
        status: 422,
      };
    }

    if (error.message === "QUOTA_EVENT_RECORD_FAILED") {
      return {
        category: "server",
        code: "application.material_quota_audit_failed",
        message: "The materials were generated, but usage tracking could not be finalized.",
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
