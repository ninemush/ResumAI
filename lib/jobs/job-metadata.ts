export function cleanJobTitle(value: string | null | undefined) {
  const cleaned = decodeHtmlText(value)
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return null;
  }

  const parts = cleaned
    .split(/\s+(?:\||-|–|—)\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !looksLikeJobTitleNoise(part));
  const title = parts[0];

  return title && !looksLikeJobTitleNoise(title) ? title.slice(0, 180) : null;
}

export function cleanJobCompany(value: string | null | undefined) {
  const cleaned = decodeHtmlText(value)
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || looksLikeJobTitleNoise(cleaned)) {
    return null;
  }

  return cleaned.slice(0, 140);
}

function decodeHtmlText(value: string | null | undefined) {
  return (value ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

function looksLikeJobTitleNoise(value: string) {
  return /^(?:linkedin|linkedin\.com|jobs?|job details?|careers?|apply|hiring|workday|greenhouse|lever|indeed|glassdoor)$/i.test(
    value.trim(),
  );
}
