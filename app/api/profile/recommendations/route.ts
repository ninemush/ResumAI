import { apiAuthErrorDetails, requireProtectedApiSession } from "@/lib/api/auth";
import { apiError, apiSuccess, createRequestId } from "@/lib/api/responses";
import { getProfileOverview } from "@/lib/profile/profile-overview";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "profile_recommendations"),
    limit: 30,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Profile recommendations are being refreshed too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    const session = await requireProtectedApiSession();
    const overview = await getProfileOverview(session.user.id);
    const recommendations = overview.roleRecommendations.map((recommendation) => ({
      id: recommendation.id,
      acknowledgementRequired: !recommendation.user_acknowledged,
      assumptions: recommendation.assumptions,
      confidence: recommendation.confidence,
      openQuestions: recommendation.open_questions,
      rationale: recommendation.rationale,
      roleFamily: recommendation.role_family,
      roleTitles: recommendation.role_titles,
      seniorityLevel: recommendation.seniority_level,
      userAcknowledged: recommendation.user_acknowledged,
    }));

    return apiSuccess({
      acknowledgementRequirement: {
        required: recommendations.some((recommendation) => recommendation.acknowledgementRequired),
        route: "/api/profile/role-recommendations/:id/acknowledge",
        summary:
          "Acknowledge or adjust the target direction before using it for final resume generation.",
      },
      evidenceBasis: {
        confirmedFactCount: overview.confirmedFactCount,
        evidenceStrength: overview.intelligence.evidenceStrength,
        highValueGaps: overview.intelligence.highValueGaps,
        profileStatus: overview.profile?.status ?? "draft",
        proofThemes: overview.intelligence.proofThemes,
        readinessScore: overview.readinessScore,
        roleTargetRead: overview.intelligence.roleTargetRead,
        seniorityRead: overview.intelligence.seniorityRead,
        sourceCount: overview.sourceCount,
      },
      openQuestions: Array.from(
        new Set([
          ...recommendations.flatMap((recommendation) => recommendation.openQuestions),
          ...overview.intelligence.highValueGaps.map((gap) => gap.prompt),
        ]),
      ).slice(0, 8),
      recommendations,
      requestId,
    });
  } catch (error) {
    return apiError(requestId, toApiError(error));
  }
}

function toApiError(error: unknown) {
  const authError = apiAuthErrorDetails(error, "Please sign in before refreshing profile recommendations.");
  if (authError) return authError;

  return {
    category: "server",
    code: "profile.recommendations_failed",
    message: "Unable to refresh profile recommendations right now.",
    status: 500,
  };
}
