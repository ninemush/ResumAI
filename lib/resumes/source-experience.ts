import { MAX_RESUME_EXPERIENCE_SECTIONS, type ResumeContent } from "./resume-content";

export function extractExperienceSectionsFromText(text: string) {
  const experienceText = readExperienceText(text);
  const lines = readResumeSourceLines(experienceText || text);
  const sections: ResumeContent["experienceSections"] = [];
  let currentCompany: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const followingLines = lines.slice(index + 1, index + 4);

    if (looksLikeResumeCompanyHeading(line, followingLines)) {
      currentCompany = line;
      continue;
    }

    const roleTitle = line;

    if (!looksLikeResumeRoleTitle(roleTitle)) {
      continue;
    }

    const nextLines = lines.slice(index + 1, index + 8);
    const companyIndex = nextLines.findIndex((candidate) => looksLikeResumeCompany(candidate));
    const dateIndex = nextLines.findIndex((candidate) => looksLikeDateRange(candidate));

    if (companyIndex < 0 && dateIndex < 0) {
      continue;
    }

    const company =
      currentCompany && (companyIndex < 0 || (dateIndex >= 0 && companyIndex > dateIndex))
        ? currentCompany
        : companyIndex >= 0
          ? nextLines[companyIndex]
          : currentCompany;
    const dates = dateIndex >= 0 ? nextLines[dateIndex] : null;
    const location = nextLines.find((candidate, lineIndex) =>
      lineIndex !== companyIndex &&
      lineIndex !== dateIndex &&
      looksLikeResumeLocation(candidate),
    ) ?? null;
    const bulletStart = index + 1 + Math.max(companyIndex, dateIndex, 0) + 1;
    const bulletLines: string[] = [];

    for (let cursor = bulletStart; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor];
      const following = lines.slice(cursor + 1, cursor + 5);
      const startsNextRole =
        looksLikeResumeRoleTitle(candidate) &&
        following.some((item) => looksLikeResumeCompany(item) || looksLikeDateRange(item));

      if (startsNextRole || looksLikeResumeSectionBoundary(candidate)) {
        break;
      }

      if (looksLikeResumeImpactLine(candidate)) {
        bulletLines.push(cleanResumeSourceLine(candidate));
      }

      if (bulletLines.length >= 5) {
        break;
      }
    }

    sections.push({
      bullets: bulletLines.length > 0
        ? bulletLines
        : [`Held ${roleTitle}${company ? ` at ${company}` : ""}${dates ? ` (${dates})` : ""}. Add measurable scope and outcomes.`],
      company,
      dates,
      location,
      roleTitle,
    });

    if (sections.length >= MAX_RESUME_EXPERIENCE_SECTIONS) {
      break;
    }
  }

  return sections;
}

function readExperienceText(text: string) {
  const decoded = decodeResumeSourceText(text);
  const startMatch = /(?:^|\n)\s*(experience|professional experience|employment|work history)\s*(?:\n|$)/i.exec(decoded);

  if (!startMatch) {
    return "";
  }

  const startIndex = startMatch.index + startMatch[0].length;
  const remainder = decoded.slice(startIndex);
  const stopMatch = /(?:^|\n)\s*(education|licenses?|certifications?|skills?|projects?|volunteer|recommendations?|awards?|honou?rs?)\s*(?:\n|$)/i.exec(remainder);

  return remainder.slice(0, stopMatch?.index ?? remainder.length).trim();
}

function readResumeSourceLines(text: string) {
  const rawLines = decodeResumeSourceText(text)
    .split(/\n+/)
    .map(cleanResumeSourceLine)
    .filter((line) => line.length > 1);

  return joinWrappedResumeSourceLines(rawLines)
    .filter((line) => !/^page\s+\d+/i.test(line))
    .filter((line) => !/^(contact|top skills|languages|summary|experience|professional experience)$/i.test(line));
}

function joinWrappedResumeSourceLines(lines: string[]) {
  const joined: string[] = [];

  for (const line of lines) {
    if (/^page\s+\d+/i.test(line)) {
      continue;
    }

    const previous = joined.at(-1);

    if (previous && shouldJoinWrappedResumeLine(previous, line)) {
      joined[joined.length - 1] = `${previous} ${line}`;
      continue;
    }

    joined.push(line);
  }

  return joined;
}

function cleanResumeSourceLine(value: string) {
  return value
    .replace(/^[-•*]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldJoinWrappedResumeLine(previous: string, line: string) {
  if (/^[a-z,;)]/.test(line)) {
    return true;
  }

  if (
    /\b(the|a|an|and|or|of|for|to|by|with|across|including|through|into|from|while)$/i.test(
      previous,
    )
  ) {
    return true;
  }

  if (
    looksLikeResumeSectionBoundary(line) ||
    looksLikeResumeCompanyHeading(line, []) ||
    looksLikeResumeRoleTitle(line) ||
    looksLikeDateRange(line) ||
    looksLikeCompanyDurationLine(line) ||
    looksLikeResumeLocation(line)
  ) {
    return false;
  }

  if (looksLikeResumeSectionBoundary(previous) || looksLikeResumeRoleTitle(previous)) {
    return false;
  }

  if (/^(and|or|across|while|with|for|including|to|by|from|through|into|that|where)\b/i.test(line)) {
    return true;
  }

  return (
    previous.length >= 35 &&
    previous.length <= 150 &&
    !/[.!?]$/.test(previous) &&
    !/^(selected impact|contact|top skills|languages|summary|experience)$/i.test(previous)
  );
}

function decodeResumeSourceText(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function looksLikeResumeRoleTitle(value: string) {
  return (
    value.length <= 140 &&
    /\b(chief|\bcio\b|founder|president|vice president|\bvp\b|director|head|manager|lead|leader|leadership program|consultant|advisor|officer|architect|engineer|analyst|specialist|partner|principal|owner|executive)\b/i.test(
      value,
    ) &&
    !/^(?:i|we|my|our|led|built|managed|owned|developed|reduced|scaled|created|established|supported|completed)\b/i.test(
      value,
    ) &&
    !looksLikeDateRange(value) &&
    !looksLikeResumeSectionBoundary(value)
  );
}

function looksLikeResumeCompany(value: string) {
  return (
    value.length <= 100 &&
    !looksLikeResumeRoleTitle(value) &&
    !looksLikeDateRange(value) &&
    !looksLikeResumeLocation(value) &&
    !looksLikeResumeSectionBoundary(value) &&
    !/^(?:i|we|my|our|led|built|managed|owned|developed|reduced|scaled|created|established|supported|completed|focused|helped)\b/i.test(
      value,
    ) &&
    !/[.!?]$/.test(value) &&
    /^[A-Z0-9][A-Za-z0-9&.,'’() -]{1,100}$/.test(value)
  );
}

function looksLikeResumeCompanyHeading(value: string, followingLines: string[]) {
  return (
    value.length <= 60 &&
    looksLikeResumeCompany(value) &&
    followingLines.some((line) => looksLikeCompanyDurationLine(line) || looksLikeResumeRoleTitle(line))
  );
}

function looksLikeCompanyDurationLine(value: string) {
  return /^\d+\s+years?(?:\s+\d+\s+months?)?$|^\d+\s+months?$/i.test(value.trim());
}

function looksLikeDateRange(value: string) {
  return /\b(present|current|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|19\d{2}|20\d{2}|yrs?|years?|mos?|months?)\b/i.test(
    value,
  );
}

function looksLikeResumeLocation(value: string) {
  return (
    value.length <= 100 &&
    /\b(remote|hybrid|united states|united kingdom|uae|dubai|abu dhabi|riyadh|singapore|india|canada|europe|emea|mea|middle east|saudi|london|new york|san francisco)\b/i.test(
      value,
    )
  );
}

function looksLikeResumeImpactLine(value: string) {
  return (
    value.length >= 28 &&
    !looksLikeStandaloneDateOrDuration(value) &&
    !looksLikeResumeSectionBoundary(value) &&
    /\b(achieved|accelerated|automated|built|consolidated|created|delivered|directed|drove|enabled|established|expanded|grew|improved|increased|instituted|launched|led|managed|optimized|owned|reduced|scaled|saved|shaped|standardized|transformed|governed|advised|mentored|supported|responsible|oversaw|strategy|operations|portfolio|pricing|governance|revenue|margin|profit|cost|customer|team|regional|global)\b/i.test(
      value,
    )
  );
}

function looksLikeStandaloneDateOrDuration(value: string) {
  const trimmed = value.trim();

  return (
    looksLikeDateRange(trimmed) &&
    trimmed.length <= 70 &&
    !/\b(achieved|built|created|delivered|drove|grew|improved|led|managed|reduced|scaled|transformed|revenue|profit|customer|team|global|regional)\b/i.test(
      trimmed,
    )
  );
}

function looksLikeResumeSectionBoundary(value: string) {
  return /^(summary|experience|professional experience|employment|work history|education|licenses?|certifications?|skills?|projects?|volunteer|recommendations?|awards?|honou?rs?|languages|contact)$/i.test(
    value.trim(),
  );
}
