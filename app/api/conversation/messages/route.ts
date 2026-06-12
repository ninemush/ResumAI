import { NextResponse } from "next/server";

import { apiAuthErrorResponse, requireProtectedApiSession } from "@/lib/api/auth";
import {
  conversationMessageCreateSchema,
  createConversationMessage,
} from "@/lib/conversation/conversation-messages";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "conversation_message_create"),
    limit: 120,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Conversation updates are being saved too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = conversationMessageCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Conversation message must include speaker and text." },
      { status: 400 },
    );
  }

  try {
    await requireProtectedApiSession();
    await createConversationMessage(parsed.data);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const authResponse = apiAuthErrorResponse({
      error,
      fallbackMessage: "Sign in is required.",
      requestId,
    });
    if (authResponse) return authResponse;

    return NextResponse.json(
      { error: "Conversation memory is unavailable right now." },
      { status: 500 },
    );
  }
}
