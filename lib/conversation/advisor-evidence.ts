import { brand } from "@/lib/brand";

export type AdvisorEvidenceSource = {
  extracted_text: string | null;
  extraction_status: string;
  failure_reason?: string | null;
  original_filename: string | null;
  source_type: string;
  source_url: string | null;
};

type ResumeSectionSnapshot = {
  certifications: number;
  education: number;
  exists: boolean;
  experienceSections: number;
  languages: number;
  specialProjects: number;
};

export function buildSourceEvidencePack({
  message,
  sources,
}: {
  message: string;
  sources: AdvisorEvidenceSource[];
}) {
  const normalized = normalizeSourceQueryText(message);
  const asksAboutSource =
    /\b(uploaded|source|file|library|pdf|docx|resume|profile|linkedin|document)\b/.test(
      normalized,
    ) ||
    sources.some((source) =>
      source.original_filename
        ? normalized.includes(normalizeSourceQueryText(source.original_filename))
        : false,
    );
  const asksForExtractedEvidence =
    /\b(find|found|see|saw|read|learn|learned|detect|detected|extract|extracted|from|in my|in the|what.*in)\b/.test(
      normalized,
    );

  if (!asksAboutSource && !asksForExtractedEvidence) {
    return "No specific source question detected.";
  }

  const source = selectSourceForUserQuestion(message, sources);
  const requestedSections = readRequestedEvidenceAreas(normalized);

  if (!source) {
    return [
      "Source evidence request detected.",
      "No matching uploaded source was found in the provided workspace context.",
      `User-visible guidance should direct the user to check Library in ${brand.name}, not invent source findings.`,
    ].join("\n");
  }

  const label = formatAdvisorSourceLabel(source);
  const text = source.extracted_text?.replace(/\s+/g, " ").trim() ?? "";
  const sourceLines = [
    "Source evidence request detected.",
    `Matched source: ${label}`,
    `Source type: ${formatAdvisorSourceType(source.source_type)}`,
    `Read status: ${formatAdvisorSourceStatus(source.extraction_status)}`,
    source.failure_reason ? `Read issue: ${source.failure_reason}` : null,
    requestedSections.length > 0
      ? `User is asking about: ${requestedSections.join(", ")}`
      : "User is asking what the source supports.",
  ].filter((line): line is string => Boolean(line));

  if (source.extraction_status !== "succeeded") {
    return [
      ...sourceLines,
      "Do not infer projects, education, languages, certifications, or resume facts from this source because it is not readable yet.",
      "Answer warmly and suggest checking Library or uploading a cleaner source.",
    ].join("\n");
  }

  if (!text) {
    return [
      ...sourceLines,
      "The source is marked readable but no saved source text was provided to this advisor context.",
      "Do not infer facts from an empty source preview.",
    ].join("\n");
  }

  return [
    ...sourceLines,
    "Relevant source excerpts for the advisor model:",
    ...buildRelevantEvidenceSnippets({ requestedSections, text }).map(
      (snippet) => `- ${snippet}`,
    ),
    requestedSections.includes("special projects")
      ? "For Special Projects, only treat an item as supported when the source shows a standalone initiative or project with the user's action/context. Project-like words alone are not enough."
      : null,
    "Use these excerpts as evidence. If they do not support the user's requested section, say that clearly in natural product language.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function buildResumeDiagnosticEvidencePack({
  latestResume,
  message,
  readableSourceCount,
}: {
  latestResume: unknown;
  message: string;
  readableSourceCount: number;
}) {
  const normalized = message.toLowerCase().replace(/\s+/g, " ");
  const asksAboutResumeSections =
    /\b(resume|cv|rebuilt|rebuild|generated|draft|export|pdf|docx)\b/.test(normalized) &&
    /\b(section|sections|education|special projects?|projects?|languages?|certifications?|missing|not see|don't see|dont see|omitted|why|issue)\b/.test(
      normalized,
    );
  const challengesCapability =
    /\b(why|what.*issue|not able|can't|cannot|couldn't|couldnt|make sure|ensure)\b/.test(
      normalized,
    ) && /\b(resume|sections?|education|projects?|languages?)\b/.test(normalized);

  if (!asksAboutResumeSections && !challengesCapability) {
    return "No resume section diagnostic request detected.";
  }

  const snapshot = readResumeSectionSnapshot(latestResume);

  if (!snapshot.exists) {
    return [
      "Resume diagnostic request detected.",
      "No saved master resume draft was provided in the advisor context.",
      "Tell the user the app needs a generated master resume before comparing saved resume sections to source evidence.",
    ].join("\n");
  }

  const missingOptional = [
    snapshot.specialProjects === 0 ? "Special Projects" : null,
    snapshot.languages === 0 ? "Languages" : null,
    snapshot.education === 0 ? "Education" : null,
    snapshot.certifications === 0 ? "Certifications" : null,
  ].filter((item): item is string => Boolean(item));
  const presentOptional = [
    snapshot.specialProjects > 0 ? "Special Projects" : null,
    snapshot.languages > 0 ? "Languages" : null,
    snapshot.education > 0 ? "Education" : null,
    snapshot.certifications > 0 ? "Certifications" : null,
  ].filter((item): item is string => Boolean(item));

  return [
    "Resume diagnostic request detected.",
    "Internal section snapshot for reasoning only; do not expose raw section counts unless the user asks for admin/status details.",
    `Role-by-role experience sections present: ${snapshot.experienceSections > 0 ? "yes" : "no"}`,
    `Optional sections present: ${presentOptional.join(", ") || "none"}`,
    `Optional sections missing from saved master resume: ${missingOptional.join(", ") || "none"}`,
    `Readable Library sources available for comparison: ${readableSourceCount > 0 ? "yes" : "no"}`,
    "If a missing section is supported by readable source evidence, describe it as a source-to-resume mapping issue in user-facing language. Do not mention database tables, saved snapshots, schema, or pipelines.",
  ].join("\n");
}

export function selectSourceForUserQuestion(
  message: string,
  sources: AdvisorEvidenceSource[],
) {
  const normalizedMessage = normalizeSourceQueryText(message);
  const namedMatch = sources.find((source) => {
    if (!source.original_filename) {
      return false;
    }

    const normalizedName = normalizeSourceQueryText(source.original_filename);
    const normalizedStem = normalizedName
      .replace(/\b(pdf|docx?|txt|csv|zip|png|jpe?g|webp)\b/g, "")
      .trim();

    return (
      normalizedName.length > 0 &&
      (normalizedMessage.includes(normalizedName) ||
        (normalizedStem.length > 3 && normalizedMessage.includes(normalizedStem)))
    );
  });

  if (namedMatch) {
    return namedMatch;
  }

  const asksForPdf = /\bpdf\b/.test(normalizedMessage);
  const asksForDocx = /\bdocx?\b/.test(normalizedMessage);

  if (asksForPdf || asksForDocx) {
    const matchingType = sources.find((source) =>
      asksForPdf ? source.source_type === "pdf" : source.source_type === "docx",
    );

    if (matchingType) {
      return matchingType;
    }
  }

  return sources.find((source) => source.extracted_text?.trim()) ?? sources[0] ?? null;
}

function buildRelevantEvidenceSnippets({
  requestedSections,
  text,
}: {
  requestedSections: string[];
  text: string;
}) {
  const snippets: string[] = [];
  const patterns = requestedSections.length > 0
    ? requestedSections.map((section) => patternForRequestedSection(section))
    : [
        /\b(summary|experience|role|scope|impact|skills?|education|certifications?|languages?|projects?|initiatives?)\b/i,
      ];

  for (const pattern of patterns) {
    const sectionEvidence = findSectionEvidence(text, pattern);
    const sentenceEvidence = splitEvidenceSentences(text)
      .filter((sentence) => pattern.test(sentence))
      .slice(0, 4);

    snippets.push(...sectionEvidence, ...sentenceEvidence);
  }

  if (snippets.length === 0) {
    snippets.push(...splitEvidenceSentences(text).slice(0, 5));
  }

  return Array.from(new Set(snippets.map((item) => item.replace(/\s+/g, " ").trim())))
    .filter((item) => item.length > 0)
    .slice(0, 8)
    .map((item) => item.slice(0, 420));
}

function readRequestedEvidenceAreas(normalized: string) {
  return [
    /\b(special projects?|projects?|initiatives?|portfolio)\b/.test(normalized)
      ? "special projects"
      : null,
    /\b(education|school|degree|university|college)\b/.test(normalized)
      ? "education"
      : null,
    /\b(certifications?|certificates?|licenses?)\b/.test(normalized)
      ? "certifications"
      : null,
    /\b(languages?)\b/.test(normalized) ? "languages" : null,
    /\b(skills?|tools?|technologies)\b/.test(normalized) ? "skills" : null,
    /\b(experience|roles?|work history)\b/.test(normalized) ? "experience" : null,
  ].filter((item): item is string => Boolean(item));
}

function patternForRequestedSection(section: string) {
  if (section === "special projects") {
    return /\b(special projects?|key projects?|selected projects?|projects?|initiatives?|programs?|portfolio|implementation|transformation|launch|rollout)\b/i;
  }

  if (section === "education") {
    return /\b(education|university|college|degree|bachelor|master|mba|school)\b/i;
  }

  if (section === "certifications") {
    return /\b(certification|certificate|license|licensed|credential)\b/i;
  }

  if (section === "languages") {
    return /\b(language|languages|english|arabic|french|spanish|hindi|urdu)\b/i;
  }

  if (section === "skills") {
    return /\b(skills?|tools?|technologies|platforms?|systems?)\b/i;
  }

  return /\b(experience|role|company|work history|professional experience|responsibilities|impact)\b/i;
}

function findSectionEvidence(text: string, headingPattern: RegExp) {
  const match = headingPattern.exec(text);

  if (!match) {
    return [];
  }

  const start = Math.max(0, match.index);
  const excerpt = text.slice(start, Math.min(text.length, start + 1100));

  return splitEvidenceSentences(excerpt).slice(0, 4);
}

function splitEvidenceSentences(text: string) {
  return text
    .replace(/\r/g, "\n")
    .split(/(?<=[.!?])\s+|\n+|•|·|\s-\s/g)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length > 0);
}

function normalizeSourceQueryText(value: string) {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatAdvisorSourceLabel(source: AdvisorEvidenceSource) {
  return source.original_filename ?? source.source_url ?? "that saved source";
}

function formatAdvisorSourceType(type: string) {
  if (type === "pdf") return "PDF";
  if (type === "docx") return "DOCX";
  if (type === "linkedin") return "LinkedIn";
  if (type === "image") return "image";
  if (type === "natural_language") return "note";
  return type.replaceAll("_", " ");
}

function formatAdvisorSourceStatus(status: string) {
  const labels: Record<string, string> = {
    deleted: "removed",
    failed: "needs help",
    pending: "waiting to be read",
    processing: "being read",
    succeeded: "ready",
  };

  return labels[status] ?? status.replace(/_/g, " ");
}

function readResumeSectionSnapshot(latestResume: unknown): ResumeSectionSnapshot {
  if (
    !latestResume ||
    typeof latestResume !== "object" ||
    !("content_json" in latestResume)
  ) {
    return {
      certifications: 0,
      education: 0,
      exists: false,
      experienceSections: 0,
      languages: 0,
      specialProjects: 0,
    };
  }

  const content = (latestResume as { content_json?: unknown }).content_json;
  const readCount = (key: string) => {
    if (!content || typeof content !== "object") {
      return 0;
    }

    const value = (content as Record<string, unknown>)[key];
    return Array.isArray(value) ? value.length : 0;
  };

  return {
    certifications: readCount("certifications"),
    education: readCount("education"),
    exists: true,
    experienceSections: readCount("experienceSections"),
    languages: readCount("languages"),
    specialProjects: readCount("specialProjects"),
  };
}
