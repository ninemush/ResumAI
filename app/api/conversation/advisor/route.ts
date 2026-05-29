import { NextResponse } from "next/server";

import {
  conversationAdvisorRequestSchema,
  runConversationAdvisor,
} from "@/lib/conversation/advisor";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { message: "Invalid JSON body." } },
      { status: 400 },
    );
  }

  const parsed = conversationAdvisorRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Use a short career, resume, profile, or application question." } },
      { status: 400 },
    );
  }

  try {
    const result = await runConversationAdvisor(parsed.data);

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") {
      return NextResponse.json(
        { error: { message: "Please sign in before asking Pramania to review your profile." } },
        { status: 401 },
      );
    }

    console.warn(
      JSON.stringify({
        event: "conversation_advisor_failed",
        code: error instanceof Error ? error.message : "UNKNOWN_CONVERSATION_ADVISOR_ERROR",
      }),
    );

    return NextResponse.json(
      {
        error: {
          message:
            "I hit a processing issue while reading the saved workspace context. I still have your profile, sources, jobs, applications, and artifacts on record; try the question again in a moment and I will use what is already saved rather than asking you to repeat it.",
        },
      },
      { status: 500 },
    );
  }
}
