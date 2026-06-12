import { apiAuthErrorDetails, requireProtectedApiSession } from "@/lib/api/auth";
import { apiError, apiSuccess, createRequestId } from "@/lib/api/responses";
import { getCareerProfileOverview } from "@/lib/profile/career-profile-overview";

export async function GET() {
  const requestId = createRequestId();

  try {
    const session = await requireProtectedApiSession();
    const overview = await getCareerProfileOverview(session.user.id);

    return apiSuccess({
      overview,
      requestId,
    });
  } catch (error) {
    const authError = apiAuthErrorDetails(
      error,
      "Please sign in before reading your career profile.",
    );
    if (authError) return apiError(requestId, authError);

    return apiError(requestId, {
      category: "server",
      code: "career_profile.read_failed",
      message: "Unable to read the career profile right now.",
      status: 500,
    });
  }
}
