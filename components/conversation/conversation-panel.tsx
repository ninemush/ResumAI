"use client";

import { useEffect, useRef, useState } from "react";
import {
  FileArchive,
  FileText,
  FileType,
  ImageIcon,
  Mic,
  Paperclip,
  SendHorizontal,
  Sparkles,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { brand } from "@/lib/brand";
import type { AppView } from "@/components/app-shell/side-nav";
import type { ApplicationOverview } from "@/lib/applications/application-overview";
import type { JobOverview } from "@/lib/jobs/job-overview";
import type { ProfileOverview } from "@/lib/profile/profile-overview";
import { createClient } from "@/lib/supabase/browser";

type ConversationPanelProps = {
  activeView: AppView;
  applicationOverview: ApplicationOverview;
  initialMessages: ConversationMessage[];
  jobOverview: JobOverview;
  profileOverview: ProfileOverview;
  userEmail: string | null;
  userId: string;
};

type ConversationMessage = {
  attachment?: MessageAttachment;
  id?: string;
  speaker: "assistant" | "user" | "system";
  text: string;
};

type MessageAttachment = {
  name: string;
  previewUrl?: string;
  type: "archive" | "document" | "image" | "pdf" | "text";
};

type ProcessingMode =
  | "advisor"
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

type SupportIssueResponse = {
  issue?: {
    shortId: string;
    status: string;
    subject: string;
    summary: string;
  };
  ok: boolean;
};

type SourceExtractionResult =
  | {
      assistantMessage: string | null;
      extractedFactCount: number;
      followUpQuestions: string[];
      message: string;
      ok: true;
      savedFactCount: number;
      suggestedDirection: string | null;
    }
  | {
      assistantMessage?: null;
      extractedFactCount?: 0;
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
const acceptedFileTypes = new Map<string, "pdf" | "docx" | "txt" | "image" | "linkedin">([
  ["application/pdf", "pdf"],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "docx",
  ],
  ["text/plain", "txt"],
  ["text/csv", "linkedin"],
  ["application/csv", "linkedin"],
  ["application/zip", "linkedin"],
  ["application/x-zip-compressed", "linkedin"],
  ["image/jpeg", "image"],
  ["image/png", "image"],
  ["image/webp", "image"],
]);

export function ConversationPanel({
  activeView,
  applicationOverview,
  initialMessages,
  jobOverview,
  profileOverview,
  userEmail,
  userId,
}: ConversationPanelProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
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
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [processingMode, setProcessingMode] = useState<ProcessingMode>("profile");
  const [processingStep, setProcessingStep] = useState(0);
  const [processingIntent, setProcessingIntent] = useState("");
  const [activeAttachment, setActiveAttachment] = useState<MessageAttachment | null>(null);
  const isSubmitting = pendingRequestCount > 0;

  useEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList) {
      return;
    }

    messageList.scrollTop = messageList.scrollHeight;
  }, [messages, status, error]);

  useEffect(() => {
    const input = messageInputRef.current;

    if (!input) {
      return;
    }

    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }, [message]);

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
    setProcessingIntent(trimmedMessage);
    setProcessingStep(0);
    beginProcessing();
    appendUserMessage(trimmedMessage);
    persistConversationMessage("user", trimmedMessage);

    try {
      await processMessage(trimmedMessage);
    } catch {
      setError(
        "I could not save that note cleanly yet. I still understood the direction; try sending it again, or add a little more context so I can attach it to the right part of your profile.",
      );
    } finally {
      endProcessing();
      setProcessingIntent("");
      setProcessingStep(0);
    }
  }

  function beginProcessing() {
    setPendingRequestCount((count) => count + 1);
  }

  function endProcessing() {
    setPendingRequestCount((count) => Math.max(0, count - 1));
  }

  function handleMessageInput(value: string) {
    setMessage(value);
  }

  async function processMessage(text: string) {
    const urls = extractUrls(text);
    const textWithoutUrls = removeUrls(text, urls).trim();
    const summaries: string[] = [];

    if (urls.length === 0) {
      const approvedFollowUpAction = await processApprovedFollowUpAction(text);

      if (approvedFollowUpAction) {
        appendAssistantMessage(approvedFollowUpAction, true);
        router.refresh();
        return;
      }

      const targetDirectionAnswer = await processTargetDirectionAnswer(text);

      if (targetDirectionAnswer) {
        appendAssistantMessage(targetDirectionAnswer, true);
        router.refresh();
        return;
      }

      const supportIssueAction = await processSupportIssueAction(text);

      if (supportIssueAction) {
        appendAssistantMessage(supportIssueAction, true);
        router.refresh();
        return;
      }

      const resumeAction = await processResumeAction(text);

      if (resumeAction) {
        appendAssistantMessage(resumeAction, true);
        router.refresh();
        return;
      }

      if (shouldRouteToAdvisor(text)) {
        appendAssistantMessage(await processAdvisorQuestion(text), true);
        return;
      }

      const profileEditAction = await processProfileEditAction(text);

      if (profileEditAction) {
        appendAssistantMessage(profileEditAction, true);
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

      if (shouldRouteToAdvisor(text)) {
        appendAssistantMessage(await processAdvisorQuestion(text), true);
        return;
      }
    }

    for (const url of urls) {
      summaries.push(await processUrl(url, text));
    }

    const processedActionUrl = summaries.length > 0 && urls.length > 0;

    if (!processedActionUrl && shouldProcessProfileRemainder({ textWithoutUrls, urls })) {
      summaries.push(
        shouldRouteToAdvisor(textWithoutUrls)
          ? await processAdvisorQuestion(textWithoutUrls)
          : await processProfileText(textWithoutUrls),
      );
    }

    if (summaries.length > 0) {
      appendAssistantMessage(summaries.join(" "), true);
      router.refresh();
    }
  }

  async function processApprovedFollowUpAction(text: string) {
    if (!looksLikeFollowUpApproval(text)) {
      return null;
    }

    const lastAssistantMessage = [...messages]
      .reverse()
      .find((item) => item.speaker === "assistant" && item.text.trim().length > 0)?.text;

    if (!lastAssistantMessage) {
      return null;
    }

    if (lastAssistantMessageSuggestsMasterResumeAction(lastAssistantMessage)) {
      return processResumeAction(
        "Rebuild the master resume as a true ATS-friendly chronological resume from saved source evidence. Use company, role, dates, location, and role-specific impact bullets. Preserve the user's profile PDF and saved sources as the primary structure.",
      );
    }

    return null;
  }

  async function processResumeAction(text: string) {
    if (looksLikeMasterResumeExportRequest(text)) {
      const response = await fetch("/api/resume/master/export", {
        method: "POST",
      });
      const payload = await response.json();

    if (!response.ok) {
        return logSupportIssueAndReply({
          area: "master_resume",
          errorCode: payload.error?.code ?? "MASTER_RESUME_EXPORT_FAILED",
          errorMessage: payload.error?.message ?? "Master resume export failed.",
          source: "chat_command_failure",
          systemResponse: payload.error?.message ?? "I could not export the master resume PDF yet.",
          title: "Master resume export failed",
          userMessage: text,
        });
      }

      const pdfUrl = payload.overview?.latestResume?.pdfDownloadUrl;
      const docxUrl = payload.overview?.latestResume?.docxDownloadUrl;

      return pdfUrl || docxUrl
        ? `Exported validated master resume files. PDF: ${pdfUrl ?? "open Resume Studio"} DOCX: ${docxUrl ?? "open Resume Studio"}`
        : "Exported validated master resume files. Open Resume Studio to download them.";
    }

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
      return logSupportIssueAndReply({
        area: "master_resume",
        errorCode: payload.error?.code ?? "MASTER_RESUME_GENERATION_FAILED",
        errorMessage: payload.error?.message ?? "Master resume generation failed.",
        source: "chat_command_failure",
        systemResponse: payload.error?.message ?? "I could not generate the master resume yet.",
        title: "Master resume update failed",
        userMessage: text,
      });
    }

    return `${payload.summary} I saved the rebuilt draft in Profile & Resume. It should now use a role-by-role ATS chronology when the saved source evidence contains employers, titles, dates, and locations.`;
  }

  async function processTargetDirectionAnswer(text: string) {
    const answer = text.replace(/\s+/g, " ").trim();

    if (!looksLikeAnswerToDirectionQuestion(answer)) {
      return null;
    }

    const lastAssistantMessage = [...messages]
      .reverse()
      .find((item) => item.speaker === "assistant" && item.text.trim().length > 0)?.text;

    if (!lastAssistantMessage || !assistantAskedForTargetDirection(lastAssistantMessage)) {
      return null;
    }

    const response = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetDirection: answer }),
    });
    const payload = await response.json();

    if (!response.ok) {
      return payload.error?.message ?? "I understood the direction, but could not save it to your profile yet.";
    }

    return `Got it. I’ll use **${answer}** as your working target direction. You should see it reflected in Profile & Resume, and I’ll use it when shaping your master resume, role fit, and job recommendations.`;
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

      const exportSummary = await exportApplicationMaterials(application.id);

      return `${payload.summary} ${exportSummary}`;
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

    const applicationId = payload.application?.id;
    const materialSummary = applicationId
      ? await generateAndExportApplicationMaterials(applicationId)
      : "Next, we should generate targeted materials before marking it applied.";

    return payload.created
      ? `Logged ${payload.application?.jobTitle ?? "that role"} at ${payload.application?.companyName ?? "the company"} as an application. ${materialSummary}`
      : `That application is already logged. ${materialSummary}`;
  }

  async function generateAndExportApplicationMaterials(applicationId: string) {
    const response = await fetch(`/api/applications/${applicationId}/materials`, {
      method: "POST",
    });
    const payload = await response.json();

    if (!response.ok) {
      return payload.error?.message ?? "I could not generate targeted materials yet.";
    }

    const exportSummary = await exportApplicationMaterials(applicationId);

    return `${payload.summary} ${exportSummary}`;
  }

  async function exportApplicationMaterials(applicationId: string) {
    const response = await fetch(`/api/applications/${applicationId}/materials/export`, {
      method: "POST",
    });
    const payload = await response.json();

    if (!response.ok) {
      return payload.error?.message ?? "The editable materials are saved, but export needs another attempt from Applications.";
    }

    return payload.review?.exportReadiness?.status === "exported"
      ? "I also exported validated PDF and DOCX files and saved them in Applications and Artifacts."
      : "The editable materials are saved; Applications will show what still needs export.";
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

    setStatus(null);

    return cleanPlainChatText(payload.assistantMessage as string);
  }

  async function processAdvisorQuestion(text: string) {
    const response = await fetch("/api/conversation/advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, surface: mapActiveViewToAdvisorSurface(activeView) }),
    });
    const payload = await response.json();

    if (!response.ok) {
      return logSupportIssueAndReply({
        area: "advisor",
        errorCode: payload.error?.code ?? "ADVISOR_CONTEXT_FAILED",
        errorMessage: payload.error?.message ?? "Advisor context read failed.",
        source: "chat_command_failure",
        systemResponse:
          payload.error?.message ??
          "I hit a processing issue while reading your saved workspace context.",
        title: "Advisor response failed",
        userMessage: text,
      });
    }

    return payload.assistantMessage as string;
  }

  async function processProfileEditAction(text: string) {
    const profilePatch = inferProfilePatch(text);

    if (profilePatch) {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profilePatch.patch),
      });
      const payload = await response.json();

      if (!response.ok) {
        return payload.error?.message ?? "I could not update that profile field yet.";
      }

      return profilePatch.reply;
    }

    return null;
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

    if (extraction.savedFactCount > 0) {
      void refreshMasterResumeFromNewEvidence();
    }

    return formatSourceIntakeReply({
      assistantMessage: extraction.assistantMessage,
      extractedFactCount: extraction.extractedFactCount,
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

    if (extraction.savedFactCount > 0) {
      void refreshMasterResumeFromNewEvidence();
    }

    return formatSourceIntakeReply({
      assistantMessage: extraction.assistantMessage,
      extractedFactCount: extraction.extractedFactCount,
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
    setProcessingIntent(fileList.map((file) => file.name).join(", "));
    setProcessingStep(0);
    beginProcessing();
    appendUserMessage(
      fileList.length === 1 ? "Dropped a file" : `Dropped ${fileList.length} files`,
      fileList.length === 1 ? buildMessageAttachment(fileList[0]) : undefined,
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
      endProcessing();
      setProcessingIntent("");
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
    const unsupportedReason = getUnsupportedFileReason(file);

    if (unsupportedReason) {
      return unsupportedReason;
    }

    const sourceType = inferFileSourceType(file);

    if (!sourceType) {
      return `${file.name} is not a supported profile source yet. Drop a PDF, DOCX, TXT file, JPG/PNG/WebP image, LinkedIn CSV/ZIP export, or paste the text/link directly into Pramania.`;
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

    if (["txt", "pdf", "docx", "image", "linkedin"].includes(sourceType)) {
      const extraction = await extractSource(source.source.id);

      if (!extraction.ok) {
        return buildFileExtractionFailureMessage({
          fileName: file.name,
          message: extraction.message,
          sourceType,
        });
      }

      if (extraction.savedFactCount > 0) {
        void refreshMasterResumeFromNewEvidence();
      }

      return formatSourceIntakeReply({
        assistantMessage: extraction.assistantMessage,
        extractedFactCount: extraction.extractedFactCount,
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
      extractedFactCount: Array.isArray(payload.intake?.facts) ? payload.intake.facts.length : 0,
      followUpQuestions: Array.isArray(payload.intake?.followUpQuestions)
        ? payload.intake.followUpQuestions
        : [],
      ok: true,
      message: "Extracted.",
      savedFactCount: payload.intake?.savedFactCount ?? 0,
      suggestedDirection: payload.intake?.suggestedDirection ?? null,
    };
  }

  async function refreshMasterResumeFromNewEvidence() {
    setStatus("I’m refreshing your master resume draft with the new evidence.");

    try {
      const response = await fetch("/api/resume/master", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({
          instruction:
            "Refresh the master resume after newly ingested profile evidence. Keep it broad, evidence-based, ATS-friendly, and not overfit to one role.",
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        if (payload.error?.code === "resume.context_too_thin") {
          setStatus(null);
          return;
        }

        const issueMessage = await logSupportIssue({
          area: "master_resume",
          errorCode: payload.error?.code ?? "MASTER_RESUME_REFRESH_FAILED",
          errorMessage: payload.error?.message ?? "Master resume refresh failed after source intake.",
          source: "background_refresh_failure",
          systemResponse: "The profile evidence saved, but the master resume refresh did not complete.",
          title: "Master resume refresh failed",
          userMessage: processingIntent,
        });
        setStatus(
          issueMessage ??
            "I updated the profile evidence. The master resume can be refreshed from Profile & Resume.",
        );
        return;
      }

      setStatus("I refreshed the master resume draft from the new source. Open Profile & Resume to review it.");
      router.refresh();
    } catch {
      const issueMessage = await logSupportIssue({
        area: "master_resume",
        errorCode: "MASTER_RESUME_REFRESH_EXCEPTION",
        errorMessage: "Master resume refresh threw an exception after profile evidence intake.",
        source: "background_refresh_failure",
        systemResponse: "The profile evidence saved, but the master resume refresh did not complete.",
        title: "Master resume refresh failed",
        userMessage: processingIntent,
      });
      setStatus(issueMessage ?? "I updated the profile evidence. The master resume refresh needs another attempt.");
    }
  }

  async function processSupportIssueAction(text: string) {
    if (!looksLikeSupportIssueReport(text)) {
      return null;
    }

    const issueMessage = await logSupportIssue({
      area: inferSupportIssueArea(text),
      errorCode: "USER_REPORTED_ISSUE",
      source: "chat_user_report",
      systemResponse: "User reported a product issue from the conversation.",
      title: inferSupportIssueTitle(text),
      userMessage: text,
    });

    return (
      issueMessage ??
      "I could not log the issue cleanly yet. I still understand this is product friction and the owner should review it."
    );
  }

  async function logSupportIssueAndReply(input: {
    area: string;
    errorCode: string;
    errorMessage?: string;
    source: string;
    systemResponse: string;
    title: string;
    userMessage: string;
  }) {
    const logged = await logSupportIssue(input);

    return (
      logged ??
      "I could not complete that action, and I could not log the issue cleanly. Your saved profile context is still intact."
    );
  }

  async function logSupportIssue(input: {
    area: string;
    errorCode?: string;
    errorMessage?: string;
    source: string;
    systemResponse?: string;
    title: string;
    userMessage?: string;
  }) {
    try {
      const response = await fetch("/api/support/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          area: input.area,
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          metadata: {
            activeView,
            path: window.location.pathname,
          },
          source: input.source,
          systemResponse: input.systemResponse,
          title: input.title,
          userMessage: input.userMessage,
        }),
      });
      const payload = (await response.json()) as SupportIssueResponse;

      if (!response.ok || !payload.issue) {
        return null;
      }

      return `I could not complete that cleanly, so I logged issue ${payload.issue.shortId} for owner review. You do not need to repeat yourself; the issue includes this conversation context, the likely area, and supporting logs.`;
    } catch {
      return null;
    }
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
    const cleanText = cleanPlainChatText(text);
    setMessages((current) => [...current, { speaker: "assistant", text: cleanText }]);
    if (persist) {
      persistConversationMessage("assistant", cleanText);
    }
  }

  function appendUserMessage(text: string, attachment?: MessageAttachment) {
    setMessages((current) => [
      ...current,
      {
        attachment,
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
            {item.attachment ? (
              <MessageAttachmentPreview
                attachment={item.attachment}
                onOpen={() => setActiveAttachment(item.attachment ?? null)}
              />
            ) : null}
            <ChatMessageBody text={item.text} />
          </div>
        ))}
        {isSubmitting ? (
          <div className="assistant-message pending-message" aria-live="polite">
            <strong>{brand.name}</strong>
            <p>{getProcessingMessage(processingMode, processingStep, activeView, processingIntent)}</p>
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
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          <Paperclip size={18} aria-hidden="true" />
        </button>
        <button
          aria-label={isListening ? "Stop voice input" : "Start voice input"}
          className={isListening ? "voice-button active" : "voice-button"}
          onClick={toggleVoiceInput}
          title={isListening ? "Stop voice input" : "Voice input"}
          type="button"
        >
          <Mic size={18} aria-hidden="true" />
        </button>
        <textarea
          ref={messageInputRef}
          onChange={(event) => handleMessageInput(event.target.value)}
          onInput={(event) => handleMessageInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          onPaste={(event) => {
            const files = event.clipboardData.files;

            if (files.length > 0) {
              event.preventDefault();
              handleFiles(files);
            }
          }}
          placeholder="Share background, role, link, or resume..."
          rows={1}
          suppressHydrationWarning
          value={message}
        />
        <input
          ref={fileInputRef}
          accept=".pdf,.docx,.txt,.csv,.zip,.jpg,.jpeg,.png,.webp"
          className="sr-only"
          multiple
          onChange={(event) => {
            if (event.target.files) {
              handleFiles(event.target.files);
            }
            event.currentTarget.value = "";
          }}
          suppressHydrationWarning
          type="file"
        />
        <button disabled={message.trim().length < 3} type="submit" aria-label="Send message">
          {isSubmitting ? (
            <SendHorizontal size={18} aria-hidden="true" />
          ) : (
            <SendHorizontal size={18} aria-hidden="true" />
          )}
        </button>
      </form>

      {activeAttachment ? (
        <AttachmentViewer attachment={activeAttachment} onClose={() => setActiveAttachment(null)} />
      ) : null}
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
        (item.speaker === "assistant" && isLegacyAssistantNoise(item.text)) ||
        (item.speaker === "user" && isLegacyUserTestMessage(item.text))
      ),
  );

  if (cleanedMessages.length > 0) {
    return cleanedMessages.map((item) =>
      item.speaker === "assistant"
        ? {
            ...item,
            text: cleanPlainChatText(item.text),
          }
        : item,
    );
  }

  return [
    {
      speaker: "assistant" as const,
      text: welcomeMessage(firstName),
    },
  ];
}

function getProcessingMessage(mode: ProcessingMode, step: number, activeView: AppView, intent: string) {
  const surface = formatActiveViewForMessage(activeView);
  const hasFileIntent = /\.(pdf|docx?|txt|png|jpe?g|webp|csv|zip)\b/i.test(intent);
  const recoveryMessages = isFrustratedOrCorrectionIntent(intent)
    ? [
        "You're right to expect this to use what is already saved. I'm checking the profile, resume, sources, and recent conversation together.",
        "I’m retracing the saved evidence before answering, so you do not have to repeat yourself.",
        "Checking the source history and latest resume before I respond. The answer should be grounded, not generic.",
        "I’m looking for the missed context first, then I’ll give you the practical answer.",
        "Recovering the thread from your saved profile and source evidence.",
        "Checking what Pramania already knows and where the earlier answer fell short.",
      ]
    : null;

  if (recoveryMessages && ["advisor", "profile", "resume", "source"].includes(mode)) {
    return recoveryMessages[step % recoveryMessages.length];
  }

  const messages: Record<ProcessingMode, string[]> = {
    advisor: [
      `Reading your question against what I know from your ${surface}.`,
      "Checking the profile context before I answer, so this does not become generic advice.",
      "Looking for the strongest career move, not just the next reply.",
      "Pressure-testing the answer like a recruiter would: fit, evidence, seniority, and risk.",
      "Looking for the useful next question, not a long questionnaire.",
      "Separating what we already know from what would make the answer sharper.",
      "Checking whether this is a master-profile question or a role-specific question.",
      "Bringing the resume, profile, and recent conversation together.",
      "Making the guidance practical enough that you can act on it.",
      "Almost there. I’m shaping this as career advice, not a chatbot answer.",
    ],
    application: [
      "Checking the application record before I touch anything...",
      "Matching this to the right role so the update stays precise...",
      "Looking at the application history with a recruiter's eye...",
      "Checking the status language so we do not blur applied, interview, and outcome stages...",
      "Keeping this tied to the right company and role...",
      "Looking for the next useful action: follow-up, status update, or material refresh...",
      "Checking whether this needs a precise update or a recommendation first...",
      "Almost there. I'm keeping the audit trail and status clean.",
    ],
    file: [
      hasFileIntent
        ? `Reading ${intent.split(",")[0]} and looking for career context.`
        : "Reading the file and looking for career context...",
      "Pulling out roles, scope, skills, credentials, and useful career evidence...",
      "Separating useful evidence from formatting noise...",
      "Checking whether this is resume text, profile text, or screenshot text...",
      "Looking for the details a recruiter would actually screen for...",
      "Keeping the source attached so you can see where the useful details came from...",
      "Checking whether the master resume should change from this source...",
      "Looking for seniority, scope, domain, and measurable outcomes...",
      "Reading for what changed: stronger positioning, missing metrics, or useful keywords...",
      "Almost there. I’m turning this into profile and resume direction.",
    ],
    job: [
      "Reading the job post and filtering out page noise...",
      "Looking for role requirements, seniority cues, and keywords...",
      "Comparing the post against what we know about your profile...",
      "Checking the fit read for unknowns instead of pretending certainty...",
      "Pulling out the parts that matter for resume targeting...",
      "Looking for what would make this application credible or risky...",
      "Checking whether this is a role to pursue, park, or use for market learning...",
      "Separating must-have requirements from nice-to-have noise...",
      "Almost there. I'm turning the job page into a useful fit read.",
    ],
    profile: [
      `Reading this with a hiring lens from the ${surface}.`,
      "Looking for experience, scope, outcomes, skills, and useful gaps...",
      "Keeping this grounded in what you actually said...",
      "Translating this into evidence without inventing anything...",
      "Checking how this strengthens your positioning and resume story...",
      "Looking for the clearest next question, not a long interrogation...",
      "Checking whether this should update your profile, resume, or target direction...",
      "Looking for the business value behind the activity.",
      "Separating useful career evidence from notes that need more context.",
      "Almost there. I'm turning this into profile evidence and a useful next step.",
    ],
    resume: [
      "Reviewing your profile evidence before drafting resume language...",
      "Checking for ATS strength without making it sound generic...",
      "Keeping unsupported claims out and preserving your voice...",
      "Looking for sharper outcomes, cleaner verbs, and less filler...",
      "Checking whether the draft reads like a human with real scope...",
      "Looking for where the master resume needs stronger evidence or cleaner positioning...",
      "Making sure this stays broad enough for a master resume, not one narrow job.",
      "Checking the resume like a recruiter would scan it in the first minute.",
      "Almost there. I'm shaping this into something you can review.",
    ],
    source: [
      "Finding the source you already shared...",
      "Checking whether that link can be read directly...",
      "Looking for public profile evidence we can safely use...",
      "Refreshing your latest sources so I do not miss something you just added...",
      "If the page blocks server access, I will tell you plainly and keep the source saved...",
      "Looking for the least-burden path: link first, file only when needed.",
      "Checking whether this source can improve your master profile automatically...",
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

function isFrustratedOrCorrectionIntent(intent: string) {
  return /\b(why not|why didn't|why did not|why can't|why couldnt|why couldn't|not working|doesnt work|doesn't work|failed|wrong|irrelevant|already have|you have all|you have my|use what you know|repeat myself|unacceptable|poor|bad|awful|horrible|makes no sense|shouldnt|shouldn't)\b/i.test(
    intent,
  );
}

function inferProcessingMode(text: string): ProcessingMode {
  const urls = extractUrls(text);

  if (urls.some((url) => looksLikeJobUrl(url, text))) {
    return "job";
  }

  if (inferProfilePatch(text)) {
    return "profile";
  }

  if (looksLikeExistingSourceRequest(text) || inferRequestedSourceType(text)) {
    return "source";
  }

  if (looksLikeAdvisorQuestion(text)) {
    return "advisor";
  }

  if (looksLikeMasterResumeRequest(text) || looksLikeMasterResumeExportRequest(text)) {
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

function formatActiveViewForMessage(activeView: AppView) {
  const labels: Partial<Record<AppView, string>> = {
    applications: "applications tracker",
    artifacts: "artifact library",
    jobs: "jobs area",
    knowledgebase: "sources area",
    owner: "owner console",
    profile: "profile cockpit",
    resume: "profile and resume studio",
    settings: "settings area",
    support: "support area",
  };

  return labels[activeView] ?? "workspace";
}

function formatSourceIntakeReply({
  assistantMessage,
  extractedFactCount,
  followUpQuestions,
  label,
  savedFactCount,
  suggestedDirection,
}: {
  assistantMessage: string | null;
  extractedFactCount: number;
  followUpQuestions: string[];
  label: string;
  savedFactCount: number;
  suggestedDirection: string | null;
}) {
  const advisorRead = assistantMessage ? cleanPlainChatText(assistantMessage) : null;
  const direction = suggestedDirection?.trim()
    ? `My current read: ${suggestedDirection.trim()}`
    : null;
  const nextQuestion = selectSourceFollowUp({
    followUpQuestions,
    suggestedDirection,
  });
  const sourceRead =
    savedFactCount > 0 || extractedFactCount > 0
      ? `${label}. I read it and used it to refresh your profile foundation. I will carry that forward into the master resume and role-fit advice.`
      : `${label}. I saved it as source material. The profile read needs another pass before I change your master profile, so I will keep the source available and retry from the saved copy instead of asking you to upload it again.`;

  return [sourceRead, advisorRead, direction, nextQuestion]
    .filter(Boolean)
    .join(" ");
}

function selectSourceFollowUp({
  followUpQuestions,
  suggestedDirection,
}: {
  followUpQuestions: string[];
  suggestedDirection: string | null;
}) {
  const usefulQuestion = followUpQuestions.find((question) => {
    const normalized = question.toLowerCase();

    return (
      question.trim().length > 0 &&
      !/which role lane should i optimize|which role lane|optimize for first/.test(normalized)
    );
  });

  if (usefulQuestion) {
    return usefulQuestion;
  }

  if (suggestedDirection?.trim()) {
    return `I would start by shaping the master resume around ${suggestedDirection.trim().toLowerCase()}, then pressure-test the strongest metrics and scope.`;
  }

  return followUpQuestions.find((question) => question.trim().length > 0) ?? null;
}

function cleanPlainChatText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\*\*([^*\n:]{2,80}):\*\*:/g, "$1:")
    .replace(/\*\*([^*\n:]{2,80}):\*\*/g, "$1:")
    .replace(/\*\*([^*\n]{2,80})\*\*::/g, "$1:")
    .replace(/\*\*([^*\n]{2,80})\*\*:/g, "$1:")
    .replace(/\b([A-Z][A-Za-z0-9 /&+()'-]{2,54})::/g, "$1:")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(
      new RegExp(`\\s+((?:${CHAT_SECTION_LABELS})\\s*:)`, "gi"),
      "\n\n$1",
    )
    .replace(/:\s+[-•]\s+(?=(?:\*\*)?[A-Z0-9])/g, ":\n- ")
    .replace(/\s+-\s+(?=\*\*?[A-Z0-9])/g, "\n- ")
    .replace(/\s+[-•]\s+(?=[A-Z][^.!?]{2,80}:)/g, "\n- ")
    .replace(
      /\bI (?:found|pulled out|captured|read and saved)\s+\d+\s+(?:useful\s+)?(?:profile\s+)?signals?\b[,.]?\s*/gi,
      "",
    )
    .replace(/\bRoot cause:\s*[A-Z0-9_.-]+\.?\s*/gi, "")
    .replace(/\bstructured AI analysis needs another pass\.?\s*/gi, "the analysis needs another pass. ")
    .replace(/\bProof of impact\s*:/gi, "Impact evidence:")
    .replace(/\bFound\s+\d+\s+(?:useful\s+)?profile\s+signals?\.?\s*/gi, "")
    .replace(/\b(?:Saved|stored)\s+\d+\s+(?:new\s+)?profile\s+details?\.?\s*/gi, "")
    .replace(
      /\bI could not complete the deeper advisor read right now\. Share the resume, role, or profile point again and I will keep it grounded in your career context\.?/gi,
      "I had trouble reading the saved workspace context for that reply. Ask again and I will use the profile, sources, resume, jobs, applications, and artifacts already saved.",
    )
    .replace(
      /\bProfile intake is unavailable right now\. Please try again\.?/gi,
      "I had trouble updating the profile from that message. The saved context is still available, and I can answer from it.",
    )
    .replace(/^\s*\d+\.\s+(\*\*.*?\*\*:?\s*)/gm, "- $1")
    .replace(/^\s*\d+\.\s+/gm, "- ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type ChatMessageBlock =
  | {
      kind: "heading";
      text: string;
    }
  | {
      kind: "paragraph";
      text: string;
    }
  | {
      items: string[];
      kind: "list";
    };

const CHAT_SECTION_LABELS = [
  "What I see",
  "What I learned",
  "What is missing",
  "What to fix first",
  "Best lanes",
  "Strongest lanes",
  "Role lanes",
  "Best next move",
  "Next step",
  "Next question",
  "Why it matters",
  "Recommendation",
  "My recommendation",
  "Conservative",
  "Balanced",
  "Executive\\/board-ready",
  "Board-ready",
  "Headline improvement",
  "Summary clarity",
  "Impact evidence",
  "Proof of impact",
  "Leadership depth",
  "Experience structure",
  "Role fit",
  "Resume impact",
  "Resume fix",
  "Metrics to quantify",
  "Metric to quantify",
  "Missing metrics",
  "Useful evidence",
  "What I would do next",
].join("|");

function ChatMessageBody({ text }: { text: string }) {
  const blocks = parseChatMessageBlocks(text);

  return (
    <div className="chat-message-body">
      {blocks.map((block, index) => {
        if (block.kind === "list") {
          return (
            <ul key={`list-${index}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`}>{renderInlineChatText(item)}</li>
              ))}
            </ul>
          );
        }

        if (block.kind === "heading") {
          return <h3 key={`${block.text}-${index}`}>{renderInlineChatText(block.text)}</h3>;
        }

        return <p key={`${block.text}-${index}`}>{renderInlineChatText(block.text)}</p>;
      })}
    </div>
  );
}

function parseChatMessageBlocks(text: string): ChatMessageBlock[] {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\*\*([^*\n:]{2,80}):\*\*:/g, "**$1:**")
    .replace(/\*\*([^*\n:]{2,80}):\*\*/g, "**$1:**")
    .replace(/\*\*([^*\n]{2,80})\*\*::/g, "**$1:**")
    .replace(/\*\*([^*\n]{2,80})\*\*:/g, "**$1:**")
    .replace(/\b([A-Z][A-Za-z0-9 /&+()'-]{2,54})::/g, "$1:")
    .replace(/^\s{0,3}#{1,6}\s+(.+)$/gm, "\n\n**$1**\n")
    .replace(
      new RegExp(`\\s+((?:${CHAT_SECTION_LABELS})\\s*:)`, "gi"),
      "\n\n$1",
    )
    .replace(/:\s+[-•]\s+(?=(?:\*\*)?[A-Z0-9])/g, ":\n- ")
    .replace(/(\S)\s+(\*\*[A-Z][^*]{2,64}\*\*:)/g, "$1\n\n$2")
    .replace(
      new RegExp(`([.!?])\\s+((?:${CHAT_SECTION_LABELS})\\s*:)`, "gi"),
      "$1\n\n$2",
    )
    .replace(/\s+(\d+\.\s+(?:\*\*)?[A-Z][^.!?\n]{2,90}:)/g, "\n$1")
    .replace(/\s+-\s+(?=\*\*?[A-Z0-9])/g, "\n- ")
    .replace(/\s+[-•]\s+(?=[A-Z][^.!?]{2,80}:)/g, "\n- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) return [{ kind: "paragraph", text: "" }];

  const blocks: ChatMessageBlock[] = [];
  let pendingList: string[] = [];

  const flushList = () => {
    if (pendingList.length > 0) {
      blocks.push({ kind: "list", items: pendingList });
      pendingList = [];
    }
  };

  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trim();

    if (!line) {
      flushList();
      continue;
    }

    if (/^\d+\.$/.test(line)) {
      flushList();
      continue;
    }

    const bullet = line.match(/^(?:[-•]|\d+\.)\s+(.+)$/);

    if (bullet) {
      pendingList.push(cleanChatListItem(bullet[1]));
      continue;
    }

    const heading = line.match(/^\*\*([^*]+)\*\*:?\s*$/);

    if (heading) {
      flushList();
      blocks.push({ kind: "heading", text: heading[1].trim() });
      continue;
    }

    const headingWithText = line.match(/^\*\*([^*]+)\*\*:?\s+(.+)$/);

    if (headingWithText) {
      flushList();
      blocks.push({ kind: "heading", text: headingWithText[1].trim() });
      blocks.push({ kind: "paragraph", text: headingWithText[2].trim() });
      continue;
    }

    const labelledParagraph = line.match(
      new RegExp(`^(${CHAT_SECTION_LABELS})\\s*:\\s+(.+)$`, "i"),
    );

    if (labelledParagraph) {
      flushList();
      blocks.push({ kind: "heading", text: toDisplayLabel(labelledParagraph[1]) });
      blocks.push({ kind: "paragraph", text: labelledParagraph[2].trim() });
      continue;
    }

    flushList();
    for (const paragraph of splitDenseChatParagraph(line)) {
      blocks.push({ kind: "paragraph", text: paragraph });
    }
  }

  flushList();

  return blocks;
}

function splitDenseChatParagraph(line: string) {
  if (line.length < 340) {
    return [line];
  }

  const sentences = line
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length < 3) {
    return [line];
  }

  const paragraphs: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;

    if (next.length > 280 && current) {
      paragraphs.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }

  if (current) {
    paragraphs.push(current);
  }

  return paragraphs;
}

function cleanChatListItem(value: string) {
  return value
    .replace(/^\d+\.\s+/, "")
    .replace(/\*\*([^*\n:]{2,80}):\*\*:/g, "**$1:**")
    .replace(/\*\*([^*\n:]{2,80}):\*\*/g, "**$1:**")
    .replace(/\*\*([^*\n]{2,80})\*\*::/g, "**$1:**")
    .replace(/^\*\*([^*\n]+?)(?::)?\*\*:?\s*/, (_, label: string) => {
      return `**${label.trim()}:** `;
    })
    .replace(/^([A-Z][A-Za-z0-9 /&+()'-]{2,54})::\s*/, "$1: ")
    .replace(/\s+/g, " ")
    .trim();
}

function toDisplayLabel(value: string) {
  if (/^proof of impact$/i.test(value.trim())) {
    return "Impact evidence";
  }

  return value
    .replace(/\s+/g, " ")
    .split(" ")
    .map((part) => {
      if (/^(AI|ATS|GTM|VP|PDF|DOCX|URL|P&L|SOX)$/i.test(part)) {
        return part.toUpperCase();
      }

      return `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`;
    })
    .join(" ");
}

function renderInlineChatText(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);

  return parts.map((part, index) => {
    const strong = part.match(/^\*\*([^*]+)\*\*$/);

    if (strong) {
      return <strong key={`${part}-${index}`}>{strong[1]}</strong>;
    }

    return part;
  });
}

function inferProfilePatch(text: string) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const targetDirection = extractProfileFieldValue(text, [
    "set my target direction to",
    "set target direction to",
    "target direction is",
    "my target direction is",
    "set my target role to",
    "target role is",
    "my target role is",
  ]);

  if (targetDirection && isSafeDirectProfileField(targetDirection, 240)) {
    return {
      patch: { targetDirection },
      reply: `Set your working target direction to ${targetDirection}. I will use that as the lane when shaping profile and resume guidance.`,
    };
  }

  const targetLevel = extractProfileFieldValue(text, [
    "set my target level to",
    "set target level to",
    "target level is",
    "my target level is",
    "set my seniority to",
    "my seniority is",
  ]);

  if (targetLevel && isSafeDirectProfileField(targetLevel, 120)) {
    return {
      patch: { targetLevel },
      reply: `Set your working target level to ${targetLevel}. I will keep screening and resume language calibrated to that level.`,
    };
  }

  const headline = extractProfileFieldValue(text, [
    "set my headline to",
    "set headline to",
    "my headline should be",
    "update my headline to",
  ]);

  if (headline && isSafeDirectProfileField(headline, 180)) {
    return {
      patch: { headline },
      reply: "Updated your profile headline. I will use that positioning as a starting point, and we can keep sharpening it as more evidence comes in.",
    };
  }

  const summary = extractProfileFieldValue(text, [
    "set my summary to",
    "set summary to",
    "my summary should be",
    "update my summary to",
  ]);

  if (summary && isSafeDirectProfileField(summary, 900)) {
    return {
      patch: { summary },
      reply: "Updated your profile summary. I will treat it as your working read, not a final resume claim until the evidence supports it.",
    };
  }

  const displayName = extractProfileFieldValue(text, [
    "set my name to",
    "my name is",
    "update my name to",
  ]);

  if (displayName && isSafeDirectProfileField(displayName, 120) && !/\b(role|title|company|team|target)\b/.test(normalized)) {
    return {
      patch: { displayName },
      reply: `Updated your profile name to ${displayName}.`,
    };
  }

  return null;
}

function looksLikeAnswerToDirectionQuestion(text: string) {
  const normalized = text.toLowerCase().trim();

  if (!normalized || normalized.length > 180) {
    return false;
  }

  if (/[?]/.test(text)) {
    return false;
  }

  if (extractUrls(text).length > 0) {
    return false;
  }

  if (
    /\b(upload|download|export|generate|resume|cover letter|application|job link|issue|error|why|what|how|when|where)\b/.test(
      normalized,
    )
  ) {
    return false;
  }

  return /\b(strategy|operations?|commercial|coo|gtm|revenue|sales|product|customer|success|leadership|leader|director|vp|executive|manager|engineering|finance|marketing|people|hr|talent|data|ai|automation|transformation|consulting|services?)\b/.test(
    normalized,
  );
}

function assistantAskedForTargetDirection(text: string) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ");

  return (
    /\bwhich\b.{0,90}\b(direction|lane|path|positioning|target)\b/.test(normalized) ||
    /\bfeels most accurate\b/.test(normalized) ||
    /\btarget market positioning\b/.test(normalized) ||
    /\bshould i optimize\b/.test(normalized)
  );
}

function isSafeDirectProfileField(value: string, maxLength: number) {
  if (value.length > maxLength) return false;
  if (value.split(/[.!?]/).filter((part) => part.trim().length > 0).length > 1) return false;

  return true;
}

function extractProfileFieldValue(text: string, phrases: string[]) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  const matchedPhrase = phrases.find((phrase) => lower.includes(phrase));

  if (!matchedPhrase) {
    return null;
  }

  const startIndex = lower.indexOf(matchedPhrase) + matchedPhrase.length;
  const value = normalized
    .slice(startIndex)
    .replace(/^[:\s"']+/, "")
    .replace(/["'.\s]+$/g, "")
    .trim();

  if (value.length < 2 || value.length > 900) {
    return null;
  }

  return value;
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

function looksLikeSupportIssueReport(text: string) {
  const normalized = text.toLowerCase();

  return (
    /\b(issue|bug|error|failed|failure|broken|not working|wrong|not right|support|help with)\b/.test(normalized) &&
    /\b(app|pramania|resume|profile|job|application|source|chat|master|ats|upload|pdf|docx|linkedin)\b/.test(normalized)
  );
}

function inferSupportIssueArea(text: string) {
  const normalized = text.toLowerCase();

  if (/\b(master|ats|resume)\b/.test(normalized)) return "master_resume";
  if (/\b(profile|source|upload|pdf|docx|linkedin|file)\b/.test(normalized)) return "profile_intake";
  if (/\b(job|application|apply|cover letter|materials)\b/.test(normalized)) return "job_application";
  if (/\b(chat|conversation|response|advisor|pramania)\b/.test(normalized)) return "advisor";

  return "general";
}

function inferSupportIssueTitle(text: string) {
  const area = inferSupportIssueArea(text);

  if (area === "master_resume") return "Master resume issue reported";
  if (area === "profile_intake") return "Profile intake issue reported";
  if (area === "job_application") return "Job/application issue reported";
  if (area === "advisor") return "Advisor conversation issue reported";

  return "User-reported product issue";
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
    `I saved the LinkedIn link and tried to read the public profile, but I could not get enough trustworthy public career detail yet: ${reason}`,
    "I can only use information that is visible on the public web. If the profile is private, not indexed, or only visible after sign-in, I will not guess or invent the missing history.",
    "Fastest fallback: on desktop LinkedIn, open the profile, choose Resources or More, select Save to PDF, then drag that PDF into this chat.",
    "For the fullest import, use LinkedIn Settings & Privacy -> Data privacy -> Get a copy of your data, request the profile archive, and upload the downloaded files when LinkedIn emails them to you.",
  ].join(" ");
}

function buildLinkedInExplanation() {
  return [
    "I can try a public LinkedIn URL first and use only what is visible on the public web.",
    "If the profile is private, not indexed, or only visible after sign-in, I will not guess, scrape behind access controls, or pretend I saw the full history.",
    "The reliable backup is still simple: on desktop LinkedIn, open the profile, choose Resources or More, select Save to PDF, then drag the PDF here. For a fuller archive, go to Settings & Privacy -> Data privacy -> Get a copy of your data and request the profile files.",
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
    return `${fileName} was saved as an image source, but I could not read the visible text yet: ${message} You can retry from Sources, paste the key text here, or drop a clearer screenshot and I will fold it into your profile.`;
  }

  if (sourceType === "pdf") {
    return `${fileName} was saved as a PDF source, but I could not extract usable text yet: ${message} If it is a scanned PDF, drop screenshots or paste the important sections and I will treat them as source evidence.`;
  }

  if (sourceType === "docx") {
    return `${fileName} was saved as a Word source, but I could not extract readable text yet: ${message} You can retry from Sources or paste the resume text here.`;
  }

  if (sourceType === "linkedin") {
    return `${fileName} was saved as a LinkedIn export source, but I could not extract profile data yet: ${message} LinkedIn archive ZIPs and profile CSV files work best. You can retry from Sources or drop the LinkedIn PDF export instead.`;
  }

  return `${fileName} was saved as a source, but I could not extract readable text yet: ${message} You can retry from Sources or paste the important text here.`;
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

function MessageAttachmentPreview({
  attachment,
  onOpen,
}: {
  attachment: MessageAttachment;
  onOpen: () => void;
}) {
  const icon = getAttachmentIcon(attachment.type);

  return (
    <div
      className="message-attachment-card"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
      title={`Preview ${attachment.name}`}
    >
      {attachment.type === "image" && attachment.previewUrl ? (
        <Image
          alt={attachment.name}
          className="message-image-preview"
          height={220}
          unoptimized
          width={340}
          src={attachment.previewUrl}
        />
      ) : attachment.type === "pdf" && attachment.previewUrl ? (
        <object
          aria-label={`Preview of ${attachment.name}`}
          className="message-pdf-preview"
          data={attachment.previewUrl}
          type="application/pdf"
        >
          <FileText size={24} aria-hidden="true" />
        </object>
      ) : (
        <span className="message-file-thumb" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="message-attachment-meta">
        <span>{attachment.name}</span>
        <small>{formatAttachmentType(attachment.type)}</small>
      </span>
    </div>
  );
}

function AttachmentViewer({
  attachment,
  onClose,
}: {
  attachment: MessageAttachment;
  onClose: () => void;
}) {
  return (
    <div className="attachment-viewer-backdrop" role="presentation" onClick={onClose}>
      <div
        aria-label={`Preview ${attachment.name}`}
        aria-modal="true"
        className="attachment-viewer"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <strong>{attachment.name}</strong>
            <span>{formatAttachmentType(attachment.type)}</span>
          </div>
          <button className="secondary-action compact-action" onClick={onClose} type="button">
            Close
          </button>
        </header>
        <div className="attachment-viewer-body">
          {attachment.previewUrl && attachment.type === "image" ? (
            <Image
              alt={attachment.name}
              className="attachment-viewer-image"
              height={900}
              src={attachment.previewUrl}
              unoptimized
              width={1200}
            />
          ) : attachment.previewUrl && attachment.type === "pdf" ? (
            <object
              aria-label={`Preview of ${attachment.name}`}
              className="attachment-viewer-object"
              data={attachment.previewUrl}
              type="application/pdf"
            >
              <a href={attachment.previewUrl} rel="noreferrer" target="_blank">
                Open PDF preview
              </a>
            </object>
          ) : attachment.previewUrl ? (
            <iframe
              className="attachment-viewer-object"
              src={attachment.previewUrl}
              title={`Preview of ${attachment.name}`}
            />
          ) : (
            <div className="attachment-viewer-empty">
              {getAttachmentIcon(attachment.type)}
              <p>Preview is not available for this file type yet, but the source is saved.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function getAttachmentIcon(type: MessageAttachment["type"]) {
  if (type === "archive") return <FileArchive size={22} aria-hidden="true" />;
  if (type === "document") return <FileType size={22} aria-hidden="true" />;
  if (type === "image") return <ImageIcon size={22} aria-hidden="true" />;
  return <FileText size={22} aria-hidden="true" />;
}

function formatAttachmentType(type: MessageAttachment["type"]) {
  const labels: Record<MessageAttachment["type"], string> = {
    archive: "LinkedIn archive",
    document: "Document",
    image: "Image",
    pdf: "PDF",
    text: "Text file",
  };

  return labels[type];
}

function buildMessageAttachment(file: File): MessageAttachment {
  const sourceType = inferFileSourceType(file);
  const extension = file.name.split(".").pop()?.toLowerCase();
  const canPreview = file.type.startsWith("image/") || extension === "pdf";

  return {
    name: file.name,
    previewUrl: canPreview ? URL.createObjectURL(file) : undefined,
    type:
      extension === "zip" || extension === "csv"
        ? "archive"
        : sourceType === "image"
          ? "image"
        : sourceType === "pdf"
          ? "pdf"
        : sourceType === "txt"
          ? "text"
          : "document",
  };
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
    return `I saved ${roleLabel}. I need more profile evidence before I can give you a useful fit read.`;
  }

  const recommendation = formatFitRecommendation(fit.recommendation);
  const gaps = fit.missingKeywords?.length
    ? `Before applying, I would verify evidence for ${fit.missingKeywords.slice(0, 4).join(", ")}.`
    : null;
  const risk = fit.risks?.length ? `Watch-outs: ${fit.risks.slice(0, 2).join(" ")}` : null;
  const question = "Would you like me to log this as an application and create a tailored resume plus cover letter for review?";

  return [
    `I read ${roleLabel}. My recommendation: ${recommendation} ${fit.summary ?? `Fit is ${fit.score}%.`}`,
    gaps,
    risk,
    question,
  ]
    .filter(Boolean)
    .join(" ");
}

function formatFitRecommendation(recommendation: string | undefined) {
  const labels: Record<string, string> = {
    needs_profile: "hold until we add stronger profile evidence.",
    possible_match: "worth a closer look, but not a blind apply.",
    strong_match: "pursue it, assuming the role scope matches what you want next.",
    weak_match: "treat it as a stretch unless you can prove the missing requirements.",
  };

  return labels[recommendation ?? ""] ?? "review carefully before applying.";
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
    return "The highest-value next step is to give me a resume, LinkedIn/portfolio link, or a quick work-history note so I can identify your strongest positioning and the gaps worth closing.";
  }

  const missing: string[] = [];

  if (!profileOverview.profile.summary) missing.push("a sharp profile summary");
  if (!profileOverview.profile.targetDirection) missing.push("target role direction");
  if (profileOverview.factCount < 3) missing.push("stronger outcomes or role examples");

  if (missing.length === 0) {
    return null;
  }

  return `Your profile is started, but it would become much more useful with ${formatList(missing)}. That is what will make the resume and role advice feel specific rather than generic.`;
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

function looksLikeAdvisorQuestion(text: string) {
  const normalized = text.toLowerCase();

  return (
    normalized.includes("?") ||
    /\b(advice|advise|recommend|recommendation|what should|should i|shouldn't you|shouldnt you|tell me|based on what you know|what do you think|where do i fit|what roles|which roles|what metrics|quantify|quantifiable|business value|proof point|proof points|how would you position|career advice|you have my|you have all|you already have|use what you know|why not|why could|why can)\b/.test(
      normalized,
    )
  );
}

function shouldRouteToAdvisor(text: string) {
  if (!looksLikeAdvisorQuestion(text) || looksLikeConcreteWorkflowCommand(text)) {
    return false;
  }

  const normalized = text.toLowerCase();

  if (/\b(i am|i'm|i have|i did|i led|i managed|i built|i created|my role|my experience)\b/.test(normalized)) {
    return /\b(what should|advice|recommend|where do i fit|how would you|what metrics|quantif|business value)\b/.test(
      normalized,
    );
  }

  return true;
}

function looksLikeConcreteWorkflowCommand(text: string) {
  return (
    looksLikeMasterResumeExportRequest(text) ||
    looksLikeMaterialGenerationRequest(text) ||
    looksLikeApplicationLogRequest(text) ||
    inferApplicationStatus(text) !== null ||
    inferProfilePatch(text) !== null
  );
}

function mapActiveViewToAdvisorSurface(activeView: AppView) {
  const surfaceMap: Partial<Record<AppView, string>> = {
    applications: "applications",
    artifacts: "artifacts",
    jobs: "jobs",
    knowledgebase: "sources",
    profile: "profile",
    resume: "resume",
    settings: "settings",
  };

  return surfaceMap[activeView] ?? "unknown";
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

  if (looksLikeReflectiveQuestion(normalized)) {
    return false;
  }

  return (
    /\b(generate|create|draft|write|make)\b.*\b(resume|cover letter|materials)\b/.test(normalized) ||
    /\b(resume|cover letter|materials)\b.*\b(generate|create|draft|write|make)\b/.test(normalized)
  );
}

function looksLikeMasterResumeRequest(text: string) {
  const normalized = text.toLowerCase();

  if (looksLikeReflectiveQuestion(normalized)) {
    return false;
  }

  if (/\b(cover letter|job-specific|targeted|for this role|for the role)\b/.test(normalized)) {
    return false;
  }

  return (
    /\b(rebuild|restructure|rework|fix|refresh|regenerate)\b.*\b(master resume|base resume|core resume|resume|cv|chronology|role-by-role|work history)\b/.test(normalized) ||
    /\b(master resume|base resume|core resume|resume|cv|chronology|role-by-role|work history)\b.*\b(rebuild|restructure|rework|fix|refresh|regenerate)\b/.test(normalized) ||
    /\b(make|sound|tone|voice|rewrite|revise|adjust)\b.*\b(senior|executive|less ai|more human|voice|resume|cv)\b/.test(normalized) ||
    /\b(more senior|less ai|more human|my voice)\b/.test(normalized) ||
    /\b(master resume|base resume|core resume)\b/.test(normalized) ||
    /\b(generate|create|draft|build|make)\b.*\b(resume|cv)\b/.test(normalized) ||
    /\b(resume|cv)\b.*\b(generate|create|draft|build|make)\b/.test(normalized)
  );
}

function looksLikeFollowUpApproval(text: string) {
  const normalized = text.toLowerCase().trim();

  return /^(ok|okay|yes|yep|sure|please|go ahead|do it|go do it|proceed|continue|make it so|sounds good)[\s.!]*$/.test(
    normalized,
  );
}

function lastAssistantMessageSuggestsMasterResumeAction(text: string) {
  const normalized = text.toLowerCase();

  return (
    /\b(master resume|ats|resume)\b/.test(normalized) &&
    /\b(rebuild|restructure|rework|regenerate|refresh|role-by-role|chronolog|work history|professional experience)\b/.test(
      normalized,
    )
  );
}

function looksLikeMasterResumeExportRequest(text: string) {
  const normalized = text.toLowerCase();
  const asksForLearningOrDiagnosis =
    /\b(what did you learn|what have you learned|what do you know|why|how come|i dont see|i don't see|did not|didn't|failed|error)\b/.test(
      normalized,
    );

  if (asksForLearningOrDiagnosis) {
    return false;
  }

  return (
    /\b(export|download)\b.*\b(master resume|base resume|core resume|resume)\b.*\b(pdf|docx|word|file|files)\b/.test(normalized) ||
    /\b(master resume|base resume|core resume|resume)\b.*\b(export|download)\b.*\b(pdf|docx|word|file|files)\b/.test(normalized) ||
    /\b(make|create|generate)\b.*\b(pdf|docx|word file)\b.*\b(master resume|base resume|core resume|resume)\b/.test(normalized)
  );
}

function looksLikeReflectiveQuestion(normalized: string) {
  return (
    normalized.includes("?") &&
    /\b(what|why|how|where|which|should|could|would|do you think|based on)\b/.test(normalized)
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

function isLegacyAssistantNoise(text: string) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();

  return [
    "found 0 profile details.",
    "saved 0 profile details.",
    "profile intake is unavailable right now. please try again.",
    "separating useful career evidence from a note that just needs context.",
  ].some((phrase) => normalized === phrase || normalized.includes(phrase));
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
  if (extension === "docx") return "docx";
  if (extension === "txt") return "txt";
  if (extension === "zip" || extension === "csv") return "linkedin";
  if (["jpg", "jpeg", "png", "webp"].includes(extension ?? "")) {
    return "image";
  }

  return null;
}

function getUnsupportedFileReason(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const mimeType = file.type.toLowerCase();

  if (extension === "doc" || mimeType === "application/msword") {
    return `${file.name} is an older Word .doc file. For reliable intake, save or export it as PDF or DOCX and drop it here. I will read that directly from the chat.`;
  }

  if (extension === "heic" || extension === "heif" || mimeType === "image/heic" || mimeType === "image/heif") {
    return `${file.name} is a HEIC/HEIF image. Convert it to JPG, PNG, or WebP and drop it here so OCR can read it cleanly.`;
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
