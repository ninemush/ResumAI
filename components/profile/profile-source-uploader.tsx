"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Link2, Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/browser";

type SourceStatus = {
  tone: "success" | "error" | "info";
  message: string;
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

type ProfileSourceUploaderProps = {
  userId: string;
};

export function ProfileSourceUploader({ userId }: ProfileSourceUploaderProps) {
  const router = useRouter();
  const [status, setStatus] = useState<SourceStatus | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [isSavingLink, setIsSavingLink] = useState(false);

  async function handleFileChange(file: File | null) {
    if (!file) {
      return;
    }

    const sourceType = inferFileSourceType(file);

    if (!sourceType) {
      setStatus({
        tone: "error",
        message: "Please upload a PDF, Word document, text file, JPG, PNG, WEBP, or HEIC image.",
      });
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setStatus({
        tone: "error",
        message: "Please keep profile source files under 25 MB for now.",
      });
      return;
    }

    setIsUploading(true);
    setStatus({ tone: "info", message: "Uploading source securely..." });

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
      setIsUploading(false);
      setStatus({ tone: "error", message: uploadError.message });
      return;
    }

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
    const payload = (await response.json()) as SourceCreateResponse;

    if (!response.ok) {
      setIsUploading(false);
      setStatus({
        tone: "error",
        message: payload.error?.message ?? "Unable to record that source.",
      });
      return;
    }

    if ((sourceType === "txt" || sourceType === "pdf") && payload.source?.id) {
      setStatus({
        tone: "info",
        message: `${sourceType.toUpperCase()} file saved. Extracting profile details now...`,
      });

      const extraction = await extractSource(payload.source.id);
      setIsUploading(false);

      if (!extraction.ok) {
        setStatus({
          tone: "error",
          message: extraction.message,
        });
        return;
      }

      setStatus({
        tone: "success",
        message: extraction.message,
      });
      router.refresh();
      return;
    }

    setIsUploading(false);
    setStatus({
      tone: "success",
      message:
        "Source saved. TXT and PDF extraction are live now; Word, image, and link parsers are next.",
    });
    router.refresh();
  }

  async function handleLinkSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedLink = linkValue.trim();

    if (!trimmedLink) {
      return;
    }

    setIsSavingLink(true);
    setStatus({ tone: "info", message: "Saving profile link..." });

    const sourceType = inferLinkSourceType(trimmedLink);
    const response = await fetch("/api/profile/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceType,
        sourceUrl: trimmedLink,
      }),
    });
    const payload = await response.json();

    setIsSavingLink(false);

    if (!response.ok) {
      setStatus({
        tone: "error",
        message: payload.error?.message ?? "Unable to save that link.",
      });
      return;
    }

    setLinkValue("");
    setStatus({
      tone: "success",
      message:
        sourceType === "linkedin"
          ? "LinkedIn profile link saved. OAuth import stays behind an explicit integration step."
          : "Profile link saved. Link extraction is queued for the next build slice.",
    });
    router.refresh();
  }

  return (
    <section className="source-uploader" aria-label="Profile source ingestion">
      <div className="section-heading">
        <p className="eyebrow">Source intake</p>
        <h2>Add profile material</h2>
      </div>

      <div className="source-actions">
        <label className="source-upload-target">
          <FileUp size={20} aria-hidden="true" />
          <span>Upload PDF, Word, text, or image</span>
          <input
            accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.webp,.heic,.heif"
            disabled={isUploading}
            onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
            type="file"
          />
        </label>

        <form className="source-link-form" onSubmit={handleLinkSubmit}>
          <Link2 size={18} aria-hidden="true" />
          <input
            disabled={isSavingLink}
            onChange={(event) => setLinkValue(event.target.value)}
            placeholder="LinkedIn, portfolio, or profile URL"
            type="url"
            value={linkValue}
          />
          <button disabled={isSavingLink || !linkValue.trim()} type="submit">
            {isSavingLink ? <Loader2 className="spin" size={16} /> : "Save"}
          </button>
        </form>
      </div>

      {status ? (
        <p className={`source-status ${status.tone}`}>{status.message}</p>
      ) : null}
    </section>
  );
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
    };
  }

  const savedFactCount = payload.intake?.savedFactCount ?? 0;

  return {
    ok: true,
    message: `Text extracted and ${savedFactCount} profile detail${savedFactCount === 1 ? "" : "s"} saved.`,
  };
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

function sanitizeFilename(filename: string) {
  const cleaned = filename
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);

  return cleaned || "profile-source";
}
