import { NextResponse } from "next/server";

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
  const rateLimit = checkRateLimit({
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
    await createConversationMessage(parsed.data);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") {
      return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
    }

    return NextResponse.json(
      { error: "Conversation memory is unavailable right now." },
      { status: 500 },
    );
  }
}
