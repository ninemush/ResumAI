import { apiAuthErrorDetails, requireProtectedApiSession } from "@/lib/api/auth";
import { apiError, apiSuccess, createRequestId } from "@/lib/api/responses";
import { mergeCareerProfile } from "@/lib/profile/career-profile-merge";
import { getCareerProfileOverview } from "@/lib/profile/career-profile-overview";
import { analyzeProfileSource } from "@/lib/profile/profile-source-analysis";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "career_profile_rebuild"),
    limit: 6,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Career profile rebuilds are being requested too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  const supabase = await createClient();

  try {
    const session = await requireProtectedApiSession();
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .upsert({ user_id: session.user.id }, { onConflict: "user_id" })
      .select("id")
      .single();

    if (profileError || !profile) {
      throw new Error("PROFILE_UPSERT_FAILED");
    }

    const { data: sources, error: sourceError } = await supabase
      .from("profile_sources")
      .select("id, source_type, source_url, original_filename, extracted_text")
      .eq("profile_id", profile.id)
      .eq("user_id", session.user.id)
      .not("extracted_text", "is", null)
      .neq("extraction_status", "deleted")
      .order("updated_at", { ascending: false })
      .limit(30);

    if (sourceError) {
      throw new Error("PROFILE_SOURCES_READ_FAILED");
    }

    let lastSourceAnalysisId: string | null = null;

    for (const source of sources ?? []) {
      const text = source.extracted_text?.trim();

      if (!text) {
        continue;
      }

      const result = await analyzeProfileSource({
        label: source.original_filename ?? source.source_url ?? source.source_type,
        profileId: profile.id,
        sourceId: source.id,
        sourceType: source.source_type,
        text,
        userId: session.user.id,
      });
      lastSourceAnalysisId = result.analysisId;
    }

    const mergeResult = await mergeCareerProfile({
      lastSourceAnalysisId,
      profileId: profile.id,
      userId: session.user.id,
    });
    const overview = await getCareerProfileOverview(session.user.id);

    return apiSuccess({
      careerProfile: mergeResult,
      overview,
      requestId,
    });
  } catch (error) {
    return apiError(requestId, toApiError(error));
  }
}

function toApiError(error: unknown) {
  const authError = apiAuthErrorDetails(error, "Please sign in before rebuilding your career profile.");
  if (authError) return authError;

  return {
    category: "server",
    code: "career_profile.rebuild_failed",
    message: "Unable to rebuild the career profile right now.",
    status: 500,
  };
}
