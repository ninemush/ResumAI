import { brand } from "@/lib/brand";

export type AdvisorContextFact = {
  fact_type: string;
  fact_value: string;
};

export type AdvisorContextProfile = {
  display_name?: string | null;
  headline?: string | null;
  summary?: string | null;
  target_direction?: string | null;
  target_level?: string | null;
} | null;

export type AdvisorContextConversationItem = {
  message_text: string;
  speaker: string;
};

export function buildDeterministicContextualAdvisorReply({
  facts,
  message,
  profile,
  recentConversation,
}: {
  facts: AdvisorContextFact[];
  message: string;
  profile: AdvisorContextProfile;
  recentConversation: AdvisorContextConversationItem[];
}) {
  const normalized = normalizeQuestion(message);

  if (isPreviousPointQuestion(normalized)) {
    const previousAssistantPoint = readPreviousAssistantPoint(recentConversation);

    if (previousAssistantPoint) {
      return `I mean this: ${previousAssistantPoint}\n\nThe practical version is that ${brand.name} should use the evidence already in your workspace, then ask only for the one missing detail that would materially improve the resume or role decision.`;
    }
  }

  if (isKnownContextQuestion(normalized)) {
    return buildKnownContextSummary({ facts, profile });
  }

  return null;
}

export function isPreferenceSaveRequest(message: string) {
  const normalized = normalizeQuestion(message);

  return (
    /\bsave (this )?(resume |writing |format |section |job search |career )?preference\b/.test(normalized) ||
    /\b(my|i want|i prefer|please keep|remember)\b/.test(normalized) &&
      /\b(resume format|writing style|tone|section|sections|language|relocation|work authorization|blocked workflow|frustrat)/.test(normalized)
  );
}

function buildKnownContextSummary({
  facts,
  profile,
}: {
  facts: AdvisorContextFact[];
  profile: AdvisorContextProfile;
}) {
  const grouped = groupFacts(facts);
  const profileLine = [
    profile?.headline,
    profile?.target_direction,
    profile?.target_level,
  ]
    .filter(Boolean)
    .join(" / ");
  const experience = grouped.get("experience")?.slice(0, 3) ?? [];
  const skills = grouped.get("skill")?.slice(0, 6) ?? [];
  const projects = grouped.get("project")?.slice(0, 3) ?? [];
  const preferences = grouped.get("preference")?.slice(0, 4) ?? [];
  const evidenceLines = [
    profileLine ? `- Positioning: ${profileLine}.` : null,
    profile?.summary ? `- Profile summary: ${profile.summary}` : null,
    experience.length > 0 ? `- Experience evidence: ${experience.join("; ")}.` : null,
    skills.length > 0 ? `- Skills: ${skills.join(", ")}.` : null,
    projects.length > 0 ? `- Projects: ${projects.join("; ")}.` : null,
    preferences.length > 0 ? `- Saved preferences: ${preferences.join("; ")}.` : null,
  ].filter(Boolean);

  if (evidenceLines.length === 0) {
    return `I do not have much saved evidence yet. Add a resume, LinkedIn export, profile link, or a few work-history notes and I can summarize your profile instead of giving generic advice.`;
  }

  return [
    "Here is what I can use from your saved workspace right now:",
    "",
    evidenceLines.slice(0, 6).join("\n"),
    "",
    "The useful next move is to keep turning that into role-by-role proof: company, title, dates, scope, and outcomes.",
  ].join("\n");
}

function groupFacts(facts: AdvisorContextFact[]) {
  return facts.reduce<Map<string, string[]>>((groups, fact) => {
    const key = fact.fact_type.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), fact.fact_value]);
    return groups;
  }, new Map());
}

function readPreviousAssistantPoint(recentConversation: AdvisorContextConversationItem[]) {
  const currentUserIndex = findLastIndex(
    recentConversation,
    (item) => item.speaker === "user",
  );
  const beforeCurrent =
    currentUserIndex === -1 ? recentConversation : recentConversation.slice(0, currentUserIndex);
  const previousAssistant = [...beforeCurrent]
    .reverse()
    .find((item) => item.speaker === "assistant" && item.message_text.trim());

  return previousAssistant?.message_text
    .replace(/\s+/g, " ")
    .replace(/\b(What I see|Best lanes|Best next move):/gi, "")
    .trim()
    .slice(0, 360);
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) {
      return index;
    }
  }

  return -1;
}

function isPreviousPointQuestion(normalized: string) {
  return /\b(what do you mean|what did you mean|explain that|explain what you mean|what does that mean|meaning of that)\b/.test(
    normalized,
  );
}

function isKnownContextQuestion(normalized: string) {
  return /\b(what else do you know about me|what do you know about me|what have you learned about me|what did you learn about me|summari[sz]e what you know)\b/.test(
    normalized,
  );
}

function normalizeQuestion(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
