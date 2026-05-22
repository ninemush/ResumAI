import { NextResponse } from "next/server";

import {
  conversationMessageCreateSchema,
  createConversationMessage,
} from "@/lib/conversation/conversation-messages";

export async function POST(request: Request) {
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
