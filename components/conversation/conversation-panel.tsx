"use client";

import { useState } from "react";
import { Loader2, SendHorizontal, Sparkles } from "lucide-react";

type ConversationPanelProps = {
  userEmail: string | null;
};

export function ConversationPanel({ userEmail }: ConversationPanelProps) {
  const [message, setMessage] = useState("");
  const [assistantMessages, setAssistantMessages] = useState<string[]>([
    `Hi${userEmail ? `, ${userEmail.split("@")[0]}` : ""}. We'll build this carefully: first your profile, then fit analysis, then tailored application materials only when you approve the direction.`,
  ]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      return;
    }

    setMessage("");
    setStatus(null);
    setError(null);
    setIsSubmitting(true);

    const response = await fetch("/api/profile/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: trimmedMessage }),
    });
    const payload = await response.json();

    setIsSubmitting(false);

    if (!response.ok) {
      setError(payload.error ?? "Something went wrong.");
      return;
    }

    setAssistantMessages((current) => [
      ...current,
      payload.assistantMessage,
      ...(payload.followUpQuestions ?? []),
    ]);
    setStatus(`Saved ${payload.savedFactCount} profile detail${payload.savedFactCount === 1 ? "" : "s"}.`);
  }

  return (
    <aside className="conversation-pane" aria-labelledby="conversation-title">
      <div className="conversation-header">
        <div>
          <p className="eyebrow">AI guide</p>
          <h2 id="conversation-title">Warm, candid, useful.</h2>
        </div>
        <Sparkles size={20} aria-hidden="true" />
      </div>

      <div className="message-list">
        {assistantMessages.map((item, index) => (
          <div className="assistant-message" key={`${item}-${index}`}>
            <strong>ResumAI</strong>
            <p>{item}</p>
          </div>
        ))}
        <div className="system-note">
          Conversational input and direct editor changes will share one command
          layer, so the app avoids duplicate logic.
        </div>
        {status ? <div className="system-note success">{status}</div> : null}
        {error ? <div className="system-note error">{error}</div> : null}
      </div>

      <form className="chat-input" aria-label="Conversation input" onSubmit={handleSubmit}>
        <input
          disabled={isSubmitting}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Tell me about your experience, strengths, credentials, or goals."
          type="text"
          value={message}
        />
        <button disabled={isSubmitting || message.trim().length < 3} type="submit" aria-label="Send message">
          {isSubmitting ? (
            <Loader2 className="spin" size={18} aria-hidden="true" />
          ) : (
            <SendHorizontal size={18} aria-hidden="true" />
          )}
        </button>
      </form>
    </aside>
  );
}
