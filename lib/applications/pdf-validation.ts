import "server-only";

import { PDFDocument } from "pdf-lib";
import { extractText } from "unpdf";

export type PdfValidationResult = {
  errors: string[];
  pageCount: number | null;
  textLength: number;
  valid: boolean;
};

export async function validateGeneratedPdf({
  bytes,
  maxPages = 4,
  minTextLength = 80,
  requiredPhrases,
  requiredSections = [],
}: {
  bytes: Uint8Array;
  maxPages?: number;
  minTextLength?: number;
  requiredPhrases: string[];
  requiredSections?: string[];
}): Promise<PdfValidationResult> {
  const errors: string[] = [];
  let pageCount: number | null = null;

  if (bytes.length === 0) {
    errors.push("PDF_EMPTY");
  }

  try {
    const pdf = await PDFDocument.load(bytes);
    pageCount = pdf.getPageCount();

    if (pageCount <= 0) {
      errors.push("PDF_NO_PAGES");
    }

    if (pageCount > maxPages) {
      errors.push(`PDF_TOO_MANY_PAGES:${pageCount}`);
    }
  } catch {
    errors.push("PDF_OPEN_FAILED");
  }

  let extractedText = "";

  try {
    const result = await extractText(new Uint8Array(bytes));
    extractedText = Array.isArray(result.text) ? result.text.join("\n") : result.text;
  } catch {
    errors.push("PDF_TEXT_EXTRACTION_FAILED");
  }

  const normalizedText = normalizePdfText(extractedText);

  for (const phrase of requiredPhrases) {
    const normalizedPhrase = normalizePdfText(phrase);

    if (normalizedPhrase && !normalizedText.includes(normalizedPhrase)) {
      errors.push(`PDF_MISSING_REQUIRED_TEXT:${phrase.slice(0, 80)}`);
    }
  }

  for (const section of requiredSections) {
    const normalizedSection = normalizePdfText(section);

    if (normalizedSection && !normalizedText.includes(normalizedSection)) {
      errors.push(`PDF_MISSING_REQUIRED_SECTION:${section.slice(0, 80)}`);
    }
  }

  if (extractedText.trim().length < minTextLength) {
    errors.push("PDF_TEXT_TOO_SHORT");
  }

  return {
    errors,
    pageCount,
    textLength: extractedText.length,
    valid: errors.length === 0,
  };
}

function normalizePdfText(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .trim();
}
