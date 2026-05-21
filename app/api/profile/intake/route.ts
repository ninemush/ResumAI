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

    return NextResponse.json(
      { error: "Profile intake is unavailable right now. Please try again." },
      { status: 500 },
    );
  }
}
