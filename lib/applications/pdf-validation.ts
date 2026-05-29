import "server-only";

import { extractText } from "unpdf";

export type PdfValidationResult = {
  errors: string[];
  textLength: number;
  valid: boolean;
};

export async function validateGeneratedPdf({
  bytes,
  requiredPhrases,
}: {
  bytes: Uint8Array;
  requiredPhrases: string[];
}): Promise<PdfValidationResult> {
  const errors: string[] = [];

  if (bytes.length === 0) {
    errors.push("PDF_EMPTY");
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

  if (extractedText.trim().length < 80) {
    errors.push("PDF_TEXT_TOO_SHORT");
  }

  return {
    errors,
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
