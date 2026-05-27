import "server-only";

import { isIP } from "node:net";
import * as cheerio from "cheerio";
import JSZip from "jszip";
import mammoth from "mammoth";
import { extractText } from "unpdf";
import { z } from "zod";

import { getOpenAIClient, getProfileIntakeModel } from "@/lib/ai/openai";
import { extractProfileFactsFromText, type ProfileIntakeResult } from "@/lib/profile/profile-intake";
import { createClient } from "@/lib/supabase/server";

const PROFILE_SOURCE_BUCKET = "profile-sources";
const MAX_TXT_BYTES = 1_000_000;
const MAX_PDF_BYTES = 15_000_000;
const MAX_PDF_PAGES = 15;
const MAX_DOCX_BYTES = 15_000_000;
const MAX_IMAGE_BYTES = 10_000_000;
const MAX_LINKEDIN_ARCHIVE_BYTES = 25_000_000;
const MAX_LINKEDIN_ARCHIVE_FILES = 30;
const MAX_PROFILE_HTML_BYTES = 1_500_000;
const MAX_PROFILE_TEXT_CHARS = 12_000;
const FETCH_TIMEOUT_MS = 8000;
const IMAGE_OCR_MAX_ATTEMPTS = 3;
const blockedHostnames = new Set(["localhost", "localhost.localdomain"]);
const supportedOcrMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

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
      "id, user_id, profile_id, source_type, source_url, storage_path, original_filename, mime_type, extraction_status",
    )
    .eq("id", sourceId)
    .eq("user_id", user.id)
    .single();

  if (sourceError || !source) {
    throw new Error("SOURCE_NOT_FOUND");
  }

  if (!["txt", "pdf", "docx", "image", "link", "linkedin", "portfolio"].includes(source.source_type)) {
    throw new Error("UNSUPPORTED_SOURCE_TYPE");
  }

  if (
    ["txt", "pdf", "docx", "image"].includes(source.source_type) &&
    (!source.storage_path || !source.storage_path.startsWith(`${user.id}/`))
  ) {
    throw new Error("INVALID_STORAGE_PATH");
  }

  if (
    source.source_type === "linkedin" &&
    source.storage_path &&
    !source.storage_path.startsWith(`${user.id}/`)
  ) {
    throw new Error("INVALID_STORAGE_PATH");
  }

  if (["link", "portfolio"].includes(source.source_type) && !source.source_url) {
    throw new Error("URL_REQUIRED");
  }

  if (source.source_type === "linkedin" && !source.source_url && !source.storage_path) {
    throw new Error("LINKEDIN_SOURCE_REQUIRED");
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
        : source.source_type === "image"
          ? await extractImageTextFromStorage({
              mimeType: source.mime_type,
              storagePath: source.storage_path ?? "",
            })
        : source.source_type === "linkedin" && source.storage_path
          ? await extractLinkedInArchiveFromStorage({
              filename: source.original_filename,
              storagePath: source.storage_path,
            })
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

async function extractImageTextFromStorage({
  mimeType,
  storagePath,
}: {
  mimeType: string | null;
  storagePath: string;
}) {
  const normalizedMimeType = mimeType?.toLowerCase() ?? "";

  if (!supportedOcrMimeTypes.has(normalizedMimeType)) {
    throw new Error("IMAGE_OCR_UNSUPPORTED_MIME_TYPE");
  }

  const data = await downloadProfileSource(storagePath);

  if (data.size > MAX_IMAGE_BYTES) {
    throw new Error("IMAGE_OCR_FILE_TOO_LARGE");
  }

  const imageDataUrl = await blobToDataUrl(data, normalizedMimeType);
  let lastFailureCode = "IMAGE_OCR_FAILED";

  for (let attempt = 1; attempt <= IMAGE_OCR_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await getOpenAIClient().responses.create({
        model: getProfileIntakeModel(),
        instructions:
          "You are an OCR extraction service for a career profile builder. Extract only visible text from the image. Preserve headings, dates, employers, job titles, skills, credentials, and bullets when readable. Do not add facts, commentary, markdown fences, or explanations. If no career-relevant text is readable, return an empty string.",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Extract the readable resume, credential, LinkedIn/profile, or career-history text from this image.",
              },
              {
                type: "input_image",
                image_url: imageDataUrl,
                detail: "high",
              },
            ],
          },
        ],
        max_output_tokens: 2200,
        metadata: {
          feature: "profile_source_ocr",
          source_type: "image",
          attempt: String(attempt),
        },
        store: false,
      });

      if (response.error) {
        lastFailureCode = "IMAGE_OCR_PROVIDER_ERROR";
        logOcrAttemptFailure({ attempt, code: lastFailureCode });
        continue;
      }

      if (response.incomplete_details) {
        lastFailureCode = "IMAGE_OCR_INCOMPLETE_RESPONSE";
        logOcrAttemptFailure({ attempt, code: lastFailureCode });
        continue;
      }

      const text = response.output_text.trim();

      if (text.length < 3) {
        lastFailureCode = "IMAGE_OCR_TEXT_EMPTY";
        logOcrAttemptFailure({ attempt, code: lastFailureCode });
        continue;
      }

      return text;
    } catch (error) {
      lastFailureCode = toOcrProviderFailureCode(error);
      logOcrAttemptFailure({ attempt, code: lastFailureCode });
    }
  }

  throw new Error(lastFailureCode);
}

async function extractLinkedInArchiveFromStorage({
  filename,
  storagePath,
}: {
  filename: string | null;
  storagePath: string;
}) {
  const data = await downloadProfileSource(storagePath);

  if (data.size > MAX_LINKEDIN_ARCHIVE_BYTES) {
    throw new Error("LINKEDIN_ARCHIVE_FILE_TOO_LARGE");
  }

  const extension = filename?.split(".").pop()?.toLowerCase();
  const buffer = Buffer.from(await data.arrayBuffer());

  if (extension === "zip") {
    return extractLinkedInZipText(buffer);
  }

  if (extension === "csv") {
    return formatLinkedInCsvText(filename ?? "LinkedIn profile export", buffer.toString("utf8"));
  }

  throw new Error("LINKEDIN_ARCHIVE_UNSUPPORTED_FILE");
}

async function extractLinkedInZipText(buffer: Buffer) {
  let archive: JSZip;

  try {
    archive = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error("LINKEDIN_ARCHIVE_INVALID_ZIP");
  }

  const candidateFiles = Object.values(archive.files)
    .filter((file) => !file.dir && isLinkedInProfileArchiveFile(file.name))
    .slice(0, MAX_LINKEDIN_ARCHIVE_FILES);

  if (candidateFiles.length === 0) {
    throw new Error("LINKEDIN_ARCHIVE_NO_PROFILE_FILES");
  }

  const sections: string[] = [];

  for (const file of candidateFiles) {
    const text = await file.async("string");
    const formatted = safeFormatLinkedInCsvText(file.name, text);

    if (formatted) {
      sections.push(formatted);
    }
  }

  const combined = sections.join("\n\n").trim();

  if (combined.length < 3) {
    throw new Error("LINKEDIN_ARCHIVE_TEXT_EMPTY");
  }

  return combined;
}

function safeFormatLinkedInCsvText(filename: string, csvText: string) {
  try {
    return formatLinkedInCsvText(filename, csvText);
  } catch (error) {
    if (error instanceof Error && error.message === "LINKEDIN_ARCHIVE_TEXT_EMPTY") {
      return "";
    }

    throw error;
  }
}

function isLinkedInProfileArchiveFile(filename: string) {
  const basename = filename.split("/").pop()?.toLowerCase() ?? "";
  const allowedFiles = new Set([
    "certifications.csv",
    "courses.csv",
    "education.csv",
    "honors.csv",
    "languages.csv",
    "organizations.csv",
    "patents.csv",
    "positions.csv",
    "profile.csv",
    "projects.csv",
    "publications.csv",
    "skills.csv",
    "test scores.csv",
    "volunteer experiences.csv",
  ]);

  return allowedFiles.has(basename);
}

function formatLinkedInCsvText(filename: string, csvText: string) {
  const rows = parseCsv(csvText).filter((row) => row.some((cell) => cell.trim().length > 0));

  if (rows.length < 2) {
    throw new Error("LINKEDIN_ARCHIVE_TEXT_EMPTY");
  }

  const [headers, ...dataRows] = rows;
  const title = filename
    .split("/")
    .pop()
    ?.replace(/\.csv$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();

  const formattedRows = dataRows
    .slice(0, 100)
    .map((row) => formatLinkedInCsvRow(headers, row))
    .filter(Boolean);

  if (formattedRows.length === 0) {
    throw new Error("LINKEDIN_ARCHIVE_TEXT_EMPTY");
  }

  return [`LinkedIn ${title ?? "profile export"}`, ...formattedRows].join("\n");
}

function formatLinkedInCsvRow(headers: string[], row: string[]) {
  const fields = headers
    .map((header, index) => ({
      header: header.trim(),
      value: row[index]?.trim() ?? "",
    }))
    .filter(({ header, value }) => header && value);

  if (fields.length === 0) {
    return "";
  }

  return fields.map(({ header, value }) => `${header}: ${value}`).join("; ");
}

function parseCsv(value: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const nextChar = value[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }

      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);

  if (row.some((cell) => cell.length > 0)) {
    rows.push(row);
  }

  return rows;
}

async function extractPublicProfilePage(sourceUrl: string) {
  assertSafeProfileUrl(sourceUrl);
  const isLinkedInProfile = isLinkedInUrl(sourceUrl);

  const response = await fetch(sourceUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "PramaniaProfileIngestion/0.1",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    if (isLinkedInProfile) {
      throw new Error("LINKEDIN_PUBLIC_PROFILE_BLOCKED");
    }

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

  if (isLinkedInProfile && looksLikeLinkedInAuthWall(text)) {
    throw new Error("LINKEDIN_PUBLIC_PROFILE_BLOCKED");
  }

  if (text.length < 80) {
    if (isLinkedInProfile) {
      throw new Error("LINKEDIN_PUBLIC_PROFILE_BLOCKED");
    }

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
  const structuredProfileText = extractStructuredProfileText($);

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

  return [title, description, structuredProfileText, headings, bodyText]
    .filter(Boolean)
    .join("\n\n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PROFILE_TEXT_CHARS);
}

function extractStructuredProfileText($: cheerio.CheerioAPI) {
  const sections: string[] = [];

  $("script[type='application/ld+json']").each((_, element) => {
    const raw = $(element).contents().text().trim();

    if (!raw) {
      return;
    }

    const parsed = parseJsonLd(raw);
    const nodes = Array.isArray(parsed) ? parsed : [parsed];

    for (const node of flattenJsonLdGraph(nodes)) {
      const text = formatStructuredProfileNode(node);

      if (text) {
        sections.push(text);
      }
    }
  });

  return sections.slice(0, 8).join("\n");
}

function parseJsonLd(value: string): unknown[] {
  try {
    return [JSON.parse(value)];
  } catch {
    return value
      .split(/\n(?=\s*\{)/)
      .flatMap((chunk) => {
        try {
          return [JSON.parse(chunk)];
        } catch {
          return [];
        }
      });
  }
}

function flattenJsonLdGraph(nodes: unknown[]): Record<string, unknown>[] {
  const flattened: Record<string, unknown>[] = [];

  for (const node of nodes) {
    if (Array.isArray(node)) {
      flattened.push(...flattenJsonLdGraph(node));
      continue;
    }

    if (!isJsonRecord(node)) {
      continue;
    }

    flattened.push(node);

    const graph = node["@graph"];

    if (Array.isArray(graph)) {
      flattened.push(...flattenJsonLdGraph(graph));
    }
  }

  return flattened;
}

function formatStructuredProfileNode(node: Record<string, unknown>) {
  const type = readJsonLdType(node["@type"]);
  const profileTypes = new Set(["person", "profilepage", "organization", "creativework"]);

  if (type && !profileTypes.has(type.toLowerCase())) {
    return "";
  }

  const fields = [
    ["Name", readJsonString(node.name)],
    ["Headline", readJsonString(node.jobTitle) || readJsonString(node.alternateName)],
    ["Description", readJsonString(node.description)],
    ["Organization", readJsonName(node.worksFor) || readJsonName(node.affiliation)],
    ["Education", readJsonName(node.alumniOf)],
    ["Location", readJsonName(node.address)],
    ["Skills", readJsonStringList(node.knowsAbout)],
    ["Same as", readJsonStringList(node.sameAs)],
  ].filter(([, value]) => value);

  if (fields.length === 0) {
    return "";
  }

  return fields.map(([label, value]) => `${label}: ${value}`).join("\n");
}

function readJsonLdType(value: unknown) {
  if (Array.isArray(value)) {
    return value.find((entry): entry is string => typeof entry === "string") ?? "";
  }

  return typeof value === "string" ? value : "";
}

function readJsonString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readJsonStringList(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((entry) => readJsonString(entry) || readJsonName(entry))
    .filter(Boolean)
    .join(", ");
}

function readJsonName(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value.map(readJsonName).filter(Boolean).join(", ");
  }

  if (!isJsonRecord(value)) {
    return "";
  }

  return readJsonString(value.name) || readJsonString(value.addressLocality);
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeExtractedText(text: string) {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, MAX_PROFILE_TEXT_CHARS);
}

async function blobToDataUrl(data: Blob, mimeType: string) {
  const buffer = Buffer.from(await data.arrayBuffer());
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
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

function isLinkedInUrl(value: string) {
  const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  return hostname === "linkedin.com" || hostname.endsWith(".linkedin.com");
}

function looksLikeLinkedInAuthWall(text: string) {
  const normalized = text.toLowerCase();

  return [
    "sign in to linkedin",
    "join linkedin",
    "linkedin login",
    "authwall",
    "sign up to see",
    "people you may know",
  ].some((phrase) => normalized.includes(phrase));
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

function toOcrProviderFailureCode(error: unknown) {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : null;

  if (status === 401 || status === 403) {
    return "IMAGE_OCR_PROVIDER_AUTH_FAILED";
  }

  if (status === 400 || status === 422) {
    return "IMAGE_OCR_PROVIDER_REJECTED_IMAGE";
  }

  if (status === 408 || status === 409 || status === 429 || (status !== null && status >= 500)) {
    return "IMAGE_OCR_PROVIDER_TEMPORARY_FAILURE";
  }

  return "IMAGE_OCR_PROVIDER_UNAVAILABLE";
}

function logOcrAttemptFailure({ attempt, code }: { attempt: number; code: string }) {
  console.warn(
    JSON.stringify({
      event: "profile_source_ocr_attempt_failed",
      attempt,
      maxAttempts: IMAGE_OCR_MAX_ATTEMPTS,
      code,
    }),
  );
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
