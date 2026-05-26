import { NextResponse } from "next/server";

import { analyzeJobFitForJobId, jobFitRequestSchema } from "@/lib/jobs/job-fit";

export async function GET(_request: Request, context: RouteContext<"/api/jobs/[id]/fit">) {
  const requestId = crypto.randomUUID();
  const params = await context.params;
  const parsed = jobFitRequestSchema.safeParse({ jobId: params.id });

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "job.invalid_id",
          message: "Choose a valid job post.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const fitAnalysis = await analyzeJobFitForJobId(parsed.data);

    return NextResponse.json({
      ok: true,
      requestId,
      fitAnalysis,
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
      message: "Please sign in before reviewing job fit.",
      status: 401,
    };
  }

  if (error instanceof Error && error.message === "JOB_NOT_FOUND") {
    return {
      category: "not_found",
      code: "job.not_found",
      message: "That job post could not be found.",
      status: 404,
    };
  }

  if (error instanceof Error && error.message === "JOB_NOT_READY") {
    return {
      category: "validation",
      code: "job.not_ready",
      message: "The job post needs to be ingested before fit review.",
      status: 409,
    };
  }

  return {
    category: "server",
    code: "job.fit_failed",
    message: "Unable to analyze job fit right now.",
    status: 500,
  };
}
