"use client";

import { useRef, useState } from "react";
import { Paperclip, Loader2, SendHorizontal, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { brand } from "@/lib/brand";
import { createClient } from "@/lib/supabase/browser";

type ConversationPanelProps = {
  userEmail: string | null;
  userId: string;
};

type ConversationMessage = {
  speaker: "assistant" | "user";
  text: string;
};

type SourceCreateResponse = {
  ok: boolean;
  source?: {
    id: string;
    extractionStatus: string;
    sourceType: string;
  };
  error?: {
    message?: string;
  };
};

const PROFILE_SOURCE_BUCKET = "profile-sources";
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const acceptedFileTypes = new Map<string, "pdf" | "docx" | "txt" | "image">([
  ["application/pdf", "pdf"],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "docx",
  ],
  ["application/msword", "docx"],
  ["text/plain", "txt"],
  ["image/jpeg", "image"],
  ["image/png", "image"],
  ["image/webp", "image"],
  ["image/heic", "image"],
  ["image/heif", "image"],
]);

export function ConversationPanel({ userEmail, userId }: ConversationPanelProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([
    {
      speaker: "assistant",
      text: `Hi${userEmail ? `, ${userEmail.split("@")[0]}` : ""}. Tell me about your background, paste a role, or drop a resume here. I will keep this focused on your career profile and applications.`,
    },
  ]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);

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
    appendUserMessage(trimmedMessage);

    try {
      await processMessage(trimmedMessage);
    } catch {
      setError("I could not process that yet. Try a shorter note, a public job link, or a resume file.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function processMessage(text: string) {
    const urls = extractUrls(text);
    const textWithoutUrls = removeUrls(text, urls).trim();
    const summaries: string[] = [];

    for (const url of urls) {
      summaries.push(await processUrl(url, text));
    }

    if (textWithoutUrls.length >= 3) {
      summaries.push(await processProfileText(textWithoutUrls));
    }

    if (summaries.length > 0) {
      appendAssistantMessage(summaries.join(" "));
      router.refresh();
    }
  }

  async function processProfileText(text: string) {
    const response = await fetch("/api/profile/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error ?? "PROFILE_INTAKE_FAILED");
    }

    if (payload.followUpQuestions?.length) {
      appendAssistantMessage(payload.followUpQuestions.join(" "));
    }

    setStatus(
      payload.inScope === false
        ? "No profile details saved. I kept the conversation focused on the app's purpose."
        : `Saved ${payload.savedFactCount} profile detail${payload.savedFactCount === 1 ? "" : "s"}.`,
    );

    return payload.assistantMessage as string;
  }

  async function processUrl(url: string, fullMessage: string) {
    if (looksLikeJobUrl(url, fullMessage)) {
      const response = await fetch("/api/jobs/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobUrl: url }),
      });
      const payload = await response.json();

      if (!response.ok) {
        return payload.error?.message ?? "I could not read that job link yet.";
      }

      return `I saved that job post${payload.job?.title ? `: ${payload.job.title}` : ""}.`;
    }

    const sourceType = inferLinkSourceType(url);
    const response = await fetch("/api/profile/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceType,
        sourceUrl: url,
      }),
    });
    const payload = await response.json();

    if (!response.ok) {
      return payload.error?.message ?? "I could not save that profile link yet.";
    }

    return sourceType === "linkedin"
      ? "I saved that LinkedIn profile link. Authenticated import will come through a separate consent step."
      : "I saved that profile link.";
  }

  async function handleFiles(files: FileList | File[]) {
    const fileList = Array.from(files);

    if (fileList.length === 0) {
      return;
    }

    setError(null);
    setStatus(null);
    setIsSubmitting(true);
    appendUserMessage(
      fileList.length === 1
        ? `Dropped ${fileList[0].name}`
        : `Dropped ${fileList.length} files`,
    );

    const summaries: string[] = [];

    for (const file of fileList) {
      summaries.push(await processFile(file));
    }

    appendAssistantMessage(summaries.join(" "));
    setIsSubmitting(false);
    router.refresh();
  }

  async function processFile(file: File) {
    const sourceType = inferFileSourceType(file);

    if (!sourceType) {
      return `${file.name} is not a supported profile source yet.`;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `${file.name} is larger than the current 25 MB upload limit.`;
    }

    const supabase = createClient();
    const storagePath = `${userId}/${crypto.randomUUID()}/${sanitizeFilename(file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from(PROFILE_SOURCE_BUCKET)
      .upload(storagePath, file, {
        cacheControl: "3600",
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      return `I could not upload ${file.name}: ${uploadError.message}`;
    }

    const source = await createProfileSource({
      file,
      sourceType,
      storagePath,
    });

    if (!source.ok || !source.source?.id) {
      return source.error?.message ?? `I could not save ${file.name}.`;
    }

    if (["txt", "pdf", "docx"].includes(sourceType)) {
      const extraction = await extractSource(source.source.id);

      if (!extraction.ok) {
        return `${file.name} was saved, but extraction needs attention: ${extraction.message}`;
      }

      return `${file.name} was saved and ${extraction.savedFactCount} profile detail${extraction.savedFactCount === 1 ? "" : "s"} were captured.`;
    }

    return `${file.name} was saved. Image OCR is next, so I have kept it as a source for now.`;
  }

  async function createProfileSource({
    file,
    sourceType,
    storagePath,
  }: {
    file: File;
    sourceType: string;
    storagePath: string;
  }) {
    const response = await fetch("/api/profile/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceType,
        storagePath,
        originalFilename: file.name,
        mimeType: file.type || "application/octet-stream",
      }),
    });

    return (await response.json()) as SourceCreateResponse;
  }

  async function extractSource(sourceId: string) {
    const response = await fetch(`/api/profile/sources/${sourceId}/extract`, {
      method: "POST",
    });
    const payload = await response.json();

    if (!response.ok) {
      return {
        ok: false,
        message: payload.error?.message ?? "Unable to extract that source.",
        savedFactCount: 0,
      };
    }

    return {
      ok: true,
      message: "Extracted.",
      savedFactCount: payload.intake?.savedFactCount ?? 0,
    };
  }

  function appendAssistantMessage(text: string) {
    setMessages((current) => [...current, { speaker: "assistant", text }]);
  }

  function appendUserMessage(text: string) {
    setMessages((current) => [...current, { speaker: "user", text }]);
  }

  return (
    <aside
      className={isDragActive ? "conversation-pane drag-active" : "conversation-pane"}
      aria-labelledby="conversation-title"
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragActive(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragActive(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) {
          setIsDragActive(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragActive(false);
        handleFiles(event.dataTransfer.files);
      }}
    >
      <div className="conversation-header">
        <div>
          <p className="eyebrow">AI agent</p>
          <h2 id="conversation-title">Start here.</h2>
        </div>
        <Sparkles size={20} aria-hidden="true" />
      </div>

      <div className="message-list">
        {messages.map((item, index) => (
          <div
            className={item.speaker === "user" ? "user-message" : "assistant-message"}
            key={`${item.text}-${index}`}
          >
            <strong>{item.speaker === "user" ? "You" : brand.name}</strong>
            <p>{item.text}</p>
          </div>
        ))}
        {isDragActive ? <div className="drop-hint">Drop it here.</div> : null}
        {status ? <div className="system-note success">{status}</div> : null}
        {error ? <div className="system-note error">{error}</div> : null}
      </div>

      <form className="chat-input" aria-label="Conversation input" onSubmit={handleSubmit}>
        <button
          aria-label="Attach file"
          className="attach-button"
          disabled={isSubmitting}
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          <Paperclip size={18} aria-hidden="true" />
        </button>
        <input
          disabled={isSubmitting}
          onChange={(event) => setMessage(event.target.value)}
          onPaste={(event) => {
            const files = event.clipboardData.files;

            if (files.length > 0) {
              event.preventDefault();
              handleFiles(files);
            }
          }}
          placeholder="Tell me, paste a job link, or drop a resume..."
          type="text"
          value={message}
        />
        <input
          ref={fileInputRef}
          accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.webp,.heic,.heif"
          className="sr-only"
          disabled={isSubmitting}
          onChange={(event) => {
            if (event.target.files) {
              handleFiles(event.target.files);
            }
            event.currentTarget.value = "";
          }}
          type="file"
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

function extractUrls(value: string) {
  return Array.from(value.matchAll(/https?:\/\/[^\s]+/gi), (match) =>
    match[0].replace(/[),.]+$/g, ""),
  );
}

function removeUrls(value: string, urls: string[]) {
  return urls.reduce((remaining, url) => remaining.replace(url, ""), value);
}

function inferFileSourceType(file: File) {
  const mimeType = file.type.toLowerCase();
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (acceptedFileTypes.has(mimeType)) {
    return acceptedFileTypes.get(mimeType);
  }

  if (extension === "pdf") return "pdf";
  if (extension === "doc" || extension === "docx") return "docx";
  if (extension === "txt") return "txt";
  if (["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(extension ?? "")) {
    return "image";
  }

  return null;
}

function inferLinkSourceType(value: string) {
  const hostname = new URL(value).hostname.replace(/^www\./, "");

  if (hostname.endsWith("linkedin.com")) {
    return "linkedin";
  }

  return "portfolio";
}

function looksLikeJobUrl(url: string, message: string) {
  const normalizedMessage = message.toLowerCase();
  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname.toLowerCase();
  const path = parsedUrl.pathname.toLowerCase();

  if (normalizedMessage.includes("job") || normalizedMessage.includes("role")) {
    return true;
  }

  return [
    "ashbyhq.com",
    "greenhouse.io",
    "lever.co",
    "myworkdayjobs.com",
    "smartrecruiters.com",
    "workable.com",
  ].some((domain) => hostname.endsWith(domain)) ||
    ["career", "careers", "job", "jobs", "opening", "position", "requisition"].some(
      (part) => path.includes(part),
    );
}

function sanitizeFilename(filename: string) {
  const cleaned = filename
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);

  return cleaned || "profile-source";
}
