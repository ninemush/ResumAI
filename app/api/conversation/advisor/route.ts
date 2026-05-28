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
            "I could not complete the deeper advisor read right now. Share the resume, role, or profile point again and I will keep it grounded in your career context.",
        },
      },
      { status: 500 },
    );
  }
}
