import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import { PROFILE_INTAKE_INSTRUCTIONS, PROFILE_INTAKE_PROMPT_VERSION } from "@/lib/ai/prompts/profile-intake";
import { getOpenAIClient, getProfileIntakeModel } from "@/lib/ai/openai";
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
    .max(12),
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
    .max(3),
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

type ExtractProfileFactsFromTextParams = {
  profileId: string;
  sourceId: string;
  text: string;
  origin: "user_provided" | "imported";
  inputLabel: string;
};

export async function runProfileIntake({
  message,
}: RunProfileIntakeParams): Promise<ProfileIntakeResult> {
  const scopeCheck = checkProfileIntakeScope(message);

  if (!scopeCheck.inScope) {
    return {
      inScope: false,
      assistantMessage:
        scopeCheck.redirectMessage ??
        "I can help with your career profile, resume, role fit, job posts, applications, and interview direction. Share something in that lane and I will help shape it.",
      facts: [],
      followUpQuestions: [
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
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
  const response = await getOpenAIClient().responses.create({
    model,
    instructions: PROFILE_INTAKE_INSTRUCTIONS,
    input: buildProfileIntakeInput({
      label: inputLabel,
      text: normalizedText,
    }),
    max_output_tokens: 1100,
    metadata: {
      prompt_version: PROFILE_INTAKE_PROMPT_VERSION,
      feature: "profile_intake",
    },
    safety_identifier: hashUserId(user.id),
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
              maxItems: 12,
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
              maxItems: 3,
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

  if (response.error || response.incomplete_details) {
    throw new Error("AI_PROFILE_INTAKE_FAILED");
  }

  const parsed = profileIntakeResponseSchema.parse(JSON.parse(response.output_text));
  const factRows = parsed.facts.map((fact) => ({
    user_id: user.id,
    profile_id: profileId,
    fact_type: fact.type,
    fact_value: fact.value,
    origin,
    source_ids: [sourceId],
    confidence: fact.confidence,
    user_confirmed: false,
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
  label,
  text,
}: {
  label: string;
  text: string;
}) {
  return `
${label}:
${text}

Return structured JSON only. Keep the assistantMessage concise, calm, and useful.
If useful, include a suggestedDirection, but make it tentative and ask for the
user's acknowledgement before treating it as final.
`.trim();
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

function hashUserId(userId: string) {
  return createHash("sha256").update(userId).digest("hex").slice(0, 64);
}
