"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Paperclip, SendHorizontal, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { brand } from "@/lib/brand";
import type { ApplicationOverview } from "@/lib/applications/application-overview";
import type { JobOverview } from "@/lib/jobs/job-overview";
import type { ProfileOverview } from "@/lib/profile/profile-overview";
import { createClient } from "@/lib/supabase/browser";

type ConversationPanelProps = {
  applicationOverview: ApplicationOverview;
  initialMessages: ConversationMessage[];
  jobOverview: JobOverview;
  profileOverview: ProfileOverview;
  userEmail: string | null;
  userId: string;
};

type ConversationMessage = {
  id?: string;
  speaker: "assistant" | "user" | "system";
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

type SourceExtractionResult =
  | {
      assistantMessage: string | null;
      followUpQuestions: string[];
      message: string;
      ok: true;
      savedFactCount: number;
      suggestedDirection: string | null;
    }
  | {
      assistantMessage?: null;
      followUpQuestions?: [];
      message: string;
      ok: false;
      savedFactCount: 0;
      suggestedDirection?: null;
    };

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{
          0: { transcript: string };
          isFinal: boolean;
        }>;
      }) => void)
    | null;
  start: () => void;
  stop: () => void;
};

type SpeechWindow = Window &
  typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

const PROFILE_SOURCE_BUCKET = "profile-sources";
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const welcomeMessage = (name: string | null) =>
  `Hi${name ? `, ${name}` : ""}. I'm ${brand.name}. Tell me your target role, or drop a resume/link and I will help shape your profile.`;
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

export function ConversationPanel({
  applicationOverview,
  initialMessages,
  jobOverview,
  profileOverview,
  userEmail,
  userId,
}: ConversationPanelProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>(
    buildInitialMessages(initialMessages, readFirstName(profileOverview, userEmail)),
  );
  const sessionPrompt = buildSessionPrompt({
    applicationOverview,
    hasConversationHistory: initialMessages.length > 0,
    jobOverview,
    profileOverview,
    userEmail,
  });
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isListening, setIsListening] = useState(false);

  useEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList) {
      return;
    }

    messageList.scrollTop = messageList.scrollHeight;
  }, [messages, status, error]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

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
    persistConversationMessage("user", trimmedMessage);

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

    if (urls.length === 0) {
      const resumeAction = await processResumeAction(text);

      if (resumeAction) {
        appendAssistantMessage(resumeAction, true);
        router.refresh();
        return;
      }

      const applicationAction = await processApplicationAction(text);

      if (applicationAction) {
        appendAssistantMessage(applicationAction, true);
        router.refresh();
        return;
      }
    }

    for (const url of urls) {
      summaries.push(await processUrl(url, text));
    }

    if (shouldProcessProfileRemainder({ textWithoutUrls, urls })) {
      summaries.push(await processProfileText(textWithoutUrls));
    }

    if (summaries.length > 0) {
      appendAssistantMessage(summaries.join(" "), true);
      router.refresh();
    }
  }

  async function processResumeAction(text: string) {
    if (!looksLikeMasterResumeRequest(text)) {
      return null;
    }

    const response = await fetch("/api/resume/master", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ instruction: text }),
    });
    const payload = await response.json();

    if (!response.ok) {
      return payload.error?.message ?? "I could not generate the master resume yet.";
    }

    return `${payload.summary} I saved it in Resume Studio so you can review the wording, remove anything that does not sound like you, and keep unsupported claims out.`;
  }

  async function processApplicationAction(text: string) {
    if (looksLikeMaterialGenerationRequest(text)) {
      const candidates = applicationOverview.recentApplications.filter((application) =>
        ["draft", "applied", "interview_in_progress"].includes(application.status),
      );
      const matchedCandidates = candidates.filter((application) =>
        applicationMatchesText(application, text),
      );
      const actionableCandidates = matchedCandidates.length > 0 ? matchedCandidates : candidates;

      if (actionableCandidates.length !== 1) {
        return actionableCandidates.length === 0
          ? "I can generate targeted materials once an application is logged from a readable job post."
          : `I can do that, but I need to know which application. Do you mean ${actionableCandidates.map(formatApplicationLabel).join(", ")}?`;
      }

      const application = actionableCandidates[0];
      const response = await fetch(`/api/applications/${application.id}/materials`, {
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        return payload.error?.message ?? "I could not generate those materials yet.";
      }

      return `${payload.summary} I saved them to this application record so we can review and refine them next.`;
    }

    const inferredStatus = inferApplicationStatus(text);

    if (inferredStatus) {
      const candidates = applicationOverview.recentApplications.filter((application) =>
        ["applied", "interview_in_progress", "draft"].includes(application.status),
      );
      const matchedCandidates = candidates.filter((application) =>
        applicationMatchesText(application, text),
      );
      const actionableCandidates = matchedCandidates.length > 0 ? matchedCandidates : candidates;

      if (actionableCandidates.length !== 1) {
        return actionableCandidates.length === 0
          ? null
          : `I can update that, but I need to be precise. Which application should I mark as ${formatApplicationStatus(inferredStatus)}: ${actionableCandidates.map(formatApplicationLabel).join(", ")}?`;
      }

      const application = actionableCandidates[0];
      const response = await fetch(`/api/applications/${application.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "chat", status: inferredStatus }),
      });
      const payload = await response.json();

      if (!response.ok) {
        return payload.error?.message ?? "I could not update that application status yet.";
      }

      return `Updated ${formatApplicationLabel(application)} to ${formatApplicationStatus(inferredStatus)}.`;
    }

    if (!looksLikeApplicationLogRequest(text)) {
      return null;
    }

    const readyJobs = jobOverview.recentJobs.filter(
      (job) => job.ingestion_status === "succeeded",
    );

    if (readyJobs.length !== 1) {
      return readyJobs.length === 0
        ? "I can log an application once we have a successfully ingested job post. Paste the job link first, then tell me to proceed."
        : `I can log it, but I need to know which job. Do you mean ${readyJobs.map((job) => job.title ?? formatJobUrl(job.job_url)).join(", ")}?`;
    }

    const response = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobIngestionId: readyJobs[0].id, status: "draft" }),
    });
    const payload = await response.json();

    if (!response.ok) {
      return payload.error?.message ?? "I could not log that application yet.";
    }

    return payload.created
      ? `Logged ${payload.application?.jobTitle ?? "that role"} at ${payload.application?.companyName ?? "the company"} as an application. Next, we should generate targeted materials before marking it applied.`
      : `That application is already logged. Next, we should review status or generate targeted materials.`;
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

    const savedFactCount = payload.savedFactCount ?? 0;

    setStatus(
      payload.inScope === false || savedFactCount === 0
        ? null
        : `Saved ${savedFactCount} profile detail${savedFactCount === 1 ? "" : "s"}.`,
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

    if (!payload.source?.id) {
      return "I saved that profile link.";
    }

    const extraction = await extractSource(payload.source.id);

    if (!extraction.ok) {
      return sourceType === "linkedin"
        ? `I saved that LinkedIn profile link. I could not read the public page directly yet: ${extraction.message} Authenticated import will come through a separate consent step.`
        : `I saved that profile link, but I could not read it directly yet: ${extraction.message}`;
    }

    return formatSourceIntakeReply({
      assistantMessage: extraction.assistantMessage,
      followUpQuestions: extraction.followUpQuestions,
      label: "I read that profile link",
      savedFactCount: extraction.savedFactCount,
      suggestedDirection: extraction.suggestedDirection,
    });
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
    persistConversationMessage(
      "user",
      fileList.length === 1
        ? `Dropped ${fileList[0].name}`
        : `Dropped ${fileList.length} files`,
    );

    try {
      const summaries: string[] = [];

      for (const file of fileList) {
        summaries.push(await processFile(file));
      }

      appendAssistantMessage(summaries.join(" "), true);
      router.refresh();
    } catch {
      setError("I could not finish reading that file. Try again, or paste the most important text directly.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function toggleVoiceInput() {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      (window as SpeechWindow).SpeechRecognition ??
      (window as SpeechWindow).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError("Voice input is not available in this browser yet. You can still type or paste.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (event) => {
      let transcript = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        if (event.results[index].isFinal) {
          transcript += event.results[index][0].transcript;
        }
      }

      if (!transcript.trim()) {
        return;
      }

      setMessage((currentMessage) => {
        const separator = currentMessage.trim().length > 0 ? " " : "";
        return `${currentMessage}${separator}${transcript}`.trimStart();
      });
    };
    recognition.onerror = () => {
      setError("I could not hear that clearly. Try again or type the message.");
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening(false);
    };
    recognitionRef.current = recognition;
    setError(null);
    setStatus("Listening. I will place the transcript in the box so you can steer it before sending.");
    setIsListening(true);
    recognition.start();
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

    if (["txt", "pdf", "docx", "image"].includes(sourceType)) {
      const extraction = await extractSource(source.source.id);

      if (!extraction.ok) {
        return `${file.name} was saved, but extraction needs attention: ${extraction.message}`;
      }

      return formatSourceIntakeReply({
        assistantMessage: extraction.assistantMessage,
        followUpQuestions: extraction.followUpQuestions,
        label: `${file.name} was saved and read`,
        savedFactCount: extraction.savedFactCount,
        suggestedDirection: extraction.suggestedDirection,
      });
    }

    return `${file.name} was saved as a profile source.`;
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

  async function extractSource(sourceId: string): Promise<SourceExtractionResult> {
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
      assistantMessage: payload.intake?.assistantMessage ?? null,
      followUpQuestions: Array.isArray(payload.intake?.followUpQuestions)
        ? payload.intake.followUpQuestions
        : [],
      ok: true,
      message: "Extracted.",
      savedFactCount: payload.intake?.savedFactCount ?? 0,
      suggestedDirection: payload.intake?.suggestedDirection ?? null,
    };
  }

  function appendAssistantMessage(text: string, persist = false) {
    setMessages((current) => [...current, { speaker: "assistant", text }]);
    if (persist) {
      persistConversationMessage("assistant", text);
    }
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
          <h2 id="conversation-title">Talent advisor</h2>
        </div>
        <Sparkles size={20} aria-hidden="true" />
      </div>

      <div className="message-list" ref={messageListRef}>
        {sessionPrompt ? (
          <div className="session-prompt" aria-label="Suggested next step">
            {sessionPrompt}
          </div>
        ) : null}
        {messages.map((item, index) => (
          <div
            className={item.speaker === "user" ? "user-message" : "assistant-message"}
            key={item.id ?? `${item.text}-${index}`}
          >
            <strong>{item.speaker === "user" ? "You" : brand.name}</strong>
            <p>{item.text}</p>
          </div>
        ))}
        {isSubmitting ? (
          <div className="assistant-message pending-message" aria-live="polite">
            <strong>{brand.name}</strong>
            <p>Reading this with a hiring lens...</p>
          </div>
        ) : null}
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
        <button
          aria-label={isListening ? "Stop voice input" : "Start voice input"}
          className={isListening ? "voice-button active" : "voice-button"}
          disabled={isSubmitting}
          onClick={toggleVoiceInput}
          title={isListening ? "Stop voice input" : "Voice input"}
          type="button"
        >
          <Mic size={18} aria-hidden="true" />
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
          placeholder="Share background, role, link, or resume..."
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

function buildInitialMessages(
  initialMessages: ConversationMessage[],
  firstName: string | null,
) {
  const cleanedMessages = initialMessages.filter(
    (item) =>
      !(
        (item.speaker === "assistant" && isLegacyAssistantSeed(item.text)) ||
        (item.speaker === "user" && isLegacyUserTestMessage(item.text))
      ),
  );

  if (cleanedMessages.length > 0) {
    return cleanedMessages;
  }

  return [
    {
      speaker: "assistant" as const,
      text: welcomeMessage(firstName),
    },
  ];
}

function formatSourceIntakeReply({
  assistantMessage,
  followUpQuestions,
  label,
  savedFactCount,
  suggestedDirection,
}: {
  assistantMessage: string | null;
  followUpQuestions: string[];
  label: string;
  savedFactCount: number;
  suggestedDirection: string | null;
}) {
  const savedSummary =
    savedFactCount > 0
      ? `${label}. I saved ${savedFactCount} profile detail${savedFactCount === 1 ? "" : "s"}.`
      : `${label}. I did not find any new profile details to save yet.`;
  const advisorRead = assistantMessage?.trim();
  const direction = suggestedDirection?.trim()
    ? `Working direction: ${suggestedDirection.trim()}`
    : null;
  const nextQuestion = followUpQuestions.find((question) => question.trim().length > 0);

  return [savedSummary, advisorRead, direction, nextQuestion ? `Next question: ${nextQuestion}` : null]
    .filter(Boolean)
    .join(" ");
}

function buildSessionPrompt({
  applicationOverview,
  hasConversationHistory,
  jobOverview,
  profileOverview,
  userEmail,
}: {
  applicationOverview: ApplicationOverview;
  hasConversationHistory: boolean;
  jobOverview: JobOverview;
  profileOverview: ProfileOverview;
  userEmail: string | null;
}) {
  if (!hasConversationHistory) {
    return null;
  }

  const name = profileOverview.profile?.displayName ?? userEmail?.split("@")[0] ?? null;
  const greeting = `Welcome back${name ? `, ${name}` : ""}.`;
  const applicationPrompt = buildApplicationFollowUpPrompt(applicationOverview);

  if (applicationPrompt) {
    return `${greeting ?? "Good to see you."} ${applicationPrompt}`;
  }

  const profilePrompt = buildProfileGapPrompt(profileOverview);

  if (profilePrompt) {
    return `${greeting ?? "Good to see you."} ${profilePrompt}`;
  }

  const jobPrompt = buildJobPrompt(jobOverview);

  if (jobPrompt) {
    return `${greeting ?? "Good to see you."} ${jobPrompt}`;
  }

  return `${greeting} We can keep building from your last conversation.`;
}

function readFirstName(profileOverview: ProfileOverview, userEmail: string | null) {
  const name = profileOverview.profile?.displayName ?? userEmail?.split("@")[0] ?? null;
  const firstName = name?.trim().split(/\s+/)[0];

  return firstName || null;
}

function buildApplicationFollowUpPrompt(applicationOverview: ApplicationOverview) {
  const followUpApplications = applicationOverview.recentApplications.filter((application) =>
    ["applied", "interview_in_progress"].includes(application.status),
  );

  if (followUpApplications.length === 0) {
    return null;
  }

  const application = followUpApplications[0];
  const roleLabel = [application.jobTitle, application.companyName].filter(Boolean).join(" at ");

  return `You have ${followUpApplications.length} application${followUpApplications.length === 1 ? "" : "s"} that may need a status check. Did you hear back on ${roleLabel}? Reply with the outcome and I will help update the right record once status updates are enabled.`;
}

function buildProfileGapPrompt(profileOverview: ProfileOverview) {
  if (!profileOverview.profile || profileOverview.factCount === 0) {
    return "The highest-value next step is to give me a resume, LinkedIn/portfolio link, or a quick work-history note so I can identify hiring signal and gaps.";
  }

  const missing: string[] = [];

  if (!profileOverview.profile.summary) missing.push("a sharp profile summary");
  if (!profileOverview.profile.targetDirection) missing.push("target role direction");
  if (profileOverview.confirmedFactCount === 0) missing.push("confirmed proof points");

  if (missing.length === 0) {
    return null;
  }

  return `Your profile has ${profileOverview.factCount} captured detail${profileOverview.factCount === 1 ? "" : "s"}, but it is still missing ${formatList(missing)}. Those are high-value screening signals.`;
}

function buildJobPrompt(jobOverview: JobOverview) {
  const highFitJob = jobOverview.recentJobs.find(
    (job) => typeof job.fitSnapshot.score === "number" && job.fitSnapshot.score >= 70,
  );

  if (!highFitJob) {
    return null;
  }

  return `Your recent job post${highFitJob.title ? ` for ${highFitJob.title}` : ""} looks like a stronger match based on the current keyword snapshot. We should review the fit before generating materials.`;
}

function formatList(items: string[]) {
  if (items.length <= 1) {
    return items[0] ?? "";
  }

  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function shouldProcessProfileRemainder({
  textWithoutUrls,
  urls,
}: {
  textWithoutUrls: string;
  urls: string[];
}) {
  if (textWithoutUrls.length < 3) {
    return false;
  }

  if (urls.length === 0) {
    return true;
  }

  const normalized = textWithoutUrls.toLowerCase().replace(/\s+/g, " ").trim();
  const wordCount = normalized.split(" ").filter(Boolean).length;

  if (wordCount <= 12 && looksLikeUrlInstruction(normalized)) {
    return false;
  }

  return true;
}

function looksLikeUrlInstruction(text: string) {
  return [
    "can you",
    "check",
    "could you",
    "here is",
    "i found",
    "i want to apply",
    "look at",
    "please",
    "read",
    "review",
    "save",
    "this is",
    "use",
  ].some((phrase) => text.startsWith(phrase));
}

function inferApplicationStatus(text: string) {
  const normalized = text.toLowerCase();

  if (/\b(interviewed but|interviewed,? not selected|after interview.*rejected)\b/.test(normalized)) {
    return "interviewed_not_selected";
  }

  if (/\b(rejected|declined|not selected|passed on me|turned me down)\b/.test(normalized)) {
    return "rejected";
  }

  if (/\b(no reply|no response|haven't heard|have not heard|ghosted)\b/.test(normalized)) {
    return "no_reply";
  }

  if (/\b(interviewing|interview scheduled|interview in progress|next round)\b/.test(normalized)) {
    return "interview_in_progress";
  }

  if (/\b(offer|selected|got it|hired)\b/.test(normalized)) {
    return "interviewed_selected";
  }

  if (/\b(withdrawn|withdrew|not pursuing)\b/.test(normalized)) {
    return "withdrawn";
  }

  if (/\b(applied|submitted)\b/.test(normalized)) {
    return "applied";
  }

  return null;
}

function looksLikeApplicationLogRequest(text: string) {
  const normalized = text.toLowerCase();

  return (
    /\b(log|track|create)\b.*\bapplication\b/.test(normalized) ||
    /\b(proceed|go ahead|move forward)\b.*\b(apply|application|role|job)\b/.test(normalized)
  );
}

function looksLikeMaterialGenerationRequest(text: string) {
  const normalized = text.toLowerCase();

  return (
    /\b(generate|create|draft|write|make)\b.*\b(resume|cover letter|materials)\b/.test(normalized) ||
    /\b(resume|cover letter|materials)\b.*\b(generate|create|draft|write|make)\b/.test(normalized)
  );
}

function looksLikeMasterResumeRequest(text: string) {
  const normalized = text.toLowerCase();

  if (/\b(cover letter|job-specific|targeted|for this role|for the role)\b/.test(normalized)) {
    return false;
  }

  return (
    /\b(make|sound|tone|voice|rewrite|revise|adjust)\b.*\b(senior|executive|less ai|more human|voice|resume|cv)\b/.test(normalized) ||
    /\b(more senior|less ai|more human|my voice)\b/.test(normalized) ||
    /\b(master resume|base resume|core resume)\b/.test(normalized) ||
    /\b(generate|create|draft|build|make)\b.*\b(resume|cv)\b/.test(normalized) ||
    /\b(resume|cv)\b.*\b(generate|create|draft|build|make)\b/.test(normalized)
  );
}

function formatApplicationLabel(application: ApplicationOverview["recentApplications"][number]) {
  return [application.jobTitle, application.companyName].filter(Boolean).join(" at ");
}

function applicationMatchesText(
  application: ApplicationOverview["recentApplications"][number],
  text: string,
) {
  const normalizedText = text.toLowerCase();
  const searchableValues = [application.companyName, application.jobTitle, formatJobUrl(application.jobUrl)]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  return searchableValues.some((value) => value.length >= 3 && normalizedText.includes(value));
}

function formatApplicationStatus(status: string) {
  return status.replaceAll("_", " ");
}

function formatJobUrl(jobUrl: string) {
  try {
    return new URL(jobUrl).hostname.replace(/^www\./, "");
  } catch {
    return "that job";
  }
}

function isLegacyAssistantSeed(text: string) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();

  return [
    "what specific area are you looking to focus on?",
    "i can help you build your career profile, including your resume",
    "hello! i’d love to help you with your career profile.",
    "hello! i'd love to help you with your career profile.",
    "i'm here to assist you with building your career profile",
    "tell me about your background, paste a role, or drop a resume here.",
  ].some((phrase) => normalized.includes(phrase));
}

function isLegacyUserTestMessage(text: string) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();

  return ["what llm are you using?", "what llm are you using"].includes(normalized);
}

async function persistConversationMessage(
  speaker: ConversationMessage["speaker"],
  text: string,
) {
  try {
    await fetch("/api/conversation/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speaker, text }),
    });
  } catch {
    // Conversation memory should not block the user from continuing their flow.
  }
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
