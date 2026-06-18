import { apiAuthErrorDetails, requireProtectedApiSession } from "@/lib/api/auth";
import { apiError, apiSuccess, createRequestId, readJsonBody } from "@/lib/api/responses";
import {
  buildCreditsApiError,
  getCreditOperationKey,
  isCreditOperationError,
} from "@/lib/billing/credits";
import { runPaidCreditOperation } from "@/lib/billing/credit-operations";
import {
  getJobIngestionById,
  getReusableJobIngestion,
  ingestJobUrl,
  jobIngestionRequestSchema,
} from "@/lib/jobs/job-ingestion";
import { buildJobIngestionOperationKey } from "@/lib/quota/operation-key";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { buildOperationFingerprint } from "@/lib/security/operation-fingerprint";

export async function POST(request: Request) {
  const requestId = createRequestId();
  let body: unknown;

  try {
    body = await readJsonBody(request);
  } catch {
    return apiError(requestId, {
      category: "validation",
      code: "request.invalid_json",
      message: "Invalid JSON body.",
      status: 400,
    });
  }

  const parsed = jobIngestionRequestSchema.safeParse(body);

  if (!parsed.success) {
    return apiError(requestId, {
      category: "validation",
      code: "job.invalid_url",
      message: "Enter a valid http or https job posting URL.",
      status: 400,
    });
  }

  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "job_ingest"),
    limit: 12,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Job links are being read too quickly. Pause briefly before adding another role.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    const session = await requireProtectedApiSession();
    const reusableJob = await getReusableJobIngestion(parsed.data);

    if (reusableJob) {
      return apiSuccess({
        requestId,
        ...reusableJob,
        reused: true,
      });
    }

    const operationKey = getCreditOperationKey(
      request,
      buildJobIngestionOperationKey(parsed.data),
    );
    const paidOperation = await runPaidCreditOperation({
      buildOutput: (result) => ({
        finalize: result.didIngest,
        ledgerMetadata: {
          job_ingestion_id: result.job.id,
          output_ids: { jobId: result.job.id },
        },
        outputIds: { jobId: result.job.id },
        recordMetadata: {
          job_url: result.job.jobUrl,
          source_type: parsed.data.sourceType,
        },
        resourceId: result.job.id,
      }),
      buildReusedResult: async (output) => {
        const jobId = typeof output.output_ids.jobId === "string" ? output.output_ids.jobId : null;
        const job = jobId
          ? await getJobIngestionById({
              jobId,
              userId: session.user.id,
            })
          : null;

        if (!job) {
          throw new Error("JOB_READ_FAILED");
        }

        return job;
      },
      feature: "jobIngest",
      metadata: {
        job_url: parsed.data.jobUrl ?? null,
        source_type: parsed.data.sourceType,
      },
      operationFingerprint: buildOperationFingerprint({
        basis: {
          jobText: parsed.data.jobText ?? null,
          jobUrl: parsed.data.jobUrl ?? null,
          sourceType: parsed.data.sourceType,
        },
        feature: "jobIngest",
        operationKey,
        resourceId: null,
        resourceType: "job_ingestion",
        userId: session.user.id,
      }),
      operationKey,
      resourceId: null,
      resourceType: "job_ingestion",
      run: () => ingestJobUrl(parsed.data),
    });

    return apiSuccess({
      requestId,
      ...paidOperation.result,
      reused: paidOperation.reused || !paidOperation.result.didIngest,
    });
  } catch (error) {
    if (isCreditOperationError(error)) {
      const billingError = buildCreditsApiError(error);

      return apiError(requestId, billingError);
    }

    return apiError(requestId, toApiError(error));
  }
}

function toApiError(error: unknown) {
  const authError = apiAuthErrorDetails(error, "Please sign in before ingesting a job post.");
  if (authError) return authError;

  if (error instanceof Error) {
    if (error.message === "JOB_URL_BLOCKED") {
      return {
        category: "validation",
        code: "job.url_blocked",
        message: "That URL is not allowed for job ingestion.",
        status: 400,
      };
    }

    if (error.message === "JOB_PAGE_TOO_LARGE") {
      return {
        category: "validation",
        code: "job.page_too_large",
        message: "That job page is too large to ingest right now.",
        status: 413,
      };
    }

    if (error.message === "JOB_UNSUPPORTED_CONTENT_TYPE") {
      return {
        category: "validation",
        code: "job.unsupported_content_type",
        message: "That link did not return enough job-post detail.",
        status: 422,
      };
    }

    if (error.message === "JOB_POSTING_UNAVAILABLE") {
      return {
        category: "validation",
        code: "job.posting_unavailable",
        message:
          "That job post now opens a company board or unavailable-posting page. Paste the job description text instead.",
        status: 422,
      };
    }

    if (error.message === "JOB_TEXT_TOO_SHORT") {
      return {
        category: "validation",
        code: "job.text_too_short",
        message: "I could not find enough job-post text on that page.",
        status: 422,
      };
    }
  }

  return {
    category: "server",
    code: "job.ingestion_failed",
    message: "Unable to ingest that job post right now.",
    status: 500,
  };
}
