export function cleanJobTitle(value: string | null | undefined) {
  const cleaned = decodeHtmlText(value)
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return null;
  }

  const linkedInHiringMetadata = readLinkedInHiringMetadata(cleaned);

  if (linkedInHiringMetadata.title) {
    return linkedInHiringMetadata.title;
  }

  const parts = cleaned
    .split(/\s+(?:\||-|–|—)\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !looksLikeJobTitleNoise(part));
  const title = parts[0];

  return title && !looksLikeJobTitleNoise(title) ? title.slice(0, 180) : null;
}

export function readJobMetadataFromTitle(value: string | null | undefined) {
  const cleaned = decodeHtmlText(value)
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return { company: null, title: null };
  }

  const linkedInHiringMetadata = readLinkedInHiringMetadata(cleaned);

  return {
    company: cleanJobCompany(linkedInHiringMetadata.company),
    title: cleanJobTitle(linkedInHiringMetadata.title ?? cleaned),
  };
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

function readLinkedInHiringMetadata(value: string) {
  const withoutLinkedInSuffix = value
    .replace(/\s+(?:\||-|–|—)\s*LinkedIn\s*$/i, "")
    .trim();
  const match = withoutLinkedInSuffix.match(/^(.+?)\s+hiring\s+(.+)$/i);

  if (!match) {
    return { company: null, title: null };
  }

  const company = match[1]?.trim() ?? null;
  const title = stripLinkedInLocationTail(match[2]?.trim() ?? "");

  return {
    company,
    title: title || null,
  };
}

function stripLinkedInLocationTail(value: string) {
  return value
    .replace(
      /\s+in\s+(?:[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)*,\s*){0,3}(?:United Arab Emirates|UAE|United States|United Kingdom|Saudi Arabia|Dubai|Abu Dhabi|Remote|Hybrid|On-site|Onsite)\s*$/i,
      "",
    )
    .trim();
}
