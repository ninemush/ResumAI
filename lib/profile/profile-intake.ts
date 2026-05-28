import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import { PROFILE_INTAKE_INSTRUCTIONS, PROFILE_INTAKE_PROMPT_VERSION } from "@/lib/ai/prompts/profile-intake";
import { getOpenAIClient, getProfileIntakeModel } from "@/lib/ai/openai";
import { buildProfileIntelligence } from "@/lib/profile/profile-intelligence";
import { checkProfileIntakeScope } from "@/lib/profile/profile-intake-scope";
import { createClient } from "@/lib/supabase/server";

const profileFactTypeSchema = z.enum([
  "experience",
  "credential",
  "education",
  "skill",
  "accolade",
  "project",
  "industry",
  "preference",
  "other",
]);

const PROFILE_INTAKE_MAX_ATTEMPTS = 3;

export const profileIntakeRequestSchema = z.object({
  message: z.string().trim().min(3).max(4000),
});

const profileIntakeResponseSchema = z.object({
  assistantMessage: z.string().min(1).max(1200),
  facts: z
    .array(
      z.object({
        type: profileFactTypeSchema,
        value: z.string().min(1).max(500),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(24),
  followUpQuestions: z.array(z.string().min(1).max(220)).max(3),
  profileDraft: z.object({
    displayName: z.string().max(120).nullable(),
    headline: z.string().max(180).nullable(),
    summary: z.string().max(900).nullable(),
    targetDirection: z.string().max(240).nullable(),
    targetLevel: z.string().max(120).nullable(),
  }),
  roleRecommendations: z
    .array(
      z.object({
        roleFamily: z.string().min(1).max(160),
        roleTitles: z.array(z.string().min(1).max(120)).max(5),
        seniorityLevel: z.string().max(120).nullable(),
        rationale: z.string().min(1).max(700),
        assumptions: z.array(z.string().min(1).max(180)).max(4),
        openQuestions: z.array(z.string().min(1).max(180)).max(4),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(4),
  suggestedDirection: z.string().max(500).nullable(),
});

export type ProfileIntakeResult = z.infer<typeof profileIntakeResponseSchema> & {
  inScope: boolean;
  savedFactCount: number;
  promptVersion: string;
  model: string;
};

type RunProfileIntakeParams = {
  message: string;
};

type ParsedProfileIntakeResult = z.infer<typeof profileIntakeResponseSchema>;

type ExtractProfileFactsFromTextParams = {
  profileId: string;
  sourceId: string;
  text: string;
  origin: "user_provided" | "imported";
  inputLabel: string;
};

type ExistingProfileContext = {
  conversation: Array<{
    speaker: string;
    text: string;
  }>;
  facts: Array<{
    fact_type: string;
    fact_value: string;
    user_confirmed: boolean;
  }>;
  profile: {
    display_name: string | null;
    headline: string | null;
    summary: string | null;
    target_direction: string | null;
    target_level: string | null;
  } | null;
};

export async function runProfileIntake({
  message,
}: RunProfileIntakeParams): Promise<ProfileIntakeResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const scopeCheck = checkProfileIntakeScope(message);

  if (!scopeCheck.inScope) {
    return {
      inScope: false,
      assistantMessage:
        scopeCheck.capabilityAnswer ??
        scopeCheck.redirectMessage ??
        "I can help with your career profile, resume, role fit, job posts, applications, and interview direction. Share something in that lane and I will help shape it.",
      facts: [],
      followUpQuestions: scopeCheck.capabilityAnswer
        ? []
        : [
            "Would you like to tell me about your recent roles, strongest achievements, or the kind of job you want next?",
          ],
      profileDraft: {
        displayName: null,
        headline: null,
        summary: null,
        targetDirection: null,
        targetLevel: null,
      },
      roleRecommendations: [],
      suggestedDirection: null,
      savedFactCount: 0,
      promptVersion: PROFILE_INTAKE_PROMPT_VERSION,
      model: "scope-gate",
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .upsert({ user_id: user.id }, { onConflict: "user_id" })
    .select("id")
    .single();

  if (profileError || !profile) {
    throw new Error("PROFILE_UPSERT_FAILED");
  }

  const { data: source, error: sourceError } = await supabase
    .from("profile_sources")
    .insert({
      user_id: user.id,
      profile_id: profile.id,
      source_type: "natural_language",
      extracted_text: message,
      extraction_status: "succeeded",
    })
    .select("id")
    .single();

  if (sourceError || !source) {
    throw new Error("PROFILE_SOURCE_INSERT_FAILED");
  }

  return extractProfileFactsFromText({
    profileId: profile.id,
    sourceId: source.id,
    text: message,
    origin: "user_provided",
    inputLabel: "User message",
  });
}

export async function extractProfileFactsFromText({
  profileId,
  sourceId,
  text,
  origin,
  inputLabel,
}: ExtractProfileFactsFromTextParams): Promise<ProfileIntakeResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const normalizedText = text.trim();

  if (normalizedText.length < 3) {
    throw new Error("TEXT_REQUIRED");
  }

  const model = getProfileIntakeModel();
  const existingContext = await readExistingProfileContext({
    profileId,
    userId: user.id,
  });
  let parsed: ParsedProfileIntakeResult;

  try {
    parsed = await runProfileIntakeModel({
      existingContext,
      inputLabel,
      model,
      normalizedText,
      userId: user.id,
    });
  } catch (error) {
    const deterministicResult = buildDeterministicProfileIntakeResult({
      inputLabel,
      text: normalizedText,
    });

    if (deterministicResult.facts.length === 0) {
      parsed = buildAdvisorFallbackResult({
        code: error instanceof Error ? error.message : "AI_PROFILE_INTAKE_FAILED",
        existingContext,
        inputLabel,
        text: normalizedText,
      });
    } else {
      parsed = deterministicResult;
    }
  }
  const existingFactKeys = new Set(
    existingContext.facts.map((fact) => buildFactKey(fact.fact_type, fact.fact_value)),
  );
  const factRows = parsed.facts
    .filter((fact) => {
      const factKey = buildFactKey(fact.type, fact.value);

      if (existingFactKeys.has(factKey)) {
        return false;
      }

      existingFactKeys.add(factKey);
      return true;
    })
    .map((fact) => ({
      user_id: user.id,
      profile_id: profileId,
      fact_type: fact.type,
      fact_value: fact.value,
      origin,
      source_ids: [sourceId],
      confidence: fact.confidence,
      user_confirmed: origin === "user_provided",
    }));

  if (factRows.length > 0) {
    const { error: factsError } = await supabase.from("profile_facts").insert(factRows);

    if (factsError) {
      throw new Error("PROFILE_FACT_INSERT_FAILED");
    }
  }

  await saveProfileDraft({
    profileDraft: parsed.profileDraft,
    profileId,
    roleRecommendations: parsed.roleRecommendations,
    userId: user.id,
  });

  return {
    ...parsed,
    inScope: true,
    savedFactCount: factRows.length,
    promptVersion: PROFILE_INTAKE_PROMPT_VERSION,
    model,
  };
}

function buildProfileIntakeInput({
  existingContext,
  label,
  text,
}: {
  existingContext: ExistingProfileContext;
  label: string;
  text: string;
}) {
  const contextText = formatExistingProfileContext(existingContext, text);

  return `
Existing profile context:
${contextText}

New source to ingest:
${label}:
${text}

Return structured JSON only. Keep the assistantMessage concise, calm, and useful.
Let the assistantMessage sound like a senior talent advisor: include a concrete
hiring-screen, recruiter, ATS, keyword, positioning, or resume-quality
observation when the input gives you enough evidence. Do not give generic praise.
Use the existing profile context to improve continuity, avoid asking for details
the user already gave, and avoid returning duplicate facts. If the new source
corrects or sharpens existing context, reflect that in the draft cautiously.
Use recent conversation context only as continuity support. Treat the new source
as the current user intent.
If useful, include a suggestedDirection, but make it tentative and ask for the
user's acknowledgement before treating it as final.
`.trim();
}

async function runProfileIntakeModel({
  existingContext,
  inputLabel,
  model,
  normalizedText,
  userId,
}: {
  existingContext: ExistingProfileContext;
  inputLabel: string;
  model: string;
  normalizedText: string;
  userId: string;
}) {
  let lastFailureCode = "AI_PROFILE_INTAKE_FAILED";

  for (let attempt = 1; attempt <= PROFILE_INTAKE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await getOpenAIClient().responses.create({
        model,
        instructions: PROFILE_INTAKE_INSTRUCTIONS,
        input: buildProfileIntakeInput({
          existingContext,
          label: inputLabel,
          text: normalizedText,
        }),
        max_output_tokens: 3500,
        metadata: {
          prompt_version: PROFILE_INTAKE_PROMPT_VERSION,
          feature: "profile_intake",
          attempt: String(attempt),
        },
        safety_identifier: hashUserId(userId),
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "profile_intake_result",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: [
                "assistantMessage",
                "facts",
                "followUpQuestions",
                "profileDraft",
                "roleRecommendations",
                "suggestedDirection",
              ],
              properties: {
                assistantMessage: { type: "string" },
                facts: {
                  type: "array",
                  maxItems: 24,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["type", "value", "confidence"],
                    properties: {
                      type: {
                        type: "string",
                        enum: profileFactTypeSchema.options,
                      },
                      value: { type: "string" },
                      confidence: {
                        type: "number",
                        minimum: 0,
                        maximum: 1,
                      },
                    },
                  },
                },
                followUpQuestions: {
                  type: "array",
                  maxItems: 3,
                  items: { type: "string" },
                },
                profileDraft: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "displayName",
                    "headline",
                    "summary",
                    "targetDirection",
                    "targetLevel",
                  ],
                  properties: {
                    displayName: {
                      anyOf: [{ type: "string" }, { type: "null" }],
                    },
                    headline: {
                      anyOf: [{ type: "string" }, { type: "null" }],
                    },
                    summary: {
                      anyOf: [{ type: "string" }, { type: "null" }],
                    },
                    targetDirection: {
                      anyOf: [{ type: "string" }, { type: "null" }],
                    },
                    targetLevel: {
                      anyOf: [{ type: "string" }, { type: "null" }],
                    },
                  },
                },
                roleRecommendations: {
                  type: "array",
                  maxItems: 4,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: [
                      "roleFamily",
                      "roleTitles",
                      "seniorityLevel",
                      "rationale",
                      "assumptions",
                      "openQuestions",
                      "confidence",
                    ],
                    properties: {
                      roleFamily: { type: "string" },
                      roleTitles: {
                        type: "array",
                        maxItems: 5,
                        items: { type: "string" },
                      },
                      seniorityLevel: {
                        anyOf: [{ type: "string" }, { type: "null" }],
                      },
                      rationale: { type: "string" },
                      assumptions: {
                        type: "array",
                        maxItems: 4,
                        items: { type: "string" },
                      },
                      openQuestions: {
                        type: "array",
                        maxItems: 4,
                        items: { type: "string" },
                      },
                      confidence: {
                        type: "number",
                        minimum: 0,
                        maximum: 1,
                      },
                    },
                  },
                },
                suggestedDirection: {
                  anyOf: [{ type: "string" }, { type: "null" }],
                },
              },
            },
          },
          verbosity: "medium",
        },
      });

      if (response.error) {
        lastFailureCode = "AI_PROFILE_INTAKE_PROVIDER_ERROR";
        logProfileIntakeAttemptFailure({ attempt, code: lastFailureCode });
        continue;
      }

      if (response.incomplete_details) {
        lastFailureCode = "AI_PROFILE_INTAKE_INCOMPLETE_RESPONSE";
        logProfileIntakeAttemptFailure({ attempt, code: lastFailureCode });
        continue;
      }

      return parseProfileIntakeOutput(response.output_text);
    } catch (error) {
      lastFailureCode = toProfileIntakeFailureCode(error);
      logProfileIntakeAttemptFailure({ attempt, code: lastFailureCode });
    }
  }

  throw new Error(lastFailureCode);
}

async function readExistingProfileContext({
  profileId,
  userId,
}: {
  profileId: string;
  userId: string;
}): Promise<ExistingProfileContext> {
  const supabase = await createClient();
  const [
    { data: profile, error: profileError },
    { data: facts, error: factsError },
    { data: conversation, error: conversationError },
  ] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("display_name, headline, summary, target_direction, target_level")
        .eq("id", profileId)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("profile_facts")
        .select("fact_type, fact_value, user_confirmed")
        .eq("profile_id", profileId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(80),
      supabase
        .from("conversation_messages")
        .select("speaker, message_text, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  if (profileError || factsError || conversationError) {
    throw new Error("PROFILE_CONTEXT_READ_FAILED");
  }

  return {
    conversation: (conversation ?? [])
      .reverse()
      .map((message) => ({
        speaker: message.speaker,
        text: message.message_text,
      })),
    facts: facts ?? [],
    profile: profile ?? null,
  };
}

function formatExistingProfileContext(
  { conversation, facts, profile }: ExistingProfileContext,
  currentText: string,
) {
  const profileLines = [
    profile?.display_name ? `Name: ${profile.display_name}` : null,
    profile?.headline ? `Headline: ${profile.headline}` : null,
    profile?.summary ? `Summary: ${profile.summary}` : null,
    profile?.target_direction ? `Target direction: ${profile.target_direction}` : null,
    profile?.target_level ? `Target level: ${profile.target_level}` : null,
  ].filter(Boolean);
  const factLines = facts
    .slice(0, 40)
    .map((fact) => `- ${fact.fact_type}: ${fact.fact_value}${fact.user_confirmed ? " (confirmed)" : ""}`);
  const currentTextKey = normalizeContextLine(currentText);
  const conversationLines = conversation
    .filter((message) => normalizeContextLine(message.text) !== currentTextKey)
    .slice(-12)
    .map((message) => `- ${message.speaker}: ${message.text}`);

  if (profileLines.length === 0 && factLines.length === 0 && conversationLines.length === 0) {
    return "No saved profile context yet.";
  }

  return [
    ...profileLines,
    factLines.length > 0 ? "Saved profile facts:" : null,
    ...factLines,
    conversationLines.length > 0 ? "Recent conversation:" : null,
    ...conversationLines,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildFactKey(type: string, value: string) {
  return `${type.trim().toLowerCase()}::${value.trim().replace(/\s+/g, " ").toLowerCase()}`;
}

function toProfileIntakeFailureCode(error: unknown) {
  if (error instanceof SyntaxError || error instanceof z.ZodError) {
    return "AI_PROFILE_INTAKE_SCHEMA_FAILED";
  }

  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : null;

  if (status === 401 || status === 403) {
    return "AI_PROFILE_INTAKE_PROVIDER_AUTH_FAILED";
  }

  if (status === 400 || status === 422) {
    return "AI_PROFILE_INTAKE_PROVIDER_REJECTED_INPUT";
  }

  if (status === 408 || status === 409 || status === 429 || (status !== null && status >= 500)) {
    return "AI_PROFILE_INTAKE_PROVIDER_TEMPORARY_FAILURE";
  }

  return "AI_PROFILE_INTAKE_PROVIDER_UNAVAILABLE";
}

function parseProfileIntakeOutput(outputText: string): ParsedProfileIntakeResult {
  const payload = JSON.parse(outputText) as unknown;
  const sanitized = sanitizeProfileIntakePayload(payload);
  return profileIntakeResponseSchema.parse(sanitized);
}

function sanitizeProfileIntakePayload(payload: unknown): ParsedProfileIntakeResult {
  const record = isRecord(payload) ? payload : {};
  const profileDraft = isRecord(record.profileDraft) ? record.profileDraft : {};

  return {
    assistantMessage: truncateText(
      readString(record.assistantMessage) ||
        "I read the source and pulled out usable career signal for your profile.",
      1200,
    ),
    facts: readArray(record.facts)
      .map((fact) => sanitizeProfileFact(fact))
      .filter((fact): fact is ParsedProfileIntakeResult["facts"][number] => Boolean(fact))
      .slice(0, 24),
    followUpQuestions: readArray(record.followUpQuestions)
      .map((question) => truncateText(readString(question), 220))
      .filter(Boolean)
      .slice(0, 3),
    profileDraft: {
      displayName: truncateNullableText(readStringOrNull(profileDraft.displayName), 120),
      headline: truncateNullableText(readStringOrNull(profileDraft.headline), 180),
      summary: truncateNullableText(readStringOrNull(profileDraft.summary), 900),
      targetDirection: truncateNullableText(readStringOrNull(profileDraft.targetDirection), 240),
      targetLevel: truncateNullableText(readStringOrNull(profileDraft.targetLevel), 120),
    },
    roleRecommendations: readArray(record.roleRecommendations)
      .map((recommendation) => sanitizeRoleRecommendation(recommendation))
      .filter(
        (
          recommendation,
        ): recommendation is ParsedProfileIntakeResult["roleRecommendations"][number] =>
          Boolean(recommendation),
      )
      .slice(0, 4),
    suggestedDirection: truncateNullableText(readStringOrNull(record.suggestedDirection), 500),
  };
}

function sanitizeProfileFact(value: unknown): ParsedProfileIntakeResult["facts"][number] | null {
  if (!isRecord(value)) {
    return null;
  }

  const type = profileFactTypeSchema.safeParse(value.type).success
    ? (value.type as ParsedProfileIntakeResult["facts"][number]["type"])
    : "other";
  const factValue = truncateText(readString(value.value), 500);

  if (!factValue) {
    return null;
  }

  return {
    type,
    value: factValue,
    confidence: clampConfidence(value.confidence),
  };
}

function sanitizeRoleRecommendation(
  value: unknown,
): ParsedProfileIntakeResult["roleRecommendations"][number] | null {
  if (!isRecord(value)) {
    return null;
  }

  const roleFamily = truncateText(readString(value.roleFamily), 160);
  const rationale = truncateText(readString(value.rationale), 700);

  if (!roleFamily || !rationale) {
    return null;
  }

  return {
    roleFamily,
    roleTitles: readArray(value.roleTitles)
      .map((title) => truncateText(readString(title), 120))
      .filter(Boolean)
      .slice(0, 5),
    seniorityLevel: truncateNullableText(readStringOrNull(value.seniorityLevel), 120),
    rationale,
    assumptions: readArray(value.assumptions)
      .map((assumption) => truncateText(readString(assumption), 180))
      .filter(Boolean)
      .slice(0, 4),
    openQuestions: readArray(value.openQuestions)
      .map((question) => truncateText(readString(question), 180))
      .filter(Boolean)
      .slice(0, 4),
    confidence: clampConfidence(value.confidence),
  };
}

function buildDeterministicProfileIntakeResult({
  inputLabel,
  text,
}: {
  inputLabel: string;
  text: string;
}): ParsedProfileIntakeResult {
  const normalizedText = decodeTextEntities(text);
  const lines = readMeaningfulLines(normalizedText);
  const summary = readSectionText(normalizedText, "Summary", [
    "Experience",
    "Activity",
    "Education",
    "Licenses",
    "Skills",
  ]);
  const experience = readSectionText(normalizedText, "Experience", [
    "Education",
    "Licenses",
    "Certifications",
    "Skills",
    "Projects",
  ]);
  const education = readSectionText(normalizedText, "Education", [
    "Licenses",
    "Certifications",
    "Skills",
    "Page ",
  ]);
  const skills = readLinkedInList({
    lines,
    startLabel: "Top Skills",
    stopLabels: ["Languages", "Summary", "Experience", "Education"],
    maxItems: 12,
  });
  const generalSkills = skills.length > 0
    ? skills
    : readLinkedInList({
        lines,
        startLabel: "Skills",
        stopLabels: ["Languages", "Summary", "Experience", "Education"],
        maxItems: 12,
      });
  const languages = readLinkedInList({
    lines,
    startLabel: "Languages",
    stopLabels: ["Summary"],
    maxItems: 6,
  }).filter((language) => !looksLikePersonName(language));
  const header = readLinkedInHeader(lines);
  const experienceHighlights = readExperienceHighlights(experience);
  const facts: ParsedProfileIntakeResult["facts"] = [];
  const contactSignals = readContactSignals(lines);

  addFact(facts, "other", `Name: ${header.displayName}`, 0.96);
  addFact(facts, "experience", header.headline, 0.94);
  addFact(facts, "preference", `Location: ${header.location}`, 0.88);
  addFact(facts, "industry", deriveIndustrySignal(normalizedText), 0.82);
  addFact(facts, "other", summary ? `Profile summary: ${summary}` : null, 0.84);

  for (const contactSignal of contactSignals) {
    addFact(facts, "other", contactSignal, 0.86);
  }

  for (const skill of generalSkills) {
    addFact(facts, "skill", skill, 0.9);
  }

  for (const language of languages) {
    addFact(facts, "skill", `Language: ${language}`, 0.86);
  }

  for (const highlight of experienceHighlights) {
    addFact(facts, "experience", highlight, 0.9);
  }

  for (const educationItem of readEducationHighlights(education)) {
    addFact(facts, "education", educationItem, 0.88);
  }

  for (const credential of readCredentialHighlights(normalizedText)) {
    addFact(facts, "credential", credential, 0.82);
  }

  for (const fallbackHighlight of readGeneralCareerHighlights(normalizedText)) {
    addFact(facts, "experience", fallbackHighlight, 0.78);
  }

  const compactSummary = truncateText(summary || header.headline || "", 900);
  const targetDirection = deriveTargetDirection(normalizedText);
  const targetLevel = deriveTargetLevel(normalizedText);
  const assistantMessage = buildDeterministicIntakeMessage({
    inputLabel,
    normalizedText,
    targetDirection,
  });

  return {
    assistantMessage,
    facts: facts.slice(0, 24),
    followUpQuestions: [
      "Which role lane should I optimize for first based on this profile?",
      "Are there any confidential employers, metrics, or customer details you want softened before resume generation?",
    ],
    profileDraft: {
      displayName: header.displayName,
      headline: header.headline,
      summary: compactSummary || null,
      targetDirection,
      targetLevel,
    },
    roleRecommendations: [
      {
        roleFamily: targetDirection,
        roleTitles: deriveRoleTitles(normalizedText),
        seniorityLevel: targetLevel,
        rationale:
          "The source contains enough career evidence to support an initial positioning read, but Pramania should still verify the highest-value metrics and role focus with the user before locking the master resume.",
        assumptions: [
          "The LinkedIn PDF reflects the user's current preferred positioning.",
          "Imported source text may omit context that would make the resume stronger.",
        ],
        openQuestions: [
          "Which industries or company stages are highest priority?",
          "Which achievements can we quantify with business impact?",
        ],
        confidence: 0.82,
      },
    ],
    suggestedDirection: targetDirection,
  };
}

function buildDeterministicIntakeMessage({
  inputLabel,
  normalizedText,
  targetDirection,
}: {
  inputLabel: string;
  normalizedText: string;
  targetDirection: string;
}) {
  const isUserMessage = /user message|natural language|typed note/i.test(inputLabel);

  if (isUserMessage && /target|role|land|looking|interested|want/i.test(normalizedText)) {
    return `Good, ${targetDirection.toLowerCase()} is a useful starting point. I’ll treat this as your working direction and look for the evidence that makes it credible: scope owned, stakeholders, operating problem, tools or methods, and measurable outcomes. What is the strongest example from your background that proves this lane?`;
  }

  if (isUserMessage) {
    return "That helps. I’m adding this to your profile direction. To make it strong enough for recruiters and ATS screens, let’s attach evidence to it: what role, scope, tools, stakeholders, and outcome should we connect to this?";
  }

  return `I read ${inputLabel} and updated the profile foundation. My current positioning read is ${targetDirection.toLowerCase()}. Before we turn this into resume language, I would verify the strongest metrics, scope, and role focus so the profile feels precise rather than generic.`;
}

function buildAdvisorFallbackResult({
  code,
  existingContext,
  inputLabel,
  text,
}: {
  code: string;
  existingContext: ExistingProfileContext;
  inputLabel: string;
  text: string;
}): ParsedProfileIntakeResult {
  const intelligence = buildProfileIntelligence({
    facts: existingContext.facts.map((fact) => ({
      confidence: null,
      fact_type: fact.fact_type,
      fact_value: fact.fact_value,
    })),
    profile: existingContext.profile ?? {
      display_name: null,
      headline: null,
      summary: null,
      target_direction: null,
      target_level: null,
    },
  });
  const asksForMetrics = /metric|measure|quantif|impact|value|kpi|proof|outcome/i.test(text);
  const gapPrompts = intelligence.highValueGaps
    .filter((gap) => gap.severity !== "informational")
    .slice(0, 4)
    .map((gap) => gap.prompt);
  const proofThemes = intelligence.proofThemes.map((theme) => theme.label.toLowerCase()).slice(0, 4);

  if (asksForMetrics) {
    return {
      assistantMessage: [
        "Yes. For the master resume, I would not ask for random metrics; I would pressure-test the value story around the signals already visible.",
        proofThemes.length > 0
          ? `The current evidence points toward ${proofThemes.join(", ")}.`
          : "The current profile still needs stronger evidence before I can rank the proof themes confidently.",
        "Useful metric families are: revenue or bookings influenced, cost or margin improvement, delivery capacity, cycle-time reduction, adoption or utilization, retention/renewal, customer satisfaction, risk/control improvement, team or regional scale, and executive stakeholder complexity.",
        gapPrompts.length > 0
          ? `Most valuable next questions: ${gapPrompts.join(" ")}`
          : "Next, tell me one initiative you led, the scale, what changed, and how the business was better after it.",
      ].join(" "),
      facts: [],
      followUpQuestions: [
        "Which recent initiative had the clearest business outcome: revenue, cost, customer, risk, speed, or scale?",
      ],
      profileDraft: emptyProfileDraftFromContext(existingContext),
      roleRecommendations: [],
      suggestedDirection: existingContext.profile?.target_direction ?? null,
    };
  }

  return {
    assistantMessage: [
      `I saved ${inputLabel}, but the structured AI analysis needs another pass.`,
      `Root cause: ${code}.`,
      "The source text is preserved, so you should not need to upload it again. I can still use the saved profile context to keep advising while the extraction is retried.",
    ].join(" "),
    facts: [],
    followUpQuestions: [
      "Should I retry extracting profile evidence from the saved source, or use the current profile to draft the master resume first?",
    ],
    profileDraft: emptyProfileDraftFromContext(existingContext),
    roleRecommendations: [],
    suggestedDirection: existingContext.profile?.target_direction ?? null,
  };
}

function addFact(
  facts: ParsedProfileIntakeResult["facts"],
  type: ParsedProfileIntakeResult["facts"][number]["type"],
  value: string | null,
  confidence: number,
) {
  const normalized = truncateText(value ?? "", 500);

  if (!normalized) {
    return;
  }

  const key = buildFactKey(type, normalized);

  if (facts.some((fact) => buildFactKey(fact.type, fact.value) === key)) {
    return;
  }

  facts.push({ type, value: normalized, confidence });
}

function readLinkedInHeader(lines: string[]) {
  const summaryIndex = lines.findIndex((line) => line.toLowerCase() === "summary");
  const headerLines = summaryIndex >= 0 ? lines.slice(0, summaryIndex) : lines.slice(0, 20);
  const location = [...headerLines]
    .reverse()
    .find((line) => /dubai|united arab emirates|uae|remote|hybrid|singapore|india|united states|uk/i.test(line));
  const nameIndex = headerLines.findIndex((line, index) => {
    const nextLine = headerLines[index + 1] ?? "";
    return looksLikePersonName(line) && /executive|leader|director|vice president|vp|chief|head|manager/i.test(nextLine);
  });
  const displayName = nameIndex >= 0 ? headerLines[nameIndex] : null;
  const headline = nameIndex >= 0
    ? headerLines
        .slice(nameIndex + 1)
        .filter((line) => line !== location)
        .join(" ")
    : null;

  return {
    displayName,
    headline: truncateNullableText(headline, 180),
    location: location ?? null,
  };
}

function readContactSignals(lines: string[]) {
  return lines
    .filter((line) => /@|linkedin\.com\/in\//i.test(line))
    .map((line) => (/@/.test(line) ? `Contact email: ${line}` : `LinkedIn profile: ${line}`))
    .slice(0, 3);
}

function readLinkedInList({
  lines,
  startLabel,
  stopLabels,
  maxItems,
}: {
  lines: string[];
  startLabel: string;
  stopLabels: string[];
  maxItems: number;
}) {
  const startIndex = lines.findIndex((line) => line.toLowerCase() === startLabel.toLowerCase());

  if (startIndex < 0) {
    return [];
  }

  const stopSet = new Set(stopLabels.map((label) => label.toLowerCase()));
  const values: string[] = [];

  for (const line of lines.slice(startIndex + 1)) {
    if (stopSet.has(line.toLowerCase())) {
      break;
    }

    if (line.length > 1 && !line.includes("@") && !line.startsWith("www.")) {
      values.push(line);
    }

    if (values.length >= maxItems) {
      break;
    }
  }

  return values;
}

function readExperienceHighlights(experience: string) {
  const lines = readMeaningfulLines(experience);
  const highlights: string[] = [];
  const currentCompany = lines.find((line) => looksLikeCompanyLine(line)) ?? null;
  const currentTitle = lines.find((line) => looksLikeRoleTitle(line));

  if (currentCompany && currentTitle) {
    highlights.push(`${currentTitle} at ${currentCompany}`);
  }

  for (const line of lines) {
    if (looksLikeCareerHighlight(line)) {
      highlights.push(line.replace(/^•\s*/, ""));
    }

    if (highlights.length >= 8) {
      break;
    }
  }

  return highlights;
}

function readGeneralCareerHighlights(text: string) {
  const lines = readMeaningfulLines(text);
  const highlights: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1] ?? "";

    if (looksLikeRoleTitle(line) && nextLine && looksLikeCompanyLine(nextLine)) {
      highlights.push(`${line} at ${nextLine}`);
    }

    if (looksLikeCareerHighlight(line)) {
      highlights.push(line.replace(/^•\s*/, ""));
    }

    if (highlights.length >= 10) {
      break;
    }
  }

  return highlights;
}

function readEducationHighlights(education: string) {
  if (!education) {
    return [];
  }

  const lines = readMeaningfulLines(education).filter((line) => !/^page \d+/i.test(line));
  const highlights: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1] ?? "";

    if (/university|institute|vidyapeeth|college/i.test(line) && nextLine) {
      highlights.push(`${line}: ${nextLine}`);
    }
  }

  return highlights.slice(0, 3);
}

function readCredentialHighlights(text: string) {
  const lines = readMeaningfulLines(text);

  return lines
    .filter((line) =>
      /certified|certification|certificate|license|licence|credential|mba|degree|bachelor|master/i.test(
        line,
      ),
    )
    .slice(0, 5);
}

function readSectionText(text: string, startLabel: string, stopLabels: string[]) {
  const startMatch = new RegExp(`(^|\\n)${escapeRegExp(startLabel)}\\n`, "i").exec(text);

  if (!startMatch || startMatch.index < 0) {
    return "";
  }

  const startIndex = startMatch.index + startMatch[0].length;
  const remainder = text.slice(startIndex);
  const stopIndexes = stopLabels
    .map((label) => new RegExp(`\\n${escapeRegExp(label)}\\n`, "i").exec(remainder)?.index ?? -1)
    .filter((index) => index >= 0);
  const endIndex = stopIndexes.length > 0 ? Math.min(...stopIndexes) : remainder.length;

  return remainder.slice(0, endIndex).trim();
}

function deriveIndustrySignal(text: string) {
  const signals = [
    "Enterprise transformation",
    "Professional services",
    "GTM operations",
    "AI and automation",
    "Digital transformation",
    "Customer success",
  ].filter((signal) => text.toLowerCase().includes(signal.toLowerCase()));

  return signals.length > 0 ? `Industry/domain signals: ${signals.join(", ")}` : null;
}

function deriveTargetDirection(text: string) {
  if (/board advisory|emerging technology|enterprise adoption/i.test(text)) {
    return "Enterprise transformation, AI automation, professional services/GTM leadership, and board advisory";
  }

  if (/gtm|go-to-market|revops|revenue operations|sales ops|sales operations/i.test(text)) {
    return "GTM operations and strategy";
  }

  if (/professional services/i.test(text)) {
    return "Professional services leadership";
  }

  if (/customer success/i.test(text)) {
    return "Customer success leadership";
  }

  return "Career direction to be refined from imported profile evidence";
}

function deriveTargetLevel(text: string) {
  if (/vice president|global vice president|chief information officer|board advisory|executive/i.test(text)) {
    return "Executive / VP and above";
  }

  if (/director|head of/i.test(text)) {
    return "Director and above";
  }

  return null;
}

function deriveRoleTitles(text: string) {
  if (/board advisory|board advisor/i.test(text)) {
    return [
      "Board Advisor",
      "Chief Transformation Officer",
      "VP Enterprise Transformation",
      "AI Transformation Executive",
    ];
  }

  if (/gtm|go-to-market|revops|revenue operations|sales ops|sales operations/i.test(text)) {
    return [
      "Head of GTM Operations",
      "GTM Strategy Lead",
      "Revenue Operations Leader",
      "Sales Operations Strategy Leader",
    ];
  }

  if (/professional services/i.test(text)) {
    return [
      "VP Professional Services",
      "Services Transformation Leader",
      "Professional Services Operations Leader",
      "Client Delivery Executive",
    ];
  }

  if (/customer success/i.test(text)) {
    return [
      "Customer Success Executive",
      "Customer Operations Leader",
      "Post-Sales Strategy Leader",
      "Customer Experience Transformation Leader",
    ];
  }

  if (/product|platform|engineering|technology|cloud|data|ai|automation/i.test(text)) {
    return [
      "Technology Transformation Leader",
      "Product Operations Leader",
      "AI Automation Leader",
      "Digital Transformation Director",
    ];
  }

  return [
    "Career target to refine",
    "Functional leadership role",
    "Transformation leadership role",
  ];
}

function emptyProfileDraftFromContext(existingContext: ExistingProfileContext) {
  return {
    displayName: existingContext.profile?.display_name ?? null,
    headline: existingContext.profile?.headline ?? null,
    summary: existingContext.profile?.summary ?? null,
    targetDirection: existingContext.profile?.target_direction ?? null,
    targetLevel: existingContext.profile?.target_level ?? null,
  };
}

function looksLikeRoleTitle(value: string) {
  return /chief|founder|president|vice president|\bvp\b|director|head|manager|lead|leader|consultant|advisor|officer|architect|engineer|analyst|specialist/i.test(
    value,
  );
}

function looksLikeCompanyLine(value: string) {
  return (
    /^[A-Z][A-Za-z0-9&.,' -]{1,80}$/.test(value.trim()) &&
    !looksLikeRoleTitle(value) &&
    !/summary|experience|education|skills|contact|languages|page \d+/i.test(value)
  );
}

function looksLikeCareerHighlight(value: string) {
  return /•|achieved|accelerated|automated|built|consolidated|created|delivered|drove|enabled|established|grew|improved|increased|instituted|launched|led|managed|optimized|reduced|scaled|saved|transformed/i.test(
    value,
  );
}

function readMeaningfulLines(text: string) {
  return decodeTextEntities(text)
    .split(/\n+/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

function decodeTextEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function looksLikePersonName(value: string) {
  return /^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3}$/.test(value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readStringOrNull(value: unknown) {
  return typeof value === "string" ? value.trim() : null;
}

function truncateText(value: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, " ");

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return normalized.slice(0, maxLength - 1).trimEnd();
}

function truncateNullableText(value: string | null, maxLength: number) {
  if (!value) {
    return null;
  }

  const truncated = truncateText(value, maxLength);
  return truncated || null;
}

function clampConfidence(value: unknown) {
  const confidence = typeof value === "number" && Number.isFinite(value) ? value : 0.75;
  return Math.min(1, Math.max(0, confidence));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function logProfileIntakeAttemptFailure({ attempt, code }: { attempt: number; code: string }) {
  console.warn(
    JSON.stringify({
      event: "profile_intake_attempt_failed",
      attempt,
      maxAttempts: PROFILE_INTAKE_MAX_ATTEMPTS,
      code,
    }),
  );
}

async function saveProfileDraft({
  profileDraft,
  profileId,
  roleRecommendations,
  userId,
}: {
  profileDraft: z.infer<typeof profileIntakeResponseSchema>["profileDraft"];
  profileId: string;
  roleRecommendations: z.infer<typeof profileIntakeResponseSchema>["roleRecommendations"];
  userId: string;
}) {
  const supabase = await createClient();
  const profilePatch = {
    display_name: normalizeOptionalText(profileDraft.displayName),
    headline: normalizeOptionalText(profileDraft.headline),
    summary: normalizeOptionalText(profileDraft.summary),
    target_direction: normalizeOptionalText(profileDraft.targetDirection),
    target_level: normalizeOptionalText(profileDraft.targetLevel),
    profile_status: "needs_review",
  };
  const compactProfilePatch = Object.fromEntries(
    Object.entries(profilePatch).filter(([, value]) => value !== null),
  );

  if (Object.keys(compactProfilePatch).length > 1) {
    const { error: profileError } = await supabase
      .from("profiles")
      .update(compactProfilePatch)
      .eq("id", profileId)
      .eq("user_id", userId);

    if (profileError) {
      throw new Error("PROFILE_DRAFT_UPDATE_FAILED");
    }
  }

  if (roleRecommendations.length === 0) {
    return;
  }

  const { error: clearRecommendationsError } = await supabase
    .from("role_recommendations")
    .delete()
    .eq("profile_id", profileId)
    .eq("user_id", userId)
    .eq("user_acknowledged", false);

  if (clearRecommendationsError) {
    throw new Error("ROLE_RECOMMENDATION_REFRESH_FAILED");
  }

  const recommendationRows = roleRecommendations.map((recommendation) => ({
    user_id: userId,
    profile_id: profileId,
    role_family: recommendation.roleFamily,
    role_titles: recommendation.roleTitles,
    seniority_level: normalizeOptionalText(recommendation.seniorityLevel),
    rationale: recommendation.rationale,
    assumptions: recommendation.assumptions,
    open_questions: recommendation.openQuestions,
    confidence: recommendation.confidence,
  }));

  const { error: recommendationError } = await supabase
    .from("role_recommendations")
    .insert(recommendationRows);

  if (recommendationError) {
    throw new Error("ROLE_RECOMMENDATION_INSERT_FAILED");
  }
}

function normalizeOptionalText(value: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeContextLine(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function hashUserId(userId: string) {
  return createHash("sha256").update(userId).digest("hex").slice(0, 64);
}
