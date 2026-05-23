import "server-only";

import { isIP } from "node:net";
import * as cheerio from "cheerio";
import mammoth from "mammoth";
import { extractText } from "unpdf";
import { z } from "zod";

import { extractProfileFactsFromText, type ProfileIntakeResult } from "@/lib/profile/profile-intake";
import { createClient } from "@/lib/supabase/server";

const PROFILE_SOURCE_BUCKET = "profile-sources";
const MAX_TXT_BYTES = 1_000_000;
const MAX_PDF_BYTES = 15_000_000;
const MAX_PDF_PAGES = 15;
const MAX_DOCX_BYTES = 15_000_000;
const MAX_PROFILE_HTML_BYTES = 1_500_000;
const MAX_PROFILE_TEXT_CHARS = 12_000;
const FETCH_TIMEOUT_MS = 8000;
const blockedHostnames = new Set(["localhost", "localhost.localdomain"]);

export const profileSourceExtractionRequestSchema = z.object({
  sourceId: z.string().uuid(),
});

export type ProfileSourceExtractionResult = {
  source: {
    id: string;
    extractionStatus: "pending" | "processing" | "succeeded" | "failed" | "deleted";
    extractedTextLength: number;
  };
  intake: ProfileIntakeResult;
};

export async function extractProfileSourceText({
  sourceId,
}: z.infer<typeof profileSourceExtractionRequestSchema>): Promise<ProfileSourceExtractionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { data: source, error: sourceError } = await supabase
    .from("profile_sources")
    .select(
      "id, user_id, profile_id, source_type, source_url, storage_path, original_filename, extraction_status",
    )
    .eq("id", sourceId)
    .eq("user_id", user.id)
    .single();

  if (sourceError || !source) {
    throw new Error("SOURCE_NOT_FOUND");
  }

  if (!["txt", "pdf", "docx", "link", "linkedin", "portfolio"].includes(source.source_type)) {
    throw new Error("UNSUPPORTED_SOURCE_TYPE");
  }

  if (
    ["txt", "pdf", "docx"].includes(source.source_type) &&
    (!source.storage_path || !source.storage_path.startsWith(`${user.id}/`))
  ) {
    throw new Error("INVALID_STORAGE_PATH");
  }

  if (["link", "linkedin", "portfolio"].includes(source.source_type) && !source.source_url) {
    throw new Error("URL_REQUIRED");
  }

  if (source.extraction_status === "processing") {
    throw new Error("SOURCE_ALREADY_PROCESSING");
  }

  await updateSourceStatus(source.id, "processing");

  try {
    const extractedText =
      source.source_type === "pdf"
        ? await extractPdfFromStorage(source.storage_path ?? "")
        : source.source_type === "docx"
          ? await extractDocxFromStorage(source.storage_path ?? "")
        : source.source_type === "txt"
          ? await extractTxtFromStorage(source.storage_path ?? "")
          : await extractPublicProfilePage(source.source_url ?? "");
    const normalizedText = normalizeExtractedText(extractedText);

    if (normalizedText.length < 3) {
      throw new Error("EMPTY_EXTRACTED_TEXT");
    }

    const { error: updateError } = await supabase
      .from("profile_sources")
      .update({
        extracted_text: normalizedText,
        extraction_status: "succeeded",
        failure_reason: null,
      })
      .eq("id", source.id)
      .eq("user_id", user.id);

    if (updateError) {
      throw new Error("SOURCE_UPDATE_FAILED");
    }

    const intake = await extractProfileFactsFromText({
      profileId: source.profile_id,
      sourceId: source.id,
      text: normalizedText,
      origin: "imported",
      inputLabel: buildInputLabel({
        filename: source.original_filename,
        sourceType: source.source_type,
        sourceUrl: source.source_url,
      }),
    });

    return {
      source: {
        id: source.id,
        extractionStatus: "succeeded",
        extractedTextLength: normalizedText.length,
      },
      intake,
    };
  } catch (error) {
    await updateSourceStatus(
      source.id,
      "failed",
      error instanceof Error ? error.message : "UNKNOWN_EXTRACTION_ERROR",
    );

    throw error;
  }
}

async function extractTxtFromStorage(storagePath: string) {
  const data = await downloadProfileSource(storagePath);

  if (data.size > MAX_TXT_BYTES) {
    throw new Error("TEXT_FILE_TOO_LARGE");
  }

  return data.text();
}

async function extractPdfFromStorage(storagePath: string) {
  const data = await downloadProfileSource(storagePath);

  if (data.size > MAX_PDF_BYTES) {
    throw new Error("PDF_FILE_TOO_LARGE");
  }

  const buffer = new Uint8Array(await data.arrayBuffer());
  const result = await extractText(buffer, { mergePages: false });

  if (result.totalPages > MAX_PDF_PAGES) {
    throw new Error("PDF_PAGE_LIMIT_EXCEEDED");
  }

  const text = result.text.join("\n\n").trim();

  if (text.length < 3) {
    throw new Error("PDF_TEXT_EMPTY");
  }

  return text;
}

async function extractDocxFromStorage(storagePath: string) {
  const data = await downloadProfileSource(storagePath);

  if (data.size > MAX_DOCX_BYTES) {
    throw new Error("DOCX_FILE_TOO_LARGE");
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value.trim();

  if (text.length < 3) {
    throw new Error("DOCX_TEXT_EMPTY");
  }

  return text;
}

async function extractPublicProfilePage(sourceUrl: string) {
  assertSafeProfileUrl(sourceUrl);

  const response = await fetch(sourceUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "PramaniaProfileIngestion/0.1",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error("PROFILE_LINK_FETCH_FAILED");
  }

  assertSafeProfileUrl(response.url);

  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    throw new Error("PROFILE_LINK_UNSUPPORTED_CONTENT_TYPE");
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);

  if (contentLength > MAX_PROFILE_HTML_BYTES) {
    throw new Error("PROFILE_LINK_TOO_LARGE");
  }

  const html = await response.text();

  if (html.length > MAX_PROFILE_HTML_BYTES) {
    throw new Error("PROFILE_LINK_TOO_LARGE");
  }

  const text = extractReadableProfileText(html);

  if (text.length < 80) {
    throw new Error("PROFILE_LINK_TEXT_TOO_SHORT");
  }

  return text;
}

async function downloadProfileSource(storagePath: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(PROFILE_SOURCE_BUCKET)
    .download(storagePath);

  if (error || !data) {
    throw new Error("STORAGE_DOWNLOAD_FAILED");
  }

  return data;
}

function extractReadableProfileText(html: string) {
  const $ = cheerio.load(html);

  $("script, style, noscript, svg, iframe, nav, footer, header, form").remove();

  const title = $("meta[property='og:title']").attr("content")?.trim() || $("title").first().text().trim();
  const description =
    $("meta[name='description']").attr("content")?.trim() ||
    $("meta[property='og:description']").attr("content")?.trim();
  const headings = $("h1, h2, h3")
    .map((_, element) => $(element).text().trim())
    .get()
    .filter(Boolean)
    .slice(0, 20)
    .join("\n");
  const bodyText = $("main").text().trim() || $("body").text().trim();

  return [title, description, headings, bodyText]
    .filter(Boolean)
    .join("\n\n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PROFILE_TEXT_CHARS);
}

function normalizeExtractedText(text: string) {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, MAX_PROFILE_TEXT_CHARS);
}

function assertSafeProfileUrl(value: string) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("PROFILE_LINK_UNSUPPORTED_PROTOCOL");
  }

  if (blockedHostnames.has(hostname) || hostname.endsWith(".localhost")) {
    throw new Error("PROFILE_LINK_BLOCKED");
  }

  if (isPrivateIp(hostname)) {
    throw new Error("PROFILE_LINK_BLOCKED");
  }
}

function isPrivateIp(hostname: string) {
  if (!isIP(hostname)) {
    return false;
  }

  if (hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0") {
    return true;
  }

  if (hostname.startsWith("10.") || hostname.startsWith("192.168.")) {
    return true;
  }

  const parts = hostname.split(".").map(Number);

  if (parts.length === 4) {
    const [first, second] = parts;

    if (first === 172 && second >= 16 && second <= 31) {
      return true;
    }

    if (first === 169 && second === 254) {
      return true;
    }
  }

  return hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80:");
}

function buildInputLabel({
  filename,
  sourceType,
  sourceUrl,
}: {
  filename: string | null;
  sourceType: string;
  sourceUrl: string | null;
}) {
  if (sourceUrl) {
    return `${sourceType.toUpperCase()} page (${sourceUrl})`;
  }

  return `${sourceType.toUpperCase()} file${filename ? ` (${filename})` : ""}`;
}

async function updateSourceStatus(
  sourceId: string,
  extractionStatus: "processing" | "succeeded" | "failed",
  failureReason: string | null = null,
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("profile_sources")
    .update({
      extraction_status: extractionStatus,
      failure_reason: failureReason,
    })
    .eq("id", sourceId);

  if (error) {
    throw new Error("SOURCE_STATUS_UPDATE_FAILED");
  }
}
