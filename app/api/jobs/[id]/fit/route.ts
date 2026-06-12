import { NextResponse } from "next/server";

import { apiAuthErrorDetails, requireProtectedApiSession } from "@/lib/api/auth";
import { analyzeJobFitForJobId, jobFitRequestSchema } from "@/lib/jobs/job-fit";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
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
    await requireProtectedApiSession();
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
  const authError = apiAuthErrorDetails(error, "Please sign in before reviewing job fit.");
  if (authError) return authError;

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
