import { apiError, apiSuccess, createRequestId } from "@/lib/api/responses";
import { getCareerProfileOverview } from "@/lib/profile/career-profile-overview";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const requestId = createRequestId();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return apiError(requestId, {
      category: "auth",
      code: "auth.required",
      message: "Please sign in before reading your career profile.",
      status: 401,
    });
  }

  try {
    const overview = await getCareerProfileOverview(user.id);

    return apiSuccess({
      overview,
      requestId,
    });
  } catch {
    return apiError(requestId, {
      category: "server",
      code: "career_profile.read_failed",
      message: "Unable to read the career profile right now.",
      status: 500,
    });
  }
}
