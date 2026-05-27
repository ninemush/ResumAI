"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Paperclip, SendHorizontal, Sparkles } from "lucide-react";
import Image from "next/image";
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
  attachmentPreviewUrl?: string;
  attachmentType?: "image";
  id?: string;
  speaker: "assistant" | "user" | "system";
  text: string;
};

type ProcessingMode =
  | "application"
  | "file"
  | "job"
  | "profile"
  | "resume"
  | "source"
  | "voice";

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

type RecentProfileSource = ProfileOverview["recentSources"][number];

type SourceListResponse = {
  ok: boolean;
  sources?: RecentProfileSource[];
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
  const [processingMode, setProcessingMode] = useState<ProcessingMode>("profile");
  const [processingStep, setProcessingStep] = useState(0);

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

  useEffect(() => {
    if (!isSubmitting) {
      return;
    }

    const interval = window.setInterval(() => {
      setProcessingStep((currentStep) => currentStep + 1);
    }, 3200);

    return () => window.clearInterval(interval);
  }, [isSubmitting]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      return;
    }

    setMessage("");
    setStatus(null);
    setError(null);
    setProcessingMode(inferProcessingMode(trimmedMessage));
    setProcessingStep(0);
    setIsSubmitting(true);
    appendUserMessage(trimmedMessage);
    persistConversationMessage("user", trimmedMessage);

    try {
      await processMessage(trimmedMessage);
    } catch {
      setError(
        "I could not save that note cleanly yet. I still understood the direction; try sending it again, or add a little more context so I can attach it to the right part of your profile.",
      );
    } finally {
      setIsSubmitting(false);
      setProcessingStep(0);
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

      const existingSourceAction = await processExistingSourceAction(text);

      if (existingSourceAction) {
        appendAssistantMessage(existingSourceAction, true);
        router.refresh();
        return;
      }

      const sourceExplanation = processSourceExplanationQuestion(text);

      if (sourceExplanation) {
        appendAssistantMessage(sourceExplanation, true);
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
      return (
        payload.error ??
        "I understood the guidance, but I could not save it to your profile yet. Try again with one sentence about where this should apply."
      );
    }

    const savedFactCount = payload.savedFactCount ?? 0;

    setStatus(
      payload.inScope === false || savedFactCount === 0
        ? null
        : `Saved ${savedFactCount} profile detail${savedFactCount === 1 ? "" : "s"}.`,
    );

    return payload.assistantMessage as string;
  }

  async function processExistingSourceAction(text: string) {
    const requestedSourceType = inferRequestedSourceType(text);

    if (!requestedSourceType) {
      return null;
    }

    const latestSources = await readLatestSources();
    const sourcesToSearch = latestSources ?? profileOverview.recentSources;
    const matchingSources = sourcesToSearch.filter((source) =>
      requestedSourceType === "linkedin"
        ? source.source_type === "linkedin"
        : ["link", "linkedin", "portfolio"].includes(source.source_type),
    );
    const source = matchingSources[0];

    if (!source) {
      return requestedSourceType === "linkedin"
        ? "I do not see a saved LinkedIn profile link yet. Paste the LinkedIn URL here, or drop a PDF/screenshots from LinkedIn, and I will turn the readable parts into profile evidence."
        : "I do not see a saved profile link yet. Paste the link here and I will save it, then try to read what is publicly available.";
    }

    if (source.extraction_status === "processing") {
      return `I found ${formatSourceReference(source)} and it is already being processed. Give me a moment, then refresh or ask me again.`;
    }

    if (source.extraction_status === "succeeded") {
      const profileResponse = await processProfileText(
        `Use the profile evidence already saved from my ${formatSourceTypeForPrompt(source.source_type)} source to identify what is useful for my profile and what is still missing. Keep this grounded in saved profile context.`,
      );

      return `I found ${formatSourceReference(source)} and it has already been read into your profile evidence. ${profileResponse}`;
    }

    const extraction = await extractSource(source.id);

    if (!extraction.ok) {
      return source.source_type === "linkedin"
        ? buildLinkedInBlockedMessage(extraction.message)
        : `I found ${formatSourceReference(source)}, but I could not read it directly: ${extraction.message}`;
    }

    return formatSourceIntakeReply({
      assistantMessage: extraction.assistantMessage,
      followUpQuestions: extraction.followUpQuestions,
      label: `I found and read ${formatSourceReference(source)}`,
      savedFactCount: extraction.savedFactCount,
      suggestedDirection: extraction.suggestedDirection,
    });
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

      return formatJobIntakeReply(payload.job);
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
        ? buildLinkedInBlockedMessage(extraction.message)
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
    setProcessingMode("file");
    setProcessingStep(0);
    setIsSubmitting(true);
    appendUserMessage(
      fileList.length === 1
        ? `Dropped ${formatDroppedFileName(fileList[0])}`
        : `Dropped ${fileList.length} files`,
      fileList.length === 1 && fileList[0].type.startsWith("image/")
        ? URL.createObjectURL(fileList[0])
        : undefined,
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
      setProcessingStep(0);
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
        return buildFileExtractionFailureMessage({
          fileName: file.name,
          message: extraction.message,
          sourceType,
        });
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

  async function readLatestSources() {
    try {
      const response = await fetch("/api/profile/sources", {
        cache: "no-store",
      });
      const payload = (await response.json()) as SourceListResponse;

      if (!response.ok || !payload.ok) {
        return null;
      }

      return payload.sources ?? [];
    } catch {
      return null;
    }
  }

  function appendAssistantMessage(text: string, persist = false) {
    setMessages((current) => [...current, { speaker: "assistant", text }]);
    if (persist) {
      persistConversationMessage("assistant", text);
    }
  }

  function appendUserMessage(text: string, attachmentPreviewUrl?: string) {
    setMessages((current) => [
      ...current,
      {
        attachmentPreviewUrl,
        attachmentType: attachmentPreviewUrl ? "image" : undefined,
        speaker: "user",
        text,
      },
    ]);
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
          <p className="eyebrow">Career advisor</p>
          <h2 id="conversation-title">{brand.name}</h2>
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
            {item.attachmentType === "image" && item.attachmentPreviewUrl ? (
              <Image
                alt={item.text}
                className="message-image-preview"
                height={260}
                unoptimized
                width={420}
                src={item.attachmentPreviewUrl}
              />
            ) : null}
            <p>{item.text}</p>
          </div>
        ))}
        {isSubmitting ? (
          <div className="assistant-message pending-message" aria-live="polite">
            <strong>{brand.name}</strong>
            <p>{getProcessingMessage(processingMode, processingStep)}</p>
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
          multiple
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

function getProcessingMessage(mode: ProcessingMode, step: number) {
  const messages: Record<ProcessingMode, string[]> = {
    application: [
      "Checking the application record before I touch anything...",
      "Matching this to the right role so the update stays precise...",
      "Looking at the application history with a recruiter's eye...",
      "Checking the status language so we do not blur applied, interview, and outcome stages...",
      "Keeping this tied to the right company and role...",
      "Almost there. I'm keeping the audit trail and status clean.",
    ],
    file: [
      "Reading the file and looking for hiring signal...",
      "Pulling out roles, scope, skills, credentials, and proof points...",
      "Separating useful evidence from formatting noise...",
      "Checking whether this is resume text, profile text, or screenshot text...",
      "Looking for the details a recruiter would actually screen for...",
      "Keeping the source attached so you can see where each detail came from...",
      "Almost there. I'm shaping this into profile evidence you can review.",
    ],
    job: [
      "Reading the job post and filtering out page noise...",
      "Looking for role requirements, seniority signals, and keywords...",
      "Comparing the post against what we know about your profile...",
      "Checking the fit read for unknowns instead of pretending certainty...",
      "Pulling out the parts that matter for resume targeting...",
      "Almost there. I'm turning the job page into a useful fit read.",
    ],
    profile: [
      "Reading this with a hiring lens...",
      "Looking for experience, scope, outcomes, skills, and useful gaps...",
      "Keeping this grounded in what you actually said...",
      "Translating this into evidence without inventing anything...",
      "Checking how this strengthens your positioning and resume story...",
      "Looking for the clearest next question, not a long interrogation...",
      "Almost there. I'm turning this into profile evidence and a useful next step.",
    ],
    resume: [
      "Reviewing your profile evidence before drafting resume language...",
      "Checking for ATS signal without making it sound generic...",
      "Keeping unsupported claims out and preserving your voice...",
      "Looking for sharper outcomes, cleaner verbs, and less filler...",
      "Checking whether the draft reads like a human with real scope...",
      "Almost there. I'm shaping this into something you can review.",
    ],
    source: [
      "Finding the source you already shared...",
      "Checking whether that link can be read directly...",
      "Looking for public profile evidence we can safely use...",
      "Refreshing your latest sources so I do not miss something you just added...",
      "If the page blocks server access, I will tell you plainly and keep the source saved...",
      "Almost there. If the source is blocked, I'll tell you plainly and give the next best path.",
    ],
    voice: [
      "Listening. I'll place the transcript in the box so you can steer it...",
      "Catching the words first. You stay in control before anything is sent.",
      "Almost there. You can edit the transcript before I use it.",
    ],
  };
  const modeMessages = messages[mode];

  return modeMessages[step % modeMessages.length];
}

function inferProcessingMode(text: string): ProcessingMode {
  const urls = extractUrls(text);

  if (urls.some((url) => looksLikeJobUrl(url, text))) {
    return "job";
  }

  if (looksLikeExistingSourceRequest(text) || inferRequestedSourceType(text)) {
    return "source";
  }

  if (looksLikeMasterResumeRequest(text)) {
    return "resume";
  }

  if (
    looksLikeMaterialGenerationRequest(text) ||
    looksLikeApplicationLogRequest(text) ||
    inferApplicationStatus(text)
  ) {
    return "application";
  }

  return "profile";
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

function inferRequestedSourceType(text: string) {
  const normalized = text.toLowerCase();

  if (!looksLikeExistingSourceRequest(normalized)) {
    return null;
  }

  if (/\blinkedin\b/.test(normalized)) {
    return "linkedin";
  }

  if (/\b(link|url|website|portfolio|profile page|source)\b/.test(normalized)) {
    return "profile_link";
  }

  return null;
}

function processSourceExplanationQuestion(text: string) {
  const normalized = text.toLowerCase();

  if (
    !/\b(why|what happened|could not|couldn't|cant|can't|failed|not working)\b/.test(normalized) ||
    !/\b(linkedin|public profile|profile link|external profile|profile)\b/.test(normalized)
  ) {
    return null;
  }

  if (normalized.includes("linkedin")) {
    return buildLinkedInExplanation();
  }

  return "I could not read that profile link because the page did not return enough readable career content to Pramania's server. Some sites render content only in a browser, block automated server requests, require sign-in, or hide profile sections from public HTML. The reliable V1 path is to paste the profile text, upload a PDF/DOCX export, or drop a screenshot so I can extract it and show you the evidence before trusting it.";
}

function buildLinkedInBlockedMessage(reason: string) {
  return [
    `I saved the LinkedIn link and tried the public read, but LinkedIn did not return readable profile content to Pramania's server: ${reason}`,
    "This can happen even when the page looks public in your browser, because LinkedIn may return a sign-in wall or stripped page to server requests.",
    "Best path now: drag in a LinkedIn PDF export, drop screenshots, or paste the About, Experience, Education, Skills, and Certifications sections here. I will treat that as LinkedIn-sourced profile evidence and show you what I captured before using it.",
  ].join(" ");
}

function buildLinkedInExplanation() {
  return [
    "LinkedIn sign-in confirms identity, but it does not give Pramania your full profile history.",
    "For V1, I will always try a public LinkedIn URL first. If LinkedIn returns readable public content, I can extract it. If LinkedIn returns a sign-in wall or stripped response to Pramania's server, I will not fake browser access or use scraping workarounds.",
    "The reliable import path is still easy: upload a LinkedIn PDF export, paste your About/Experience/Skills text, or drop screenshots. I can parse those immediately and show every extracted fact before it becomes trusted profile evidence.",
  ].join(" ");
}

function buildFileExtractionFailureMessage({
  fileName,
  message,
  sourceType,
}: {
  fileName: string;
  message: string;
  sourceType: string;
}) {
  if (sourceType === "image") {
    return `${fileName} was saved as an image source, but I could not read the visible text yet: ${message} You can retry from Knowledgebase, paste the key text here, or drop a clearer screenshot and I will fold it into your profile evidence.`;
  }

  if (sourceType === "pdf") {
    return `${fileName} was saved as a PDF source, but I could not extract usable text yet: ${message} If it is a scanned PDF, drop screenshots or paste the important sections and I will treat them as source evidence.`;
  }

  if (sourceType === "docx") {
    return `${fileName} was saved as a Word source, but I could not extract readable text yet: ${message} You can retry from Knowledgebase or paste the resume text here.`;
  }

  return `${fileName} was saved as a source, but I could not extract readable text yet: ${message} You can retry from Knowledgebase or paste the important text here.`;
}

function looksLikeExistingSourceRequest(text: string) {
  const normalized = text.toLowerCase();

  return (
    /\b(use|read|access|check|pull|extract|ingest|enrich)\b/.test(normalized) &&
    /\b(gave|shared|saved|provided|already|previous|earlier|linkedin|profile link|source)\b/.test(
      normalized,
    )
  );
}

function formatSourceReference(source: ProfileOverview["recentSources"][number]) {
  if (source.source_type === "linkedin") {
    return "your saved LinkedIn profile link";
  }

  if (source.original_filename) {
    return source.original_filename;
  }

  return source.source_url ? formatJobUrl(source.source_url) : "your saved profile source";
}

function formatSourceTypeForPrompt(sourceType: string) {
  if (sourceType === "linkedin") return "LinkedIn";
  if (sourceType === "portfolio") return "portfolio";
  if (sourceType === "link") return "profile link";
  return sourceType;
}

function formatDroppedFileName(file: File) {
  if (file.type.startsWith("image/")) {
    return `screenshot/image: ${file.name}`;
  }

  return file.name;
}

function formatJobIntakeReply(job: {
  company?: string | null;
  fitAnalysis?: {
    missingKeywords?: string[];
    questions?: string[];
    recommendation?: string;
    risks?: string[];
    score?: number | null;
    summary?: string;
  } | null;
  title?: string | null;
} | null | undefined) {
  if (!job) {
    return "I saved that job post. We can review fit once the page is readable.";
  }

  const roleLabel = [job.title, job.company].filter(Boolean).join(" at ") || "that job post";
  const fit = job.fitAnalysis;

  if (!fit || fit.score === null || fit.score === undefined) {
    return `I saved ${roleLabel}. I need more confirmed profile evidence before I can give you a useful fit read.`;
  }

  const gaps = fit.missingKeywords?.length
    ? `Potential gaps to verify: ${fit.missingKeywords.slice(0, 4).join(", ")}.`
    : null;
  const risk = fit.risks?.[0] ?? null;
  const question =
    fit.questions?.[0] ??
    "Do you want to log this as an application and generate tailored materials?";

  return [
    `I read ${roleLabel}. ${fit.summary ?? `Fit is ${fit.score}%.`}`,
    gaps,
    risk,
    question,
  ]
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

  return `You have ${followUpApplications.length} application${followUpApplications.length === 1 ? "" : "s"} that may need a status check. Did you hear back on ${roleLabel}? Reply with the outcome and I will update the right record carefully.`;
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
