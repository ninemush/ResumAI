import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import { getOpenAIClient, getProfileIntakeModel } from "@/lib/ai/openai";
import { PROFILE_INTAKE_INSTRUCTIONS } from "@/lib/ai/prompts/profile-intake";
import { brand } from "@/lib/brand";
import { buildProfileIntelligence } from "@/lib/profile/profile-intelligence";
import { createClient } from "@/lib/supabase/server";

export const conversationAdvisorRequestSchema = z.object({
  message: z.string().trim().min(3).max(4000),
  surface: z
    .enum(["applications", "artifacts", "jobs", "profile", "resume", "settings", "sources", "unknown"])
    .default("unknown"),
});

const advisorResponseSchema = z.object({
  assistantMessage: z.string().min(1).max(1400),
});

type ConversationFact = {
  confidence: number | null;
  fact_type: string;
  fact_value: string;
};

export async function runConversationAdvisor(
  input: z.infer<typeof conversationAdvisorRequestSchema>,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, headline, summary, target_direction, target_level")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error("PROFILE_READ_FAILED");
  }

  const profileId = profile?.id ?? null;
  const [
    { data: facts, error: factsError },
    { data: conversation, error: conversationError },
    { data: latestResume, error: resumeError },
  ] = await Promise.all([
    profileId
      ? supabase
          .from("profile_facts")
          .select("fact_type, fact_value, confidence")
          .eq("profile_id", profileId)
          .eq("user_id", user.id)
          .order("confidence", { ascending: false })
          .limit(80)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("conversation_messages")
      .select("speaker, message_text, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
    profileId
      ? supabase
          .from("generated_resumes")
          .select("content_json, updated_at")
          .eq("profile_id", profileId)
          .eq("user_id", user.id)
          .eq("resume_type", "master")
          .is("application_id", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (factsError || conversationError || resumeError) {
    throw new Error("ADVISOR_CONTEXT_READ_FAILED");
  }

  const model = getProfileIntakeModel();
  const response = await getOpenAIClient().responses.create({
    model,
    instructions: buildAdvisorInstructions(),
    input: buildAdvisorInput({
      facts: (facts ?? []) as ConversationFact[],
      latestResume,
      message: input.message,
      profile,
      recentConversation: (conversation ?? []).reverse(),
      surface: input.surface,
    }),
    max_output_tokens: 1400,
    metadata: {
      feature: "conversation_advisor",
      surface: input.surface,
    },
    safety_identifier: hashUserId(user.id),
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "conversation_advisor_response",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["assistantMessage"],
          properties: {
            assistantMessage: { type: "string" },
          },
        },
      },
      verbosity: "medium",
    },
  });

  if (response.error || response.incomplete_details) {
    throw new Error("AI_CONVERSATION_ADVISOR_FAILED");
  }

  return advisorResponseSchema.parse(JSON.parse(response.output_text));
}

function buildAdvisorInstructions() {
  return `
${PROFILE_INTAKE_INSTRUCTIONS}

You are answering inside ${brand.name}'s live conversation panel. This is not a
generic chatbot reply. Use the saved profile context, recent conversation, and
current app surface to answer as a senior talent advisor.

Do not expose internal processing language such as "captured signals",
"profile facts", "schema", "source IDs", or "pipeline". Speak naturally.

If the user asks for guidance, give pointed, domain-aware hypotheses and a
small next step. If the profile is thin, say what evidence would unlock better
advice. If the user has provided enough context, do not ask generic questions.

Keep the response concise: usually 2 short paragraphs or 3-5 crisp bullets.
Ask at most one follow-up question unless the user explicitly wants a list.
`.trim();
}

function buildAdvisorInput({
  facts,
  latestResume,
  message,
  profile,
  recentConversation,
  surface,
}: {
  facts: ConversationFact[];
  latestResume: unknown;
  message: string;
  profile: {
    display_name: string | null;
    headline: string | null;
    summary: string | null;
    target_direction: string | null;
    target_level: string | null;
  } | null;
  recentConversation: Array<{ message_text: string; speaker: string }>;
  surface: string;
}) {
  const intelligence = profile
    ? buildProfileIntelligence({
        facts,
        profile,
      })
    : null;

  return `
Current app surface: ${surface}

User message:
${message}

Profile:
- Name: ${profile?.display_name ?? "Not provided"}
- Headline: ${profile?.headline ?? "Not provided"}
- Summary: ${profile?.summary ?? "Not provided"}
- Target direction: ${profile?.target_direction ?? "Not provided"}
- Target level: ${profile?.target_level ?? "Not provided"}

Saved evidence:
${facts.length > 0 ? facts.slice(0, 50).map((fact) => `- ${fact.fact_type}: ${fact.fact_value}`).join("\n") : "No saved evidence yet."}

Profile intelligence:
${intelligence ? `- Evidence strength: ${intelligence.evidenceStrength}
- Role target read: ${intelligence.roleTargetRead}
- Resume focus: ${intelligence.resumeFocus.join(" | ") || "None yet"}
- Proof themes: ${intelligence.proofThemes.map((theme) => `${theme.label}: ${theme.evidence.join(" / ")}`).join("; ") || "None yet"}
- High-value gaps: ${intelligence.highValueGaps.map((gap) => `[${gap.severity}] ${gap.label}: ${gap.prompt}`).join("; ") || "None"}` : "No profile intelligence yet."}

Latest master resume exists: ${latestResume ? "yes" : "no"}

Recent conversation:
${recentConversation.length > 0 ? recentConversation.slice(-12).map((item) => `- ${item.speaker}: ${item.message_text}`).join("\n") : "No recent conversation."}

Return JSON only.
`.trim();
}

function hashUserId(userId: string) {
  return createHash("sha256").update(userId).digest("hex").slice(0, 64);
}
