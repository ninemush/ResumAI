import { NextResponse } from "next/server";

import { apiAuthErrorResponse, requireProtectedApiSession } from "@/lib/api/auth";
import {
  conversationAdvisorRequestSchema,
  runConversationAdvisor,
} from "@/lib/conversation/advisor";
import { brand } from "@/lib/brand";
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

  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "conversation_advisor"),
    limit: 30,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: `${brand.name} is receiving messages too quickly. Pause for a moment and send the next note.`,
      requestId,
      result: rateLimit,
    });
  }

  try {
    await requireProtectedApiSession();
    const result = await runConversationAdvisor(parsed.data);

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const authResponse = apiAuthErrorResponse({
      error,
      fallbackMessage: `Please sign in before asking ${brand.name} to review your profile.`,
      requestId,
    });
    if (authResponse) return authResponse;

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
            "I hit a workspace reading issue on my side. Your profile, library, jobs, applications, and generated files are still intact, and I have enough context logged for review without asking you to repeat yourself.",
        },
      },
      { status: 500 },
    );
  }
}
