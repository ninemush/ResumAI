import { NextResponse } from "next/server";

import {
  buildCreditsApiError,
  consumeCredits,
  requireCredits,
} from "@/lib/billing/credits";
import {
  generateMasterResume,
  generateMasterResumeSchema,
  updateMasterResume,
  updateMasterResumeSchema,
} from "@/lib/resumes/master-resume";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const body = await readOptionalJson(request);
  const parsed = generateMasterResumeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "resume.invalid_instruction",
          message: "Use a short resume instruction before regenerating.",
        },
      },
      { status: 400 },
    );
  }

  try {
    await requireCredits("masterResumeGenerate");
    const result = await generateMasterResume(parsed.data);
    await consumeCredits({
      feature: "masterResumeGenerate",
      metadata: { instruction: parsed.data.instruction ?? null },
      resourceId: result.resumeId,
      resourceType: "master_resume",
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
        error: { category, code, message },
      },
      { status },
    );
  }
}

async function readOptionalJson(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return {};
  }

  try {
    return await request.json();
  } catch {
    return {};
  }
}

export async function PATCH(request: Request) {
  const requestId = crypto.randomUUID();
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

  const parsed = updateMasterResumeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "resume.invalid_input",
          message: "Use valid resume sections before saving.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const overview = await updateMasterResume(parsed.data);

    return NextResponse.json({
      ok: true,
      requestId,
      overview,
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
  if (error instanceof Error && error.message === "AUTH_REQUIRED") {
    return {
      category: "auth",
      code: "auth.required",
      message: "Please sign in before working on your resume.",
      status: 401,
    };
  }

  if (error instanceof Error && error.message === "MASTER_RESUME_CONTEXT_TOO_THIN") {
    return {
      category: "validation",
      code: "resume.context_too_thin",
      message:
        "Add a little more career context, skills, and target direction before generating a trustworthy master resume.",
      status: 400,
    };
  }

  if (error instanceof Error && error.message === "MASTER_RESUME_NOT_FOUND") {
    return {
      category: "not_found",
      code: "resume.not_found",
      message: "Generate a master resume before saving edits.",
      status: 404,
    };
  }

  return {
    category: "server",
    code: "resume.operation_failed",
    message: "Unable to update the master resume right now.",
    status: 500,
  };
}

function isBillingError(error: unknown) {
  return error instanceof Error && error.message.startsWith("CREDITS_");
}
