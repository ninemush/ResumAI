import "server-only";

import { createHash } from "node:crypto";

import {
  PROFILE_SOURCE_ANALYSIS_SCHEMA_VERSION,
  parsedProfileSourceSchema,
  type CareerProfileEvidence,
  type ParsedProfileSource,
} from "@/lib/profile/career-profile-schema";
import { createClient } from "@/lib/supabase/server";

export const PROFILE_SOURCE_ANALYSIS_PROMPT_VERSION = "profile-source-analysis.deterministic-v1";
export const PROFILE_SOURCE_ANALYSIS_MODEL = "deterministic-parser-v1";

type AnalyzeProfileSourceInput = {
  label?: string | null;
  profileId: string;
  sourceId: string;
  sourceType: string;
  text: string;
  userId: string;
};

export type AnalyzeProfileSourceResult = {
  analysisId: string;
  parsed: ParsedProfileSource;
};

export async function analyzeProfileSource({
  label,
  profileId,
  sourceId,
  sourceType,
  text,
  userId,
}: AnalyzeProfileSourceInput): Promise<AnalyzeProfileSourceResult> {
  const supabase = await createClient();
  const sourceLabel = label || `${sourceType} source`;
  const { data: started, error: startError } = await supabase
    .from("profile_source_analyses")
    .insert({
      content_json: {},
      model: PROFILE_SOURCE_ANALYSIS_MODEL,
      profile_id: profileId,
      prompt_version: PROFILE_SOURCE_ANALYSIS_PROMPT_VERSION,
      schema_version: PROFILE_SOURCE_ANALYSIS_SCHEMA_VERSION,
      source_id: sourceId,
      status: "analyzing",
      user_id: userId,
    })
    .select("id")
    .single();

  if (startError || !started) {
    throw new Error("PROFILE_SOURCE_ANALYSIS_CREATE_FAILED");
  }

  try {
    const parsed = parsedProfileSourceSchema.parse(
      parseProfileSourceText({
        sourceId,
        sourceLabel,
        sourceType,
        text,
      }),
    );

    const { error: updateError } = await supabase
      .from("profile_source_analyses")
      .update({
        confidence: estimateSourceConfidence(parsed),
        content_json: parsed,
        failure_reason: null,
        status: "analyzed",
        warnings: buildAnalysisWarnings(parsed),
      })
      .eq("id", started.id)
      .eq("user_id", userId);

    if (updateError) {
      throw new Error("PROFILE_SOURCE_ANALYSIS_UPDATE_FAILED");
    }

    return {
      analysisId: started.id,
      parsed,
    };
  } catch (error) {
    await supabase
      .from("profile_source_analyses")
      .update({
        failure_reason: error instanceof Error ? error.message : "PROFILE_SOURCE_ANALYSIS_FAILED",
        status: "analysis_failed",
      })
      .eq("id", started.id)
      .eq("user_id", userId);

    throw error;
  }
}

export function parseProfileSourceText({
  sourceId,
  sourceLabel,
  sourceType,
  text,
}: {
  sourceId: string;
  sourceLabel: string;
  sourceType: string;
  text: string;
}): ParsedProfileSource {
  const normalized = normalizeText(text);
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 600);
  const lower = normalized.toLowerCase();
  const evidence = makeEvidence({
    excerpt: normalized.slice(0, 900),
    sourceId,
    sourceLabel,
    sourceType,
  });

  const sections = readSections(lines);
  const summaryLines = readSection(sections, ["summary", "profile", "about"])
    .filter((line) => !looksLikeContact(line))
    .slice(0, 3);
  const recommendationLines = readSection(sections, [
    "recommendation",
    "recommendations",
    "testimonial",
    "testimonials",
    "endorsement",
    "endorsements",
    "references",
  ]).slice(0, 8);
  const experienceLines = readSection(sections, [
    "experience",
    "professional experience",
    "employment",
    "work history",
  ]);

  return parsedProfileSourceSchema.parse({
    achievements: collectImpactLines(lines).slice(0, 20),
    awards: readSection(sections, ["awards", "honors", "honours"]).slice(0, 20),
    certifications: readSection(sections, ["certifications", "licenses", "licences"]).slice(0, 20),
    contact: {
      email: readEmail(normalized),
      linkedin: readLinkedIn(normalized),
      location: readLikelyLocation(lines),
      phone: readPhone(normalized),
      website: readWebsite(normalized),
    },
    domains: collectDomainSignals(lower),
    education: readSection(sections, ["education"]).slice(0, 20),
    evidence: [evidence],
    extraSections: readExtraSections(sections, sourceId, sourceLabel, sourceType),
    headline: readHeadline(lines),
    identity: {
      currentTitle: readCurrentTitle(lines),
      fullName: readLikelyName(lines),
    },
    languages: readSection(sections, ["languages"]).slice(0, 20),
    metrics: collectMetricLines(lines).slice(0, 20),
    openQuestions: buildOpenQuestions({ experienceLines, lines, recommendationLines }),
    projects: readProjectEntries(sections).slice(0, 20),
    publications: readSection(sections, ["publications", "patents", "courses"]).slice(0, 20),
    recommendations: recommendationLines,
    roles: readRolesFromExperience(experienceLines, [evidence]),
    skills: readSkills(sections, lower).slice(0, 60),
    summaries: summaryLines.length > 0 ? summaryLines : readSummaryFallback(lines),
    targetDirection: readTargetDirection(lines),
    targetLevel: readTargetLevel(lower),
    testimonials: recommendationLines,
    tools: readTools(lower).slice(0, 40),
    volunteering: readSection(sections, ["volunteering", "volunteer"]).slice(0, 20),
  });
}

function normalizeText(text: string) {
  return text
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ \u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 50_000);
}

function makeEvidence({
  excerpt,
  sourceId,
  sourceLabel,
  sourceType,
}: {
  excerpt: string;
  sourceId: string;
  sourceLabel: string;
  sourceType: string;
}): CareerProfileEvidence {
  return {
    confidence: 0.72,
    excerpt,
    factId: null,
    sourceId,
    sourceLabel,
    sourceType,
  };
}

function readSections(lines: string[]) {
  const sections = new Map<string, string[]>();
  let current = "body";

  for (const line of lines) {
    const heading = normalizeHeading(line);

    if (heading) {
      current = heading;
      sections.set(current, sections.get(current) ?? []);
      continue;
    }

    sections.set(current, [...(sections.get(current) ?? []), cleanListLine(line)]);
  }

  return sections;
}

function normalizeHeading(line: string) {
  const stripped = line.replace(/[:\-]+$/, "").trim().toLowerCase();

  if (stripped.length > 40) {
    return null;
  }

  const known = [
    "about",
    "accomplishments",
    "awards",
    "certifications",
    "courses",
    "education",
    "employment",
    "endorsements",
    "experience",
    "honors",
    "honours",
    "languages",
    "licenses",
    "licences",
    "patents",
    "professional experience",
    "profile",
    "key projects",
    "projects",
    "projects and publications",
    "projects/publications",
    "publications",
    "recommendation",
    "recommendations",
    "references",
    "selected projects",
    "skills",
    "summary",
    "testimonial",
    "testimonials",
    "tools",
    "volunteer",
    "volunteering",
    "work history",
  ];

  return known.includes(stripped) ? stripped : null;
}

function readSection(sections: Map<string, string[]>, names: string[]) {
  return names.flatMap((name) => sections.get(name) ?? []).map(cleanListLine).filter(Boolean);
}

function readProjectEntries(sections: Map<string, string[]>) {
  const projectLines = readRawSectionLines(sections, [
    "projects",
    "selected projects",
    "key projects",
    "projects/publications",
    "projects and publications",
  ]);
  const publicationLines = readRawSectionLines(sections, ["publications", "patents"]);

  return dedupe([
    ...parseLinkedInProjectLines(projectLines),
    ...publicationLines.filter((line) => !looksLikeRecommendation(line)),
  ]);
}

function readRawSectionLines(sections: Map<string, string[]>, names: string[]) {
  return names
    .flatMap((name) => sections.get(name) ?? [])
    .map((line) => line.replace(/^[-*•.)\s]+/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function parseLinkedInProjectLines(lines: string[]) {
  const projects: string[] = [];
  let current: {
    context: string | null;
    dates: string | null;
    description: string[];
    name: string;
  } | null = null;

  const flush = () => {
    if (!current) {
      return;
    }

    const description = current.description
      .filter((line) => !looksLikeProjectSkillSummary(line))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const parts = [
      current.name,
      current.dates,
      current.context,
      description,
    ].filter((part): part is string => Boolean(part?.trim()));

    if (parts.length >= 2 && looksLikeStandaloneProjectEvidence(parts.join(" "))) {
      projects.push(parts.join(" | "));
    }
  };

  for (const rawLine of lines) {
    const line = cleanListLine(rawLine);

    if (!line || looksLikeRecommendation(line) || /^show all\b/i.test(line)) {
      continue;
    }

    if (looksLikeProjectDateLine(line)) {
      if (current) {
        current.dates = normalizeProjectDateLine(line);
      }
      continue;
    }

    if (/^associated with\b/i.test(line)) {
      if (current) {
        current.context = line.replace(/^associated with\s*/i, "").trim() || line;
      }
      continue;
    }

    if (
      current &&
      current.description.length > 0 &&
      !looksLikeProjectSkillSummary(line) &&
      looksLikeProjectTitle(line)
    ) {
      flush();
      current = {
        context: null,
        dates: null,
        description: [],
        name: line,
      };
      continue;
    }

    if (!current) {
      current = {
        context: null,
        dates: null,
        description: [],
        name: line,
      };
      continue;
    }

    current.description.push(line);
  }

  flush();

  return projects;
}

function looksLikeProjectDateLine(value: string) {
  return /^(?:19|20)\d{2}\s*[-–—]\s*(?:(?:19|20)\d{2}|present|current)$/i.test(
    value.trim(),
  );
}

function normalizeProjectDateLine(value: string) {
  return value.replace(/\s*[–—]\s*/g, " - ").replace(/\s+/g, " ").trim();
}

function looksLikeProjectSkillSummary(value: string) {
  return /\bskills?\b/i.test(value) || /^[A-Z][A-Za-z -]+(?:,\s*[A-Z][A-Za-z -]+)+(?:\s+and\s+\+\d+\s+skills?)?$/i.test(value.trim());
}

function looksLikeProjectTitle(value: string) {
  return (
    value.length >= 8 &&
    value.length <= 180 &&
    !looksLikeProjectDateLine(value) &&
    !/^associated with\b/i.test(value) &&
    !looksLikeProjectSkillSummary(value)
  );
}

function looksLikeStandaloneProjectEvidence(value: string) {
  const hasActualWork =
    /\b(?:advisory|advisor|advised|worked closely|patent|publication|published|research|incubat(?:ed|ion)|pilot|task force|policy|framework|application|hub|program|project|initiative|strategy|product direction|customer engagement|presales|operating model|automation)\b/i.test(
      value,
    );
  const hasAction =
    /\b(?:worked closely|advised|delivered|built|created|established|incubated|implemented|led|published|patent)\b/i.test(
      value,
    );
  const isOnlyInterest =
    /\b(?:interested in|interests?|seeking|looking for|focused on)\b/i.test(value) &&
    !/\b(?:worked closely|advised|delivered|built|created|established|incubated|implemented|led)\b/i.test(
      value,
    );

  return hasActualWork && hasAction && !isOnlyInterest;
}

function cleanListLine(line: string) {
  const trimmed = line.trim();

  if (/^(?:19|20)\d{2}\s*[-–—]/.test(trimmed)) {
    return trimmed;
  }

  return trimmed.replace(/^[-*•\d.)\s]+/, "").trim();
}

function readEmail(text: string) {
  return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
}

function readPhone(text: string) {
  return text.match(/(?:\+?\d[\d().\-\s]{7,}\d)/)?.[0]?.trim() ?? null;
}

function readLinkedIn(text: string) {
  return text.match(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s)]+/i)?.[0] ?? null;
}

function readWebsite(text: string) {
  return (
    text
      .match(/https?:\/\/[^\s)]+/gi)
      ?.find((url) => !url.toLowerCase().includes("linkedin.com")) ?? null
  );
}

function readLikelyName(lines: string[]) {
  const candidate = lines.find(
    (line) =>
      line.length >= 4 &&
      line.length <= 80 &&
      /^[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,4}$/.test(line) &&
      !normalizeHeading(line),
  );

  return candidate ?? null;
}

function readHeadline(lines: string[]) {
  return (
    lines.find(
      (line) =>
        line.length >= 12 &&
        line.length <= 160 &&
        /\b(manager|director|engineer|consultant|leader|specialist|analyst|designer|founder|executive|advisor|architect|product|finance|operations|marketing|sales|people|hr|talent)\b/i.test(
          line,
        ),
    ) ?? null
  );
}

function readCurrentTitle(lines: string[]) {
  const headline = readHeadline(lines);

  if (!headline) {
    return null;
  }

  return headline.split(/\bat\b/i)[0]?.trim() || headline;
}

function readLikelyLocation(lines: string[]) {
  return (
    lines.find(
      (line) =>
        line.length <= 90 &&
        /\b(remote|united states|usa|uae|dubai|abu dhabi|london|new york|san francisco|riyadh|singapore|canada|india|europe)\b/i.test(
          line,
        ),
    ) ?? null
  );
}

function readSummaryFallback(lines: string[]) {
  return lines
    .filter((line) => line.length > 80 && line.length < 600 && !looksLikeRecommendation(line))
    .slice(0, 2);
}

function readRolesFromExperience(lines: string[], evidence: CareerProfileEvidence[]) {
  const roles: ParsedProfileSource["roles"] = [];
  let current: ParsedProfileSource["roles"][number] | null = null;

  for (const line of lines) {
    if (looksLikeRecommendation(line)) {
      continue;
    }

    const role = parseRoleLine(line);

    if (role) {
      if (current) {
        roles.push(current);
      }

      current = {
        achievements: [],
        company: role.company,
        dates: role.dates,
        evidence,
        location: null,
        responsibilities: [],
        title: role.title,
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (/\b(increased|reduced|grew|saved|launched|led|delivered|built|improved|owned|managed|created|designed)\b/i.test(line)) {
      current.achievements.push(line);
    } else {
      current.responsibilities.push(line);
    }
  }

  if (current) {
    roles.push(current);
  }

  return roles.slice(0, 20);
}

function parseRoleLine(line: string) {
  const compact = line.replace(/\s+/g, " ").trim();

  if (compact.length > 180 || looksLikeRecommendation(compact)) {
    return null;
  }

  const dateMatch = compact.match(/\b(?:19|20)\d{2}\b.*?(?:present|current|(?:19|20)\d{2})?/i);
  const [left, right] = compact.split(/\s+(?:at|@|\||-)\s+/i);

  if (!left || !right || !/\b(manager|director|engineer|consultant|analyst|lead|head|vp|president|specialist|designer|architect|owner|founder|partner|advisor|coordinator|associate)\b/i.test(left)) {
    return null;
  }

  return {
    company: right.replace(dateMatch?.[0] ?? "", "").trim() || null,
    dates: dateMatch?.[0] ?? null,
    title: left.trim(),
  };
}

function readSkills(sections: Map<string, string[]>, lower: string) {
  const sectionSkills = readSection(sections, ["skills", "tools"]).flatMap(splitSkillLine);
  const signalSkills = [
    "account management",
    "analytics",
    "automation",
    "change management",
    "compliance",
    "customer success",
    "data analysis",
    "finance",
    "go-to-market",
    "leadership",
    "operations",
    "product management",
    "program management",
    "project management",
    "sales",
    "strategy",
    "transformation",
  ].filter((skill) => lower.includes(skill));

  return dedupe([...sectionSkills, ...signalSkills]);
}

function splitSkillLine(line: string) {
  return line
    .split(/[,;|]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 80);
}

function readTools(lower: string) {
  return dedupe(
    [
      "Excel",
      "Power BI",
      "Tableau",
      "Salesforce",
      "HubSpot",
      "SQL",
      "Python",
      "JavaScript",
      "TypeScript",
      "React",
      "AWS",
      "Azure",
      "GCP",
      "SAP",
      "Workday",
      "Jira",
    ].filter((tool) => lower.includes(tool.toLowerCase())),
  );
}

function collectDomainSignals(lower: string) {
  return dedupe(
    [
      "AI and automation",
      "B2B SaaS",
      "Finance",
      "Healthcare",
      "Operations",
      "Public sector",
      "Retail",
      "Technology",
    ].filter((domain) => lower.includes(domain.toLowerCase().replace(" and ", " ")) || lower.includes(domain.toLowerCase())),
  );
}

function collectImpactLines(lines: string[]) {
  return lines.filter(
    (line) =>
      !looksLikeRecommendation(line) &&
      /\b(increased|reduced|grew|saved|launched|led|delivered|built|improved|owned|managed|created|designed|achieved|awarded)\b/i.test(
        line,
      ),
  );
}

function collectMetricLines(lines: string[]) {
  return lines.filter((line) => /(?:\d+%|\$\s?\d+|\b\d+(?:,\d{3})+\b|\b\d+\s?(?:m|million|k|thousand)\b)/i.test(line));
}

function readTargetLevel(lower: string) {
  if (/\b(c-suite|chief|executive|vp|vice president)\b/.test(lower)) return "executive";
  if (/\b(director|head of|senior manager)\b/.test(lower)) return "senior leadership";
  if (/\b(manager|lead)\b/.test(lower)) return "manager";
  return null;
}

function readTargetDirection(lines: string[]) {
  return (
    lines
      .find((line) => /\b(target|seeking|looking for|interested in|aiming for)\b/i.test(line))
      ?.replace(/^(target|seeking|looking for|interested in|aiming for)[:\s-]*/i, "")
      .trim() ?? null
  );
}

function readExtraSections(
  sections: Map<string, string[]>,
  sourceId: string,
  sourceLabel: string,
  sourceType: string,
) {
  const known = new Set([
    "about",
    "awards",
    "certifications",
    "courses",
    "education",
    "employment",
    "endorsements",
    "experience",
    "honors",
    "honours",
    "languages",
    "licenses",
    "licences",
    "patents",
    "professional experience",
    "profile",
    "key projects",
    "projects",
    "projects and publications",
    "projects/publications",
    "publications",
    "recommendation",
    "recommendations",
    "references",
    "selected projects",
    "skills",
    "summary",
    "testimonial",
    "testimonials",
    "tools",
    "volunteer",
    "volunteering",
    "work history",
    "body",
  ]);

  return Array.from(sections.entries())
    .filter(([title, items]) => !known.has(title) && items.length > 0)
    .map(([title, items]) => ({
      evidence: [
        makeEvidence({
          excerpt: items.slice(0, 5).join("\n"),
          sourceId,
          sourceLabel,
          sourceType,
        }),
      ],
      items: items.slice(0, 20),
      title,
    }));
}

function buildOpenQuestions({
  experienceLines,
  lines,
  recommendationLines,
}: {
  experienceLines: string[];
  lines: string[];
  recommendationLines: string[];
}) {
  const questions: string[] = [];

  if (experienceLines.length === 0) {
    questions.push("What are the company, title, and date ranges for your main roles?");
  }

  if (collectMetricLines(lines).length === 0) {
    questions.push("Which achievements have measurable impact, such as revenue, cost, time, quality, or scale?");
  }

  if (recommendationLines.length > 0) {
    questions.push("Which recommendations or testimonials, if any, should be kept as proof rather than resume work history?");
  }

  return questions;
}

function buildAnalysisWarnings(parsed: ParsedProfileSource) {
  const warnings: string[] = [];

  if (parsed.roles.length === 0) warnings.push("NO_ROLE_CHRONOLOGY_DETECTED");
  if (parsed.recommendations.length > 0) warnings.push("RECOMMENDATIONS_SEPARATED_FROM_WORK_HISTORY");
  if (parsed.openQuestions.length > 0) warnings.push("OPEN_QUESTIONS_CREATED");

  return warnings;
}

function estimateSourceConfidence(parsed: ParsedProfileSource) {
  let score = 0.35;
  if (parsed.roles.length > 0) score += 0.25;
  if (parsed.skills.length > 0) score += 0.1;
  if (parsed.education.length > 0 || parsed.certifications.length > 0) score += 0.1;
  if (parsed.achievements.length > 0 || parsed.metrics.length > 0) score += 0.15;
  if (parsed.contact.email || parsed.contact.linkedin) score += 0.05;

  return Math.min(0.95, Number(score.toFixed(2)));
}

function looksLikeContact(line: string) {
  return /@|https?:\/\/|\+\d/.test(line);
}

function looksLikeRecommendation(line: string) {
  return /\b(recommendation|testimonial|endorsement|reference|worked with|pleasure|colleague|reported to|managed me|direct report|recommend(?:ed|s)?\b)\b/i.test(
    line,
  );
}

function dedupe(values: string[]) {
  const seen = new Set<string>();

  return values.filter((value) => {
    const normalized = value.trim();
    const key = createHash("sha1").update(normalized.toLowerCase()).digest("hex");

    if (!normalized || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
