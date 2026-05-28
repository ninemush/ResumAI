import { NextResponse } from "next/server";

import {
  profileIntakeRequestSchema,
  runProfileIntake,
} from "@/lib/profile/profile-intake";

export async function POST(request: Request) {
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

  try {
    const result = await runProfileIntake(parsed.data);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") {
      return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
    }

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
