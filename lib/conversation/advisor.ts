import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import { createOpenAIResponse, getProfileIntakeModel } from "@/lib/ai/openai";
import { getApplicationOverview, type ApplicationOverview } from "@/lib/applications/application-overview";
import { getArtifactOverview, type ArtifactOverview } from "@/lib/artifacts/artifact-overview";
import { PROFILE_INTAKE_INSTRUCTIONS } from "@/lib/ai/prompts/profile-intake";
import { brand } from "@/lib/brand";
import { getJobOverview, type JobOverview } from "@/lib/jobs/job-overview";
import { buildProfileIntelligence } from "@/lib/profile/profile-intelligence";
import { createClient } from "@/lib/supabase/server";

export const conversationAdvisorRequestSchema = z.object({
  message: z.string().trim().min(3).max(4000),
  surface: z
    .enum(["applications", "artifacts", "jobs", "profile", "resume", "settings", "sources", "unknown"])
    .default("unknown"),
});

const advisorResponseSchema = z.object({
  assistantMessage: z.string().min(1).max(2600),
});

type ConversationFact = {
  confidence: number | null;
  fact_type: string;
  fact_value: string;
};

type AdvisorProfile = {
  display_name: string | null;
  headline: string | null;
  summary: string | null;
  target_direction: string | null;
  target_level: string | null;
};

type AdvisorSource = {
  created_at: string;
  extracted_text: string | null;
  extraction_status: string;
  original_filename: string | null;
  source_type: string;
  source_url: string | null;
};

type AdvisorWorkspaceContext = {
  applications: ApplicationOverview | null;
  artifacts: ArtifactOverview | null;
  jobs: JobOverview | null;
  sources: {
    recent: AdvisorSource[];
    total: number;
  };
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
    console.warn(
      JSON.stringify({
        event: "conversation_advisor_partial_context",
        facts: factsError?.message ?? null,
        conversation: conversationError?.message ?? null,
        resume: resumeError?.message ?? null,
      }),
    );
  }

  const workspace = await readAdvisorWorkspaceContext({
    profileId,
    userId: user.id,
  });
  const model = getProfileIntakeModel();

  try {
    const response = await createOpenAIResponse({
      model,
      instructions: buildAdvisorInstructions(),
      input: buildAdvisorInput({
        facts: factsError ? [] : ((facts ?? []) as ConversationFact[]),
        latestResume: resumeError ? null : latestResume,
        message: input.message,
        profile,
        recentConversation: conversationError ? [] : (conversation ?? []).reverse(),
        surface: input.surface,
        workspace,
      }),
      max_output_tokens: 1700,
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

    const parsed = advisorResponseSchema.parse(JSON.parse(response.output_text));

    return {
      assistantMessage: normalizeAdvisorMessage(parsed.assistantMessage),
    };
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "conversation_advisor_model_fallback",
        code: error instanceof Error ? error.message : "UNKNOWN_CONVERSATION_ADVISOR_MODEL_ERROR",
      }),
    );

    return {
      assistantMessage: buildContextAwareAdvisorFallback({
        facts: factsError ? [] : ((facts ?? []) as ConversationFact[]),
        latestResume: resumeError ? null : latestResume,
        message: input.message,
        profile,
        workspace,
      }),
    };
  }
}

function buildAdvisorInstructions() {
  return `
${PROFILE_INTAKE_INSTRUCTIONS}

You are answering inside ${brand.name}'s live conversation panel. This is not a
generic chatbot reply. Use the saved profile context, recent conversation, and
current app surface to answer as a senior talent advisor.

Do not expose internal processing language such as "captured signals",
"profile facts", "schema", "source IDs", "pipeline", or counts of sources/signals.
Speak naturally and explain the practical career value, not the mechanics.

If the user asks for guidance, give pointed, domain-aware hypotheses and a
small next step. If the profile is thin, say what evidence would unlock better
advice. If the user has provided enough context, do not ask generic questions.

You know the user's saved profile, sources, jobs, applications, artifacts, and
recent conversation. Never ask the user to repeat information that appears in
that context. If a user challenges you because you already have their data,
acknowledge it directly and use the saved context.

Keep the response concise: usually 2 short paragraphs or 3-5 crisp bullets.
Ask at most one follow-up question unless the user explicitly wants a list.
You may use simple bullets when they improve clarity. Do not use long numbered
lists in chat. If you use labels, keep them short, like "What I see:" or
"Best next move:".

If the user is asking "why", "you already have my information", or challenging a
previous answer, do not treat it as new profile evidence. Answer the concern
directly, apologize briefly if the product fell short, and use the saved context
to give a better answer.
`.trim();
}

function buildAdvisorInput({
  facts,
  latestResume,
  message,
  profile,
  recentConversation,
  surface,
  workspace,
}: {
  facts: ConversationFact[];
  latestResume: unknown;
  message: string;
  profile: AdvisorProfile | null;
  recentConversation: Array<{ message_text: string; speaker: string }>;
  surface: string;
  workspace: AdvisorWorkspaceContext;
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
Latest master resume content:
${formatLatestResumeForAdvisor(latestResume)}

Workspace:
${formatWorkspaceForAdvisor(workspace)}

Recent conversation:
${recentConversation.length > 0 ? recentConversation.slice(-12).map((item) => `- ${item.speaker}: ${item.message_text}`).join("\n") : "No recent conversation."}

Return JSON only.
`.trim();
}

async function readAdvisorWorkspaceContext({
  profileId,
  userId,
}: {
  profileId: string | null;
  userId: string;
}): Promise<AdvisorWorkspaceContext> {
  const supabase = await createClient();
  const [applications, artifacts, jobs, sourceResult] = await Promise.allSettled([
    getApplicationOverview(userId),
    getArtifactOverview(userId),
    getJobOverview(userId),
    profileId
      ? supabase
          .from("profile_sources")
          .select(
            "source_type, source_url, original_filename, extracted_text, extraction_status, created_at",
            { count: "exact" },
          )
          .eq("profile_id", profileId)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(12)
      : Promise.resolve({ count: 0, data: [] as AdvisorSource[], error: null }),
  ]);

  const sourceValue =
    sourceResult.status === "fulfilled" && !sourceResult.value.error
      ? sourceResult.value
      : { count: 0, data: [] };

  return {
    applications: applications.status === "fulfilled" ? applications.value : null,
    artifacts: artifacts.status === "fulfilled" ? artifacts.value : null,
    jobs: jobs.status === "fulfilled" ? jobs.value : null,
    sources: {
      recent: (sourceValue.data ?? []) as AdvisorSource[],
      total: sourceValue.count ?? 0,
    },
  };
}

function formatWorkspaceForAdvisor(workspace: AdvisorWorkspaceContext) {
  const applicationLines = workspace.applications
    ? [
        `Applications: ${workspace.applications.summary.total} total, ${workspace.applications.summary.needsReview} drafts/review, ${workspace.applications.summary.applied} applied, ${workspace.applications.summary.interviewing} interviewing, ${workspace.applications.summary.selected} selected.`,
        ...workspace.applications.recentApplications.slice(0, 5).map(
          (application) =>
            `- Application: ${application.jobTitle ?? "Untitled role"} at ${application.companyName}; status ${application.status}; latest resume ${application.latestResumeStatus ?? "not generated"}; latest cover letter ${application.latestCoverLetterStatus ?? "not generated"}.`,
        ),
      ]
    : ["Applications: unavailable."];
  const jobLines = workspace.jobs
    ? [
        `Jobs: ${workspace.jobs.summary.identified} saved, ${workspace.jobs.summary.readyForReview} ready for review, ${workspace.jobs.summary.failed} failed.`,
        ...workspace.jobs.recentJobs.slice(0, 5).map(
          (job) =>
            `- Job: ${job.title ?? "Untitled role"} at ${job.company ?? "unknown company"}; status ${job.ingestion_status}; review ${job.review_status}; fit ${job.fitSnapshot.score ?? "unknown"}%; matched ${job.fitSnapshot.matchedKeywords.slice(0, 8).join(", ") || "none"}; gaps ${job.fitSnapshot.missingKeywords.slice(0, 8).join(", ") || "none"}.`,
        ),
      ]
    : ["Jobs: unavailable."];
  const sourceLines = [
    `Sources: ${workspace.sources.total} saved.`,
    ...workspace.sources.recent.slice(0, 8).map(
      (source) =>
        `- Source: ${source.original_filename ?? source.source_url ?? source.source_type}; type ${source.source_type}; extraction ${source.extraction_status}; readable excerpt ${formatSourceExcerpt(source.extracted_text)}.`,
    ),
  ];
  const artifactLines = workspace.artifacts
    ? [
        `Artifacts: ${workspace.artifacts.summary.total} total, ${workspace.artifacts.summary.resumes} resumes, ${workspace.artifacts.summary.coverLetters} cover letters, ${workspace.artifacts.summary.exportedPdfs} PDFs, ${workspace.artifacts.summary.exportedDocx} DOCX.`,
        ...workspace.artifacts.artifacts.slice(0, 5).map(
          (artifact) =>
            `- Artifact: ${artifact.label}; kind ${artifact.kind}; status ${artifact.status}; role ${artifact.roleTitle ?? "master/general"}; company ${artifact.companyName ?? "none"}.`,
        ),
      ]
    : ["Artifacts: unavailable."];

  return [...applicationLines, ...jobLines, ...sourceLines, ...artifactLines].join("\n");
}

function formatSourceExcerpt(value: string | null) {
  if (!value?.trim()) {
    return "not available";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, 900);
}

function formatLatestResumeForAdvisor(latestResume: unknown) {
  if (!latestResume || typeof latestResume !== "object" || !("content_json" in latestResume)) {
    return "No master resume found.";
  }

  const content = (latestResume as { content_json?: unknown }).content_json;
  if (!content || typeof content !== "object") {
    return "Master resume exists, but readable content was not available.";
  }

  const read = (key: string) => {
    const value = (content as Record<string, unknown>)[key];
    return typeof value === "string" ? value : null;
  };
  const readArray = (key: string) => {
    const value = (content as Record<string, unknown>)[key];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  };

  return [
    `- Headline: ${read("headline") ?? "None"}`,
    `- Summary: ${read("summary") ?? "None"}`,
    `- Skills: ${readArray("skills").slice(0, 16).join(", ") || "None"}`,
    `- Experience highlights: ${readArray("experienceBullets").slice(0, 8).join(" / ") || "None"}`,
    `- Gaps: ${readArray("keywordGaps").slice(0, 6).join(" / ") || "None"}`,
  ].join("\n");
}

function buildContextAwareAdvisorFallback({
  facts,
  latestResume,
  message,
  profile,
  workspace,
}: {
  facts: ConversationFact[];
  latestResume: unknown;
  message: string;
  profile: AdvisorProfile | null;
  workspace: AdvisorWorkspaceContext;
}) {
  const intelligence = profile
    ? buildProfileIntelligence({
        facts,
        profile,
      })
    : null;
  const normalized = message.toLowerCase();
  const roleRead =
    profile?.target_direction ||
    intelligence?.roleTargetRead ||
    profile?.headline ||
    "your current target direction";
  const proofThemes = intelligence?.proofThemes
    .flatMap((theme) => theme.evidence)
    .filter(Boolean)
    .slice(0, 5);
  const sourceEvidence = workspace.sources.recent
    .map((source) => formatSourceExcerpt(source.extracted_text))
    .filter((excerpt) => excerpt !== "not available")
    .slice(0, 3);
  const gaps = intelligence?.highValueGaps.slice(0, 4) ?? [];
  const resumeText = formatLatestResumeForAdvisor(latestResume);

  if (normalized.includes("why")) {
    return `You are right to push back. I do have your saved workspace context, so I should not ask you to repeat it.

Based on the current record, the strongest lane is ${roleRead}. The next useful move is to turn the strongest proof into sharper resume evidence, especially around ${formatListForSentence(gaps.map((gap) => gap.label), "scope, measurable outcomes, and role focus")}.`;
  }

  if (normalized.includes("metric") || normalized.includes("missing")) {
    return `What I see:
- Your profile does not need generic metrics; it needs executive-grade proof tied to scope and business value.
- For ${roleRead}, I would strengthen revenue owned or influenced, margin or profitability movement, customer/portfolio scale, regional or team scope, before-and-after operating improvements, and decision authority.

The proof already visible includes ${formatListForSentence(proofThemes ?? [], "transformation, GTM/services leadership, operations, AI/automation, and P&L-adjacent work")}. What is missing is not whether those examples are VP+ level; it is attaching each one to the role, company, scale, and outcome so the master resume reads as board-ready rather than broadly senior.`;
  }

  if (normalized.includes("resume") || normalized.includes("profile pdf") || normalized.includes("learn")) {
    return `I have enough saved context to answer without asking you to re-upload. The current master resume shows this snapshot: ${resumeText.replace(/\n/g, " ")}

The saved source material adds this useful evidence: ${formatListForSentence(sourceEvidence, "role history, scope, skills, and positioning evidence from the uploaded source")}. What I would improve next is the experience architecture: group the proof by role, attach dates and scope, and turn each role into outcome-led bullets. That is the difference between a senior activity list and a resume that reads like credible executive value.`;
  }

  return `Based on what I already know, I would position you around ${roleRead}. The strongest evidence to preserve is ${formatListForSentence(proofThemes ?? [], "enterprise transformation, services/GTM leadership, operations, AI/automation, and measurable business outcomes")}.

The next best move is to sharpen the master profile into role-based proof: what you owned, how large it was, what changed, and why it mattered commercially. I will use your saved profile, sources, jobs, applications, and artifacts as context instead of asking you to start over.`;
}

function formatListForSentence(items: string[], fallback: string) {
  const cleanItems = items.map((item) => item.trim()).filter(Boolean);

  if (cleanItems.length === 0) return fallback;
  if (cleanItems.length === 1) return cleanItems[0];
  if (cleanItems.length === 2) return `${cleanItems[0]} and ${cleanItems[1]}`;

  return `${cleanItems.slice(0, -1).join(", ")}, and ${cleanItems[cleanItems.length - 1]}`;
}

function normalizeAdvisorMessage(message: string) {
  const normalized = message
    .replace(/\r\n/g, "\n")
    .replace(/^\s{0,3}#{1,6}\s+(.+)$/gm, "$1:")
    .replace(/\s+-\s+(?=(?:\*\*)?[A-Z0-9])/g, "\n- ")
    .replace(
      /([.!?])\s+((?:What I see|What I learned|What is missing|Best next move|Next step|Why it matters|Recommendation|My recommendation):)/g,
      "$1\n\n$2",
    )
    .replace(/(\S)\s+(\*\*[A-Z][^*]{2,64}\*\*:)/g, "$1\n\n$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (normalized.length <= 1500) {
    return normalized;
  }

  const naturalBreak = normalized.lastIndexOf("\n", 1500);
  const sentenceBreak = normalized.lastIndexOf(". ", 1500);
  const cutAt = Math.max(naturalBreak, sentenceBreak);

  return `${normalized.slice(0, cutAt > 900 ? cutAt + 1 : 1500).trim()} I can keep going from here.`;
}

function hashUserId(userId: string) {
  return createHash("sha256").update(userId).digest("hex").slice(0, 64);
}
