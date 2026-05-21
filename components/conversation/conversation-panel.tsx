import { SendHorizontal, Sparkles } from "lucide-react";

type ConversationPanelProps = {
  userEmail: string | null;
};

export function ConversationPanel({ userEmail }: ConversationPanelProps) {
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
        <div className="assistant-message">
          <strong>ResumAI</strong>
          <p>
            Hi{userEmail ? `, ${userEmail.split("@")[0]}` : ""}. We&apos;ll build
            this carefully: first your profile, then fit analysis, then tailored
            application materials only when you approve the direction.
          </p>
        </div>
        <div className="system-note">
          Conversational input and direct editor changes will share one command
          layer, so the app avoids duplicate logic.
        </div>
      </div>

      <form className="chat-input" aria-label="Conversation input">
        <input
          disabled
          placeholder="Conversation intake comes after this auth shell."
          type="text"
        />
        <button disabled type="button" aria-label="Send message">
          <SendHorizontal size={18} aria-hidden="true" />
        </button>
      </form>
    </aside>
  );
}
