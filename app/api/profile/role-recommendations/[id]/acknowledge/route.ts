import { NextResponse } from "next/server";

import { apiAuthErrorDetails, requireProtectedApiSession } from "@/lib/api/auth";
import {
  acknowledgeRoleRecommendation,
  acknowledgeRoleRecommendationSchema,
} from "@/lib/profile/profile-commands";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "role_recommendation_acknowledge"),
    limit: 120,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Role direction updates are being submitted too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }
  const params = await context.params;
  const parsed = acknowledgeRoleRecommendationSchema.safeParse({
    recommendationId: params.id,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "role_recommendation.invalid_id",
          message: "Choose a valid role recommendation.",
        },
      },
      { status: 400 },
    );
  }

  try {
    await requireProtectedApiSession();
    const recommendation = await acknowledgeRoleRecommendation(parsed.data);

    return NextResponse.json({
      ok: true,
      requestId,
      recommendation,
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
  const authError = apiAuthErrorDetails(error, "Please sign in before acknowledging role direction.");
  if (authError) return authError;

  if (error instanceof Error && error.message === "ROLE_RECOMMENDATION_NOT_FOUND") {
    return {
      category: "not_found",
      code: "role_recommendation.not_found",
      message: "That role recommendation could not be found.",
      status: 404,
    };
  }

  return {
    category: "server",
    code: "role_recommendation.acknowledge_failed",
    message: "Unable to acknowledge that direction right now.",
    status: 500,
  };
}
