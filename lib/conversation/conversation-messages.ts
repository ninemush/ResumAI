import "server-only";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export const conversationSpeakerSchema = z.enum(["assistant", "user", "system"]);

export const conversationMessageCreateSchema = z.object({
  speaker: conversationSpeakerSchema,
  text: z.string().trim().min(1).max(4000),
});

export type ConversationMessage = {
  id: string;
  speaker: z.infer<typeof conversationSpeakerSchema>;
  text: string;
  createdAt: string;
};

export async function getConversationMessages(userId: string): Promise<ConversationMessage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversation_messages")
    .select("id, speaker, message_text, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) {
    throw new Error("CONVERSATION_MESSAGES_READ_FAILED");
  }

  return (data ?? [])
    .reverse()
    .map((message) => ({
      id: message.id,
      speaker: message.speaker,
      text: message.message_text,
      createdAt: message.created_at,
    }));
}

export async function createConversationMessage({
  speaker,
  text,
}: z.infer<typeof conversationMessageCreateSchema>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { error } = await supabase.from("conversation_messages").insert({
    user_id: user.id,
    speaker,
    message_text: text,
  });

  if (error) {
    throw new Error("CONVERSATION_MESSAGE_INSERT_FAILED");
  }
}
