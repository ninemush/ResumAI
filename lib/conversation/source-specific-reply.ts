type AdvisorSourceForReply = {
  extracted_text: string | null;
  extraction_status: string;
  failure_reason?: string | null;
  original_filename: string | null;
  source_type: string;
  source_url: string | null;
};

type SourceReplyLink = {
  label: string;
  reason: string;
  view: "library" | "resume";
};

type SourceSpecificReply = {
  assistantMessage: string;
  suggestedActions: [];
  suggestedLinks: SourceReplyLink[];
};

export function buildSourceSpecificReply({
  message,
  workspace,
}: {
  message: string;
  workspace: { sources: { recent: AdvisorSourceForReply[] } };
}): SourceSpecificReply | null {
  const normalized = normalizeSourceQueryText(message);
  const asksAboutSource =
    /\b(uploaded|source|file|library|pdf|docx|resume|profile)\b/.test(normalized) ||
    workspace.sources.recent.some((source) =>
      source.original_filename
        ? normalized.includes(normalizeSourceQueryText(source.original_filename))
        : false,
    );
  const asksForExtractedEvidence =
    /\b(find|found|see|saw|read|learn|learned|detect|detected|extract|extracted|from|in my|in the)\b/.test(
      normalized,
    );

  if (!asksAboutSource || !asksForExtractedEvidence) {
    return null;
  }

  const source = selectSourceForUserQuestion(message, workspace.sources.recent);

  if (!source) {
    return {
      assistantMessage:
        "I do not see a matching uploaded source in your Library from this question. The best next move is to open Library and confirm the file name, then ask me about that exact file so I can stay grounded in the saved source text.",
      suggestedActions: [],
      suggestedLinks: [
        {
          label: "Open Library",
          reason: "Check the uploaded sources and their readable status.",
          view: "library",
        },
      ],
    };
  }

  const label = formatAdvisorSourceLabel(source);

  if (source.extraction_status !== "succeeded") {
    return {
      assistantMessage: `${label} is saved in your Library, but it has not been read successfully yet. I should not infer special projects or resume sections from an unreadable file.

Best next move: open Library and retry reading the source, or upload a cleaner PDF/DOCX copy if the file is blocked.`,
      suggestedActions: [],
      suggestedLinks: [
        {
          label: "Open Library",
          reason: "Retry source reading or inspect the source status.",
          view: "library",
        },
      ],
    };
  }

  const text = source.extracted_text?.replace(/\s+/g, " ").trim() ?? "";

  if (!text) {
    return {
      assistantMessage: `${label} is marked readable, but I do not have saved text from it to inspect in this chat. I should not invent special projects from an empty source preview.

Best next move: open Library and retry the source read, then rebuild the master resume from the refreshed evidence.`,
      suggestedActions: [],
      suggestedLinks: [
        {
          label: "Open Library",
          reason: "Refresh the readable source text.",
          view: "library",
        },
      ],
    };
  }

  const wantsProjects = /\b(special projects?|projects?|initiatives?|portfolio)\b/.test(normalized);
  const wantsEducation = /\b(education|school|degree|university|college)\b/.test(normalized);
  const wantsCertifications = /\b(certifications?|certificates?|licenses?)\b/.test(normalized);
  const wantsLanguages = /\b(languages?)\b/.test(normalized);

  if (wantsProjects) {
    return buildSourceProjectReply({ label, source, text });
  }

  const evidenceLines = [
    wantsEducation ? findEvidenceSnippet(text, /\b(education|university|college|degree|bachelor|master|mba|school)\b/i) : null,
    wantsCertifications ? findEvidenceSnippet(text, /\b(certification|certificate|license|licensed|credential)\b/i) : null,
    wantsLanguages ? findEvidenceSnippet(text, /\b(language|languages|english|arabic|french|spanish|hindi|urdu)\b/i) : null,
  ].filter((line): line is string => Boolean(line));

  return {
    assistantMessage: `I found and read ${label}. ${evidenceLines.length > 0 ? `The clearest matching evidence I see is: ${evidenceLines.join(" ")}` : "I do not see clear matching evidence for that section in the saved source text."}

Best next move: use this source as evidence, but only add resume sections when the file names the credential, language, education, project, or initiative clearly enough to support it.`,
    suggestedActions: [],
    suggestedLinks: [
      {
        label: "Open Library",
        reason: "Review the source evidence and readable text status.",
        view: "library",
      },
      {
        label: "Open Profile & Resume",
        reason: "Review whether the source evidence belongs in the master resume.",
        view: "resume",
      },
    ],
  };
}

function selectSourceForUserQuestion(message: string, sources: AdvisorSourceForReply[]) {
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

function buildSourceProjectReply({
  label,
  source,
  text,
}: {
  label: string;
  source: AdvisorSourceForReply;
  text: string;
}): SourceSpecificReply {
  const projectEvidence = findProjectEvidence(text);
  const projectLikeSnippet =
    projectEvidence[0] ??
    findEvidenceSnippet(text, /\b(project|initiative|program|portfolio|launch|implementation|transformation)\b/i);
  const sourceType = formatAdvisorSourceType(source.source_type);

  if (projectEvidence.length === 0) {
    return {
      assistantMessage: `I found and read ${label} (${sourceType}), but I do not see a clearly supported Special Projects section in the saved text.

What I see: ${projectLikeSnippet ? `there is project-like wording, for example: ${projectLikeSnippet}` : "the source has career evidence, but not a standalone project or initiative with enough action/context to lift into Special Projects."}

Best next move: I should not invent a Special Projects section from this file. If there is a project you want included, it needs a name, your role/action, context, and ideally an outcome.`,
      suggestedActions: [],
      suggestedLinks: [
        {
          label: "Open Library",
          reason: "Review the source text and confirm what the file supports.",
          view: "library",
        },
        {
          label: "Open Profile & Resume",
          reason: "Review whether the master resume should include supported project evidence.",
          view: "resume",
        },
      ],
    };
  }

  return {
    assistantMessage: `I found and read ${label} (${sourceType}). I do see possible project evidence, but I would treat it carefully and only add it if the source gives enough action/context.

What I see:
${projectEvidence.slice(0, 3).map((item) => `- ${item}`).join("\n")}

Best next move: add a Special Projects entry only for items that have a clear initiative, your action, and enough context to avoid sounding fabricated.`,
    suggestedActions: [],
    suggestedLinks: [
      {
        label: "Open Library",
        reason: "Review the source evidence behind the possible projects.",
        view: "library",
      },
      {
        label: "Open Profile & Resume",
        reason: "Review or edit the master resume project section.",
        view: "resume",
      },
    ],
  };
}

function findProjectEvidence(text: string) {
  const cleanText = text.replace(/\s+/g, " ").trim();
  const candidates = splitEvidenceSentences(cleanText).filter((sentence) => {
    const normalized = sentence.toLowerCase();
    const hasProjectTerm =
      /\b(project|projects|initiative|initiatives|program|programs|portfolio|implementation|transformation|launch|rollout)\b/.test(
        normalized,
      );
    const hasAction =
      /\b(led|owned|built|created|launched|managed|delivered|implemented|designed|developed|coordinated|drove|improved|reduced|increased|scaled|trained|introduced)\b/.test(
        normalized,
      );
    const hasContext =
      /\b(team|client|customer|users|stakeholders|platform|process|system|product|operation|business|market|revenue|cost|risk|timeline|months?|years?|\d+)\b/.test(
        normalized,
      );

    return hasProjectTerm && hasAction && hasContext;
  });
  const section = findSectionEvidence(
    cleanText,
    /\b(special projects?|key projects?|selected projects?|projects?|initiatives?)\b/i,
  );

  return [...section, ...candidates]
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 40)
    .filter(
      (item, index, items) =>
        items.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index,
    )
    .slice(0, 5);
}

function findSectionEvidence(text: string, headingPattern: RegExp) {
  const match = headingPattern.exec(text);

  if (!match) {
    return [];
  }

  const start = Math.max(0, match.index);
  const excerpt = text.slice(start, Math.min(text.length, start + 900));

  return splitEvidenceSentences(excerpt).slice(0, 3);
}

function findEvidenceSnippet(text: string, pattern: RegExp) {
  const sentence = splitEvidenceSentences(text).find((item) => pattern.test(item));

  return sentence ? sentence.replace(/\s+/g, " ").trim().slice(0, 320) : null;
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

function formatAdvisorSourceLabel(source: AdvisorSourceForReply) {
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
