import { NextResponse } from "next/server";

import { apiAuthErrorResponse, requireProtectedApiSession } from "@/lib/api/auth";
import {
  profileIntakeRequestSchema,
  runProfileIntake,
} from "@/lib/profile/profile-intake";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = profileIntakeRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Message must be between 3 and 4000 characters." },
      { status: 400 },
    );
  }

  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "profile_intake"),
    limit: 20,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Profile updates are coming in too quickly. Pause for a moment before adding more.",
      requestId,
      result: rateLimit,
    });
  }

  try {
    await requireProtectedApiSession();
    const result = await runProfileIntake(parsed.data);

    return NextResponse.json(result);
  } catch (error) {
    const authResponse = apiAuthErrorResponse({
      error,
      fallbackMessage: "Sign in is required.",
      requestId,
    });
    if (authResponse) return authResponse;

    console.warn(
      JSON.stringify({
        event: "profile_intake_route_failed",
        code: error instanceof Error ? error.message : "UNKNOWN_PROFILE_INTAKE_ERROR",
      }),
    );

    return NextResponse.json(
      {
        error:
          "I could not save that to your profile cleanly yet. The note is still useful: try sending it as a shorter role, achievement, metric, or target-role statement and I will attach it to the right part of your profile.",
      },
      { status: 500 },
    );
  }
}
