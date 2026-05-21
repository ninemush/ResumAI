import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import { PROFILE_INTAKE_INSTRUCTIONS, PROFILE_INTAKE_PROMPT_VERSION } from "@/lib/ai/prompts/profile-intake";
import { getOpenAIClient, getProfileIntakeModel } from "@/lib/ai/openai";
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
  suggestedDirection: z.string().max(500).nullable(),
});

export type ProfileIntakeResult = z.infer<typeof profileIntakeResponseSchema> & {
  savedFactCount: number;
  promptVersion: string;
  model: string;
};

type RunProfileIntakeParams = {
  message: string;
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

  const model = getProfileIntakeModel();
  const response = await getOpenAIClient().responses.create({
    model,
    instructions: PROFILE_INTAKE_INSTRUCTIONS,
    input: buildProfileIntakeInput(message),
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
    profile_id: profile.id,
    fact_type: fact.type,
    fact_value: fact.value,
    origin: "user_provided",
    source_ids: [source.id],
    confidence: fact.confidence,
    user_confirmed: false,
  }));

  if (factRows.length > 0) {
    const { error: factsError } = await supabase.from("profile_facts").insert(factRows);

    if (factsError) {
      throw new Error("PROFILE_FACT_INSERT_FAILED");
    }
  }

  return {
    ...parsed,
    savedFactCount: factRows.length,
    promptVersion: PROFILE_INTAKE_PROMPT_VERSION,
    model,
  };
}

function buildProfileIntakeInput(message: string) {
  return `
User message:
${message}

Return structured JSON only. Keep the assistantMessage concise, calm, and useful.
If useful, include a suggestedDirection, but make it tentative and ask for the
user's acknowledgement before treating it as final.
`.trim();
}

function hashUserId(userId: string) {
  return createHash("sha256").update(userId).digest("hex").slice(0, 64);
}
