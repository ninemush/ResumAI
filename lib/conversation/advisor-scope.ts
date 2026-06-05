import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import { createOpenAIResponse } from "@/lib/ai/openai";
import { brand } from "@/lib/brand";
import {
  advisorScopeDecisionValues,
  fallbackAdvisorScopeDecision,
  type AdvisorScopeDecision,
} from "@/lib/conversation/advisor-scope-core";
import type { AdvisorSurface } from "@/lib/conversation/app-capabilities";

const advisorScopeDecisionSchema = z.object({
  decision: z.enum(advisorScopeDecisionValues),
  reason: z.string().min(1).max(300),
  redirectMessage: z.string().max(500).nullable(),
});

export async function runAdvisorScopeClassifier({
  message,
  model,
  surface,
  userId,
}: {
  message: string;
  model: string;
  surface: AdvisorSurface;
  userId: string;
}): Promise<AdvisorScopeDecision> {
  try {
    const response = await createOpenAIResponse({
      model,
      instructions: buildAdvisorScopeInstructions(),
      input: `Current app surface: ${surface}\n\nUser message:\n${message}`,
      max_output_tokens: 250,
      metadata: {
        feature: "conversation_advisor_scope",
        surface,
      },
      safety_identifier: createHash("sha256").update(userId).digest("hex").slice(0, 64),
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "advisor_scope_decision",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["decision", "reason", "redirectMessage"],
            properties: {
              decision: {
                type: "string",
                enum: [...advisorScopeDecisionValues],
              },
              reason: { type: "string" },
              redirectMessage: {
                anyOf: [{ type: "string" }, { type: "null" }],
              },
            },
          },
        },
        verbosity: "low",
      },
    });

    if (response.error || response.incomplete_details) {
      throw new Error("AI_ADVISOR_SCOPE_CLASSIFIER_FAILED");
    }

    return advisorScopeDecisionSchema.parse(JSON.parse(response.output_text));
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "conversation_advisor_scope_fallback",
        code:
          error instanceof Error
            ? error.message
            : "UNKNOWN_ADVISOR_SCOPE_CLASSIFIER_ERROR",
      }),
    );

    return fallbackAdvisorScopeDecision(message);
  }
}

function buildAdvisorScopeInstructions() {
  return `
You are ${brand.name}'s app-purpose classifier. Classify whether a user message
belongs in this app before the full advisor model runs.

Allowed:
- career profile building, resumes, CVs, cover letters, LinkedIn, portfolios
- job posts, role fit, seniority, interviews, applications, recruiter messages
- negotiation prep, workplace communication, leadership, performance, and
  professional writing when tied to work or career outcomes
- uploaded/source files, generated materials, app navigation, account/credits,
  owner/admin/support questions

Blocked:
- recipes, weather, sports, entertainment, trivia, gossip, horoscopes
- coding/homework/general tutoring unless tied to the user's career materials
- crypto/stock tips, personal errands, open-ended companionship, generic poems
- any general-purpose LLM request not tied to work, hiring, or this app

Decisions:
- in_scope: directly about the app, career, hiring, resumes, jobs, applications,
  source files, owner/admin, account, or support
- adjacent_professional: workplace/professional help that could affect career or
  role performance
- capability_question: asks what this app/assistant can do
- model_question: asks what model or AI is used
- out_of_scope: unrelated general LLM use

If out_of_scope, include a short warm redirectMessage. Otherwise redirectMessage
must be null. Return JSON only.
`.trim();
}
