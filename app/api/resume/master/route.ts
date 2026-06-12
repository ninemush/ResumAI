import { createHash } from "node:crypto";

import { apiAuthErrorDetails, requireProtectedApiSession } from "@/lib/api/auth";
import { apiError, apiSuccess, createRequestId, readJsonBody, readOptionalJsonBody } from "@/lib/api/responses";
import {
  buildCreditsApiError,
  finalizeCreditReservation,
  getFinalizedCreditOperationOutput,
  getCreditOperationKey,
  recordCreditOperationOutput,
  requireCredits,
  releaseCreditReservation,
  reserveCredits,
} from "@/lib/billing/credits";
import {
  generateMasterResume,
  generateMasterResumeSchema,
  getMasterResumeOverview,
  updateMasterResume,
  updateMasterResumeSchema,
} from "@/lib/resumes/master-resume";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const body = await readOptionalJsonBody(request);
  const parsed = generateMasterResumeSchema.safeParse(body);

  if (!parsed.success) {
    return apiError(requestId, {
      category: "validation",
      code: "resume.invalid_instruction",
      message: "Use a short resume instruction before regenerating.",
      status: 400,
    });
  }

  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "master_resume_generate"),
    limit: 8,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Resume generation is being requested too quickly. Pause briefly before regenerating.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    const session = await requireProtectedApiSession();
    await requireCredits("masterResumeGenerate");
    const operationKey = getCreditOperationKey(request, buildMasterResumeOperationKey({
      instruction: parsed.data.instruction,
      userId: session.user.id,
    }));
    const finalizedOutput = await getFinalizedCreditOperationOutput({
      feature: "masterResumeGenerate",
      operationKey,
    });

    if (finalizedOutput) {
      return apiSuccess({
        requestId,
        overview: await getMasterResumeOverview(session.user.id),
        resumeId: readStringOutput(finalizedOutput.output_ids.resumeId),
        reused: true,
        summary: "Returned the existing master resume draft for this retry-safe operation.",
      });
    }

    const reservation = await reserveCredits({
      feature: "masterResumeGenerate",
      metadata: { instruction: parsed.data.instruction ?? null },
      operationKey,
      resourceId: null,
      resourceType: "master_resume",
    });
    let result: Awaited<ReturnType<typeof generateMasterResume>>;

    try {
      result = await generateMasterResume(parsed.data);
    } catch (error) {
      await releaseCreditReservation({
        reason: error instanceof Error ? error.message : "MASTER_RESUME_GENERATION_FAILED",
        reservationId: reservation.reservationId,
      }).catch(() => undefined);
      throw error;
    }

    const finalizedReservation = await finalizeCreditReservation({
      metadata: { resume_id: result.resumeId },
      reservationId: reservation.reservationId,
      resourceId: result.resumeId,
    });
    await recordCreditOperationOutput({
      feature: "masterResumeGenerate",
      ledgerEventId: finalizedReservation.ledgerEventId,
      metadata: { instruction: parsed.data.instruction ?? null },
      operationKey,
      outputIds: { resumeId: result.resumeId },
      reservationId: reservation.reservationId,
      resourceId: result.resumeId,
      resourceType: "master_resume",
    });

    return apiSuccess({
      requestId,
      ...result,
    });
  } catch (error) {
    if (isBillingError(error)) {
      const billingError = buildCreditsApiError(error);

      return apiError(requestId, billingError);
    }

    return apiError(requestId, toApiError(error));
  }
}

export async function PATCH(request: Request) {
  const requestId = createRequestId();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "master_resume_update"),
    limit: 60,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Resume edits are being saved too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }
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

  const parsed = updateMasterResumeSchema.safeParse(body);

  if (!parsed.success) {
    return apiError(requestId, {
      category: "validation",
      code: "resume.invalid_input",
      message: "Use valid resume sections before saving.",
      status: 400,
    });
  }

  try {
    await requireProtectedApiSession();
    const overview = await updateMasterResume(parsed.data);

    return apiSuccess({
      requestId,
      overview,
    });
  } catch (error) {
    return apiError(requestId, toApiError(error));
  }
}

function toApiError(error: unknown) {
  const authError = apiAuthErrorDetails(error, "Please sign in before working on your resume.");
  if (authError) return authError;

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

  if (error instanceof Error && error.message === "PROFILE_NOT_FOUND") {
    return {
      category: "not_found",
      code: "profile.not_found",
      message: "Build your profile before saving master resume edits.",
      status: 404,
    };
  }

  if (error instanceof Error && error.message === "MASTER_RESUME_READ_FAILED") {
    return {
      category: "server",
      code: "resume.read_failed",
      message: "Unable to read the latest master resume right now.",
      status: 500,
    };
  }

  if (error instanceof Error && error.message === "MASTER_RESUME_UPDATE_FAILED") {
    return {
      category: "server",
      code: "resume.update_failed",
      message: "Unable to save the master resume edits right now.",
      status: 500,
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

function buildMasterResumeOperationKey({
  instruction,
  userId,
}: {
  instruction?: string;
  userId: string;
}) {
  const inputHash = createHash("sha256")
    .update([userId, instruction?.trim() || "default"].join(":"))
    .digest("hex")
    .slice(0, 24);

  return `masterResumeGenerate:${userId}:${inputHash}`;
}

function readStringOutput(value: unknown) {
  return typeof value === "string" ? value : null;
}
