import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import { createOpenAIResponse, getProfileIntakeModel } from "@/lib/ai/openai";
import { getOwnerMetrics, type OwnerMetrics } from "@/lib/admin/owner-metrics";
import { getApplicationOverview, type ApplicationOverview } from "@/lib/applications/application-overview";
import { getArtifactOverview, type ArtifactOverview } from "@/lib/artifacts/artifact-overview";
import { CREDIT_COSTS, getCreditSummary, type CreditSummary } from "@/lib/billing/credits";
import { PROFILE_INTAKE_INSTRUCTIONS } from "@/lib/ai/prompts/profile-intake";
import { brand } from "@/lib/brand";
import { getJobOverview, type JobOverview } from "@/lib/jobs/job-overview";
import { buildProfileIntelligence, type ProfileIntelligence } from "@/lib/profile/profile-intelligence";
import { createClient } from "@/lib/supabase/server";
import {
  advisorSuggestedActionSchema,
  advisorSuggestedLinkSchema,
  advisorSurfaceSchema,
  formatCapabilitiesForAdvisor,
  inferSuggestedLinksFromMessage,
} from "@/lib/conversation/app-capabilities";

export const conversationAdvisorRequestSchema = z.object({
  message: z.string().trim().min(3).max(4000),
  surface: advisorSurfaceSchema.default("unknown"),
});

const advisorResponseSchema = z.object({
  assistantMessage: z.string().min(1).max(1500),
  suggestedActions: z.array(advisorSuggestedActionSchema).max(4).default([]),
  suggestedLinks: z.array(advisorSuggestedLinkSchema).max(4).default([]),
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
  failure_reason?: string | null;
  original_filename: string | null;
  source_type: string;
  source_url: string | null;
};

type AdvisorWorkspaceContext = {
  applications: ApplicationOverview | null;
  artifacts: ArtifactOverview | null;
  credits: CreditSummary | null;
  jobs: JobOverview | null;
  sources: {
    recent: AdvisorSource[];
    total: number;
  };
  ownerMetrics: OwnerMetrics | null;
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
    { data: adminRoles, error: adminRolesError },
    { data: facts, error: factsError },
    { data: conversation, error: conversationError },
    { data: latestResume, error: resumeError },
  ] = await Promise.all([
    supabase.from("admin_roles").select("role").eq("user_id", user.id),
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

  if (adminRolesError || factsError || conversationError || resumeError) {
    console.warn(
      JSON.stringify({
        event: "conversation_advisor_partial_context",
        adminRoles: adminRolesError?.message ?? null,
        facts: factsError?.message ?? null,
        conversation: conversationError?.message ?? null,
        resume: resumeError?.message ?? null,
      }),
    );
  }

  const isOwner = (adminRoles ?? []).some(({ role }) => role === "owner" || role === "admin");
  const workspace = await readAdvisorWorkspaceContext({
    includeOwnerMetrics: isOwner && shouldLoadOwnerContext(input),
    profileId,
    userId: user.id,
  });
  const model = getProfileIntakeModel();
  const instructions = buildAdvisorInstructions();
  const inputPayload = buildAdvisorInput({
    facts: factsError ? [] : ((facts ?? []) as ConversationFact[]),
    latestResume: resumeError ? null : latestResume,
    message: input.message,
    profile,
    recentConversation: conversationError ? [] : (conversation ?? []).reverse(),
    surface: input.surface,
    workspace,
  });

  try {
    const response = await createOpenAIResponse({
      model,
      instructions,
      input: inputPayload,
      max_output_tokens: 900,
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
            required: ["assistantMessage", "suggestedActions", "suggestedLinks"],
            properties: {
              assistantMessage: { type: "string" },
              suggestedActions: {
                type: "array",
                maxItems: 4,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["creditCost", "id", "kind", "label", "reason", "view"],
                  properties: {
                    creditCost: {
                      anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }],
                    },
                    id: { type: "string" },
                    kind: {
                      type: "string",
                      enum: ["export", "generate", "navigate", "owner_triage", "redeem", "review", "support", "upload"],
                    },
                    label: { type: "string" },
                    reason: { type: "string" },
                    view: {
                      type: "string",
                      enum: ["applications", "jobs", "library", "owner", "profile", "resume", "settings", "support"],
                    },
                  },
                },
              },
              suggestedLinks: {
                type: "array",
                maxItems: 4,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["label", "reason", "view"],
                  properties: {
                    label: { type: "string" },
                    reason: { type: "string" },
                    view: {
                      type: "string",
                      enum: ["applications", "jobs", "library", "owner", "profile", "resume", "settings", "support"],
                    },
                  },
                },
              },
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
    const normalized = normalizeAdvisorPayload({
      isOwner,
      message: input.message,
      payload: parsed,
      surface: input.surface,
    });

    return normalized;
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "conversation_advisor_model_fallback",
        code: error instanceof Error ? error.message : "UNKNOWN_CONVERSATION_ADVISOR_MODEL_ERROR",
      }),
    );

    const relaxedResponse = await runRelaxedAdvisorAttempt({
      input: inputPayload,
      instructions,
      model,
      surface: input.surface,
      userId: user.id,
    });

    if (relaxedResponse) {
      return normalizeAdvisorPayload({
        isOwner,
        message: input.message,
        payload: {
          assistantMessage: relaxedResponse,
          suggestedActions: [],
          suggestedLinks: [],
        },
        surface: input.surface,
      });
    }

    return normalizeAdvisorPayload({
      isOwner,
      message: input.message,
      payload: {
        assistantMessage: buildContextAwareAdvisorFallback({
        facts: factsError ? [] : ((facts ?? []) as ConversationFact[]),
        latestResume: resumeError ? null : latestResume,
        message: input.message,
        profile,
        workspace,
        }),
        suggestedActions: [],
        suggestedLinks: [],
      },
      surface: input.surface,
    });
  }
}

async function runRelaxedAdvisorAttempt({
  input,
  instructions,
  model,
  surface,
  userId,
}: {
  input: string;
  instructions: string;
  model: string;
  surface: string;
  userId: string;
}) {
  try {
    const response = await createOpenAIResponse({
      model,
      instructions: `${instructions}

Return plain text only. Do not return JSON, markdown tables, or code fences.
Use short paragraphs and bullets only when they make the career advice clearer.`,
      input: stripJsonOnlyInstruction(input),
      max_output_tokens: 900,
      metadata: {
        feature: "conversation_advisor",
        response_mode: "relaxed_text",
        surface,
      },
      safety_identifier: hashUserId(userId),
      store: false,
      text: {
        verbosity: "medium",
      },
    });

    if (response.error || response.incomplete_details || !response.output_text.trim()) {
      return null;
    }

    return normalizeAdvisorMessage(response.output_text);
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "conversation_advisor_relaxed_attempt_failed",
        code: error instanceof Error ? error.message : "UNKNOWN_CONVERSATION_ADVISOR_RELAXED_ERROR",
      }),
    );

    return null;
  }
}

function buildAdvisorInstructions() {
  return `
${PROFILE_INTAKE_INSTRUCTIONS}

You are answering inside ${brand.name}'s live conversation panel. This is not a
generic chatbot reply. Use the saved profile context, recent conversation, and
current app surface to answer as a senior talent advisor.

Do not expose internal processing language, database terms, schema names,
operational counts, or pipeline mechanics. Speak naturally and explain the
practical career value, not the implementation details.

If the user asks for guidance, give pointed, domain-aware hypotheses and a
small next step. If the profile is thin, say what evidence would unlock better
advice. If the user has provided enough context, do not ask generic questions.

You know the user's saved profile, career materials, jobs, applications,
generated resumes and letters, and recent conversation. Never ask the user to
repeat information that appears in that context. If a user challenges you
because you already have their data, acknowledge it directly and use the saved
context.

Keep the response easy to read in a narrow chat panel: no more than 180 words
unless the user explicitly asks for a deeper review. Prefer this structure:
"What I see:" one short paragraph, "Best lanes:" up to 3 bullets, and
"Best next move:" one practical action. Ask at most one follow-up question.
Do not use long numbered lists in chat.

If the user is asking "why", "you already have my information", or challenging a
previous answer, do not treat it as new profile evidence. Answer the concern
directly, apologize briefly if the product fell short, and use the saved context
to give a better answer.

If the user asks what you learned from an uploaded resume, LinkedIn export, PDF,
or source, summarize the concrete career evidence visible in saved context first.
Then explain what should change in the master profile or resume. Do not respond
as though the source cannot be used unless the context truly has no readable
source excerpt.

Do not claim that you have rebuilt, regenerated, saved, exported, logged,
retried, or updated anything unless the current request is being handled by an
actual app command. In this advisor-only route, phrase operational next steps as
"I can rebuild it if you want me to" or "The rebuild should..." rather than "I
will rebuild it" or "I can proceed." Advice must not pretend to be execution.

If the current surface is owner or owner operating metrics are present, answer as
an operational product/support copilot for the owner. Use diagnosed issues,
support tickets, errors, and usage patterns. Be clear about what is actionable in
the owner console: drill into issue groups, review linked tickets/logs, set
status, write user-visible notes, mark fixed, ask for more information, or close no-fix.
Do not pretend to deploy code or apply a product fix unless an actual command has
run.

Pramania can guide users to these exact app areas and actions. Use suggestedLinks
or suggestedActions when it would reduce effort or clarify where the user should
go next. Do not describe navigation vaguely if a precise app surface exists.
Capabilities:
${formatCapabilitiesForAdvisor()}

When returning suggested actions, use them only for navigation, review, support,
upload, generate, export, redeem, or owner triage suggestions. They are not proof
that work has already happened.
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

Saved career context:
${facts.length > 0 ? facts.slice(0, 50).map((fact) => `- ${fact.fact_type}: ${fact.fact_value}`).join("\n") : "No saved evidence yet."}

Profile read:
${intelligence ? `- Context strength: ${intelligence.evidenceStrength}
- Role target read: ${intelligence.roleTargetRead}
- Resume focus: ${intelligence.resumeFocus.join(" | ") || "None yet"}
- Impact themes: ${intelligence.proofThemes.map((theme) => `${theme.label}: ${theme.evidence.join(" / ")}`).join("; ") || "None yet"}
- High-value gaps: ${intelligence.highValueGaps.map((gap) => `[${gap.severity}] ${gap.label}: ${gap.prompt}`).join("; ") || "None"}` : "No profile intelligence yet."}

Latest master resume exists: ${latestResume ? "yes" : "no"}
Latest master resume content:
${formatLatestResumeForAdvisor(latestResume)}

Useful career material:
${formatReadableSourcesForAdvisor(workspace.sources.recent)}

Workspace:
${formatWorkspaceForAdvisor(workspace)}

Owner operations:
${formatOwnerOperationsForAdvisor(workspace.ownerMetrics)}

Recent conversation:
${recentConversation.length > 0 ? recentConversation.slice(-12).map((item) => `- ${item.speaker}: ${item.message_text}`).join("\n") : "No recent conversation."}

Return JSON only.
`.trim();
}

function normalizeAdvisorPayload({
  isOwner,
  message,
  payload,
  surface,
}: {
  isOwner: boolean;
  message: string;
  payload: z.infer<typeof advisorResponseSchema>;
  surface: z.infer<typeof advisorSurfaceSchema>;
}) {
  const suggestedLinks =
    payload.suggestedLinks.length > 0
      ? payload.suggestedLinks
      : inferSuggestedLinksFromMessage({ isOwner, message, surface });

  return {
    assistantMessage: normalizeAdvisorMessage(payload.assistantMessage),
    suggestedActions: payload.suggestedActions,
    suggestedLinks,
  };
}

async function readAdvisorWorkspaceContext({
  includeOwnerMetrics,
  profileId,
  userId,
}: {
  includeOwnerMetrics: boolean;
  profileId: string | null;
  userId: string;
}): Promise<AdvisorWorkspaceContext> {
  const supabase = await createClient();
  const [applications, artifacts, credits, jobs, ownerMetrics, sourceResult] = await Promise.allSettled([
    getApplicationOverview(userId),
    getArtifactOverview(userId),
    getCreditSummary(),
    getJobOverview(userId),
    includeOwnerMetrics ? getOwnerMetrics(30) : Promise.resolve(null),
    profileId
      ? supabase
          .from("profile_sources")
          .select(
            "source_type, source_url, original_filename, extracted_text, extraction_status, failure_reason, created_at",
            { count: "exact" },
          )
          .eq("profile_id", profileId)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(30)
      : Promise.resolve({ count: 0, data: [] as AdvisorSource[], error: null }),
  ]);

  const sourceValue =
    sourceResult.status === "fulfilled" && !sourceResult.value.error
      ? sourceResult.value
      : { count: 0, data: [] };

  return {
    applications: applications.status === "fulfilled" ? applications.value : null,
    artifacts: artifacts.status === "fulfilled" ? artifacts.value : null,
    credits: credits.status === "fulfilled" ? credits.value : null,
    jobs: jobs.status === "fulfilled" ? jobs.value : null,
    ownerMetrics: ownerMetrics.status === "fulfilled" ? ownerMetrics.value : null,
    sources: {
      recent: prioritizeAdvisorSources((sourceValue.data ?? []) as AdvisorSource[]),
      total: sourceValue.count ?? 0,
    },
  };
}

function shouldLoadOwnerContext(input: z.infer<typeof conversationAdvisorRequestSchema>) {
  const normalized = input.message.toLowerCase();

  return (
    input.surface === "owner" ||
    /\b(owner|admin|console|root cause|triage|support ticket|issue|error|fix required|operating|metric|users|logs?)\b/.test(
      normalized,
    )
  );
}

function prioritizeAdvisorSources(sources: AdvisorSource[]) {
  return [...sources]
    .sort((left, right) => readSourceUsefulness(right) - readSourceUsefulness(left))
    .slice(0, 14);
}

function readSourceUsefulness(source: AdvisorSource) {
  const readableLength = source.extracted_text?.trim().length ?? 0;
  const readableScore = Math.min(readableLength / 500, 10);
  const typeScore =
    source.source_type === "linkedin" || source.source_type === "pdf"
      ? 4
      : source.source_type === "docx"
        ? 3
        : source.source_type === "natural_language"
          ? 2
          : 1;
  const statusScore = source.extraction_status === "succeeded" ? 4 : 0;

  return readableScore + typeScore + statusScore;
}

function formatWorkspaceForAdvisor(workspace: AdvisorWorkspaceContext) {
  const creditLines = workspace.credits
    ? [
        `Credits: ${workspace.credits.balance} available, ${workspace.credits.usedCredits} used of ${workspace.credits.totalCredits} total${workspace.credits.warningThreshold ? `, ${workspace.credits.warningThreshold}% usage warning reached` : ""}.`,
        `Credit costs: profile/source reading ${CREDIT_COSTS.profileSourceExtract}; job ingest ${CREDIT_COSTS.jobIngest}; master resume generation ${CREDIT_COSTS.masterResumeGenerate}; master resume export ${CREDIT_COSTS.masterResumeExport}; application materials ${CREDIT_COSTS.applicationMaterialsGenerate}; application export ${CREDIT_COSTS.applicationMaterialsExport}.`,
        `Credit packs: ${workspace.credits.purchaseOptions.map((option) => `${option.label} ${option.credits} credits for $${option.priceUsd}`).join("; ") || "not configured"}.`,
      ]
    : ["Credits: no credit summary was available for this reply."];
  const activeApplications =
    workspace.applications?.recentApplications.filter((application) => !application.archivedAt) ?? [];
  const activeJobs = workspace.jobs?.recentJobs.filter((job) => !job.archived_at) ?? [];
  const applicationLines = workspace.applications
    ? [
        `Applications: ${workspace.applications.summary.active} active, ${workspace.applications.summary.archived} archived, ${workspace.applications.summary.needsReview} drafts/review, ${workspace.applications.summary.applied} applied, ${workspace.applications.summary.interviewing} interviewing, ${workspace.applications.summary.selected} selected.`,
        ...activeApplications.slice(0, 5).map(
          (application) =>
            `- Application: ${application.jobTitle ?? "Untitled role"} at ${application.companyName}; status ${application.status}; latest resume ${application.latestResumeStatus ?? "not generated"}; latest cover letter ${application.latestCoverLetterStatus ?? "not generated"}.`,
        ),
      ]
    : ["Applications: no application records were available for this reply."];
  const jobLines = workspace.jobs
    ? [
        `Jobs: ${workspace.jobs.summary.active} active, ${workspace.jobs.summary.archived} archived, ${workspace.jobs.summary.readyForReview} ready for review, ${workspace.jobs.summary.failed} failed.`,
        ...activeJobs.slice(0, 5).map(
          (job) =>
            `- Job: ${job.title ?? "Untitled role"} at ${job.company ?? "unknown company"}; status ${job.ingestion_status}; review ${job.review_status}; fit ${job.fitSnapshot.score ?? "unknown"}%; matched ${job.fitSnapshot.matchedKeywords.slice(0, 8).join(", ") || "none"}; gaps ${job.fitSnapshot.missingKeywords.slice(0, 8).join(", ") || "none"}.`,
        ),
      ]
    : ["Jobs: no job records were available for this reply."];
  const sourceLines = [
    "Career material Pramania can use:",
    ...workspace.sources.recent.slice(0, 8).map(
      (source) =>
        `- Material: ${source.original_filename ?? source.source_url ?? source.source_type}; kind ${formatAdvisorSourceType(source.source_type)}; read status ${formatAdvisorSourceStatus(source.extraction_status)}; preview ${formatSourceExcerpt(source.extracted_text)}.`,
    ),
  ];
  const artifactLines = workspace.artifacts
    ? [
        `Generated resumes and letters: ${workspace.artifacts.summary.total} total, ${workspace.artifacts.summary.resumes} resumes, ${workspace.artifacts.summary.coverLetters} cover letters, ${workspace.artifacts.summary.exportedPdfs} PDFs, ${workspace.artifacts.summary.exportedDocx} DOCX.`,
        ...workspace.artifacts.artifacts.slice(0, 5).map(
          (artifact) =>
            `- Generated file: ${artifact.label}; format ${formatArtifactKindForAdvisor(artifact.kind)}; status ${artifact.status}; role ${artifact.roleTitle ?? "master/general"}; company ${artifact.companyName ?? "none"}.`,
        ),
      ]
    : ["Generated resumes and letters: no generated material records were available for this reply."];

  return [...creditLines, ...applicationLines, ...jobLines, ...sourceLines, ...artifactLines].join("\n");
}

function formatOwnerOperationsForAdvisor(metrics: OwnerMetrics | null) {
  if (!metrics) {
    return "Owner metrics were not loaded for this reply.";
  }

  const rootCauses = metrics.errorDetails.reduce<Record<string, number>>((counts, error) => {
    counts[error.rootCause] = (counts[error.rootCause] ?? 0) + 1;
    return counts;
  }, {});
  const rootCauseLines = Object.entries(rootCauses)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([rootCause, count]) => `- ${rootCause}: ${count} error event(s)`);
  const tickets = metrics.supportTickets
    .slice(0, 5)
    .map(
      (ticket) =>
        `- ${ticket.id.slice(0, 8).toUpperCase()}: ${ticket.subject}; status ${ticket.status}; fix ${ticket.fixStatus}; root ${ticket.rootCauseCategory}; suggested ${ticket.suggestedFix || "none"}.`,
    );

  return [
    `Period: ${metrics.period.days} days.`,
    `Users: ${metrics.users.totalSignedUp} total, ${metrics.users.newInPeriod} new, ${metrics.users.activeInPeriod} active.`,
    `System health: ${metrics.systemHealth.fixRequired} issues needing owner review, ${metrics.systemHealth.clientErrors} client errors, ${metrics.systemHealth.profileExtractionFailures} source reading failures, ${metrics.systemHealth.jobIngestionFailures} job reading failures.`,
    `Support: ${metrics.support.ticketsOpen} open, ${metrics.support.ticketsEscalated} escalated, ${metrics.support.l1Resolved} L1 resolved.`,
    `Root causes:\n${rootCauseLines.length > 0 ? rootCauseLines.join("\n") : "- none"}`,
    `Recent support tickets:\n${tickets.length > 0 ? tickets.join("\n") : "- none"}`,
  ].join("\n");
}

function formatSourceExcerpt(value: string | null) {
  if (!value?.trim()) {
    return "no preview saved";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, 900);
}

function formatReadableSourcesForAdvisor(sources: AdvisorSource[]) {
  const readableSources = sources
    .filter((source) => source.extracted_text?.trim())
    .slice(0, 6)
    .map((source) => {
      const label = source.original_filename ?? source.source_url ?? source.source_type;
      const excerpt = buildAdvisorSourceExcerpt(source.extracted_text);

      return `- ${label} (${formatAdvisorSourceType(source.source_type)}, ${formatAdvisorSourceStatus(source.extraction_status)}): ${excerpt}`;
    });

  if (readableSources.length > 0) {
    return readableSources.join("\n");
  }

  const failedSources = sources
    .filter((source) => source.extraction_status === "failed")
    .slice(0, 4)
    .map(
      (source) =>
        `- ${source.original_filename ?? source.source_url ?? source.source_type} could not be read yet: ${source.failure_reason ?? "no reason recorded"}`,
    );

  return failedSources.length > 0
    ? `No saved text previews are available. Recent reading issues:\n${failedSources.join("\n")}`
    : "No saved text previews are available.";
}

function buildAdvisorSourceExcerpt(text: string | null) {
  const cleanText = text?.replace(/\s+/g, " ").trim();

  if (!cleanText) {
    return "no preview saved";
  }

  if (cleanText.length <= 2200) {
    return cleanText;
  }

  const windows: Array<{ end: number; start: number }> = [{ start: 0, end: 850 }];
  const sectionPattern =
    /\b(summary|experience|employment|work history|professional experience|projects?|skills?|education|certifications?|licenses?|awards?|honou?rs?|publications?|volunteer|recommendations?)\b/gi;
  let match: RegExpExecArray | null;

  while ((match = sectionPattern.exec(cleanText)) && windows.length < 6) {
    windows.push({
      start: Math.max(0, match.index - 260),
      end: Math.min(cleanText.length, match.index + 1000),
    });
  }

  const merged = windows
    .sort((left, right) => left.start - right.start)
    .reduce<Array<{ end: number; start: number }>>((items, window) => {
      const previous = items.at(-1);

      if (previous && window.start <= previous.end + 100) {
        previous.end = Math.max(previous.end, window.end);
        return items;
      }

      items.push({ ...window });
      return items;
    }, []);

  return merged
    .map((window) => cleanText.slice(window.start, window.end).trim())
    .filter(Boolean)
    .join(" [...] ")
    .slice(0, 3400);
}

function formatLatestResumeForAdvisor(latestResume: unknown) {
  if (!latestResume || typeof latestResume !== "object" || !("content_json" in latestResume)) {
    return "No master resume found.";
  }

  const content = (latestResume as { content_json?: unknown }).content_json;
  if (!content || typeof content !== "object") {
    return "Master resume exists, but its content is not available in a useful format yet.";
  }

  const read = (key: string) => {
    const value = (content as Record<string, unknown>)[key];
    return typeof value === "string" ? value : null;
  };
  const readArray = (key: string) => {
    const value = (content as Record<string, unknown>)[key];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  };
  const contact =
    "contact" in content && content.contact && typeof content.contact === "object"
      ? (content.contact as Record<string, unknown>)
      : {};
  const contactLine = ["email", "phone", "linkedin", "website", "location"]
    .map((key) => contact[key])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" | ");
  const education = Array.isArray((content as Record<string, unknown>).education)
    ? ((content as Record<string, unknown>).education as unknown[])
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const record = item as Record<string, unknown>;
          return [record.credential, record.institution, record.location, record.dates]
            .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
            .join(" | ");
        })
        .filter((item): item is string => Boolean(item))
        .slice(0, 4)
    : [];
  const certifications = Array.isArray((content as Record<string, unknown>).certifications)
    ? ((content as Record<string, unknown>).certifications as unknown[])
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const record = item as Record<string, unknown>;
          return [record.name, record.issuer, record.date]
            .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
            .join(" | ");
        })
        .filter((item): item is string => Boolean(item))
        .slice(0, 5)
    : [];
  const experienceSections = Array.isArray((content as Record<string, unknown>).experienceSections)
    ? ((content as Record<string, unknown>).experienceSections as unknown[])
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const section = item as Record<string, unknown>;
          const roleTitle = typeof section.roleTitle === "string" ? section.roleTitle : null;
          const company = typeof section.company === "string" ? section.company : null;
          const dates = typeof section.dates === "string" ? section.dates : null;
          const bullets = Array.isArray(section.bullets)
            ? section.bullets.filter((bullet): bullet is string => typeof bullet === "string").slice(0, 4)
            : [];

          if (!roleTitle && !company && bullets.length === 0) return null;

          return `${[roleTitle, company].filter(Boolean).join(" at ") || "Role"}${dates ? ` (${dates})` : ""}: ${bullets.join(" / ")}`;
        })
        .filter((item): item is string => Boolean(item))
        .slice(0, 6)
    : [];

  return [
    `- Headline: ${read("headline") ?? "None"}`,
    `- Contact: ${contactLine || "None"}`,
    `- Summary: ${read("summary") ?? "None"}`,
    `- Skills: ${readArray("skills").slice(0, 16).join(", ") || "None"}`,
    `- Role-based experience: ${experienceSections.join(" || ") || "None"}`,
    `- Experience highlights: ${readArray("experienceBullets").slice(0, 8).join(" / ") || "None"}`,
    `- Education: ${education.join(" || ") || "None"}`,
    `- Certifications: ${certifications.join(" || ") || "None"}`,
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
  const impactEvidence = intelligence?.proofThemes
    .flatMap((theme) => theme.evidence)
    .filter(Boolean)
    .slice(0, 5);
  const impactEvidenceFallback = [
    profile?.headline,
    profile?.target_direction,
    profile?.target_level,
  ]
    .filter((item): item is string => Boolean(item?.trim()))
    .join(", ");
  const sourceEvidence = workspace.sources.recent
    .map((source) => formatSourceExcerpt(source.extracted_text))
    .filter((excerpt) => excerpt !== "no preview saved")
    .slice(0, 3);
  const gaps = intelligence?.highValueGaps.slice(0, 4) ?? [];
  const resumeText = formatLatestResumeForAdvisor(latestResume);
  const metricGuidance = buildMetricGuidance({
    facts,
    profile,
    resumeText,
    sources: workspace.sources.recent,
  });

  if (isCreditQuestion(normalized)) {
    return buildCreditAdvisorFallback(workspace.credits);
  }

  if (isTrackingQuestion(normalized)) {
    return buildTrackingAdvisorFallback(workspace);
  }

  if (isNextMoveQuestion(normalized)) {
    return buildNextMoveAdvisorFallback({
      impactEvidence: impactEvidence ?? [],
      impactEvidenceFallback,
      intelligence,
      latestResume,
      profile,
      roleRead,
      workspace,
    });
  }

  if (/\b(vp|executive|senior|board|level)\b/.test(normalized) && /\b(metric|impact|cagr|profit|revenue|margin|scale|percentage)\b/.test(normalized)) {
    const metricClaim = extractMetricClaim(message);

    return `Yes, that can be VP+ level evidence. The issue is not whether the metric is senior enough; it is whether the resume connects it to scope, authority, and business levers.

For ${roleRead}, I would frame ${metricClaim ? `"${metricClaim}"` : "that metric"} around the operating problem, the remit you owned, the levers you controlled, and the business change that followed. A stronger pattern is: "Led [function/scope] through [business situation], delivering [metric/outcome] by changing [levers such as operating model, pricing, portfolio, governance, automation, customer motion, or execution cadence]."`;
  }

  if (normalized.includes("why")) {
    return `You are right to push back. I do have your saved workspace context, so I should not ask you to repeat it.

Based on the current record, the strongest lane is ${roleRead}. The useful missing layer is not more background; it is cleaner resume evidence around ${formatListForSentence(gaps.map((gap) => gap.label), "scope, measurable outcomes, and role focus")}. I should answer from that context first, then ask only for the one detail that would materially improve the result.`;
  }

  if (normalized.includes("metric") || normalized.includes("missing")) {
    return `What I see:
- Your profile does not need generic metrics; it needs evidence tied to scope, authority, and business value.
- For ${roleRead}, I would strengthen ${metricGuidance}.

The evidence already visible includes ${formatListForSentence(impactEvidence ?? [], impactEvidenceFallback || "the strongest saved impact themes in your profile")}. What is missing is not whether those examples are senior enough; it is attaching each one to the role, company, scale, and outcome so the master resume reads as precise rather than broadly senior.`;
  }

  if (normalized.includes("resume") || normalized.includes("profile pdf") || normalized.includes("learn")) {
    return `I have enough saved context to answer without asking you to re-upload. The current master resume shows this snapshot: ${resumeText.replace(/\n/g, " ")}

The files and notes you saved add this useful evidence: ${formatListForSentence(sourceEvidence, "role history, scope, skills, and positioning evidence from your saved materials")}. What I would improve next is the experience architecture: group the evidence by role, attach dates and scope, and turn each role into outcome-led bullets. That is the difference between a senior activity list and a resume that reads like credible executive value.`;
  }

  return `Based on what I already know, I would position you around ${roleRead}. The strongest evidence to preserve is ${formatListForSentence(impactEvidence ?? [], impactEvidenceFallback || "the clearest evidence already saved in your profile")}.

The next best move is to sharpen the master profile into role-based evidence: what you owned, how large it was, what changed, and why it mattered commercially. I will use your saved profile, career materials, jobs, applications, and generated files as context instead of asking you to start over.`;
}

function isCreditQuestion(normalized: string) {
  return /\b(credit|credits|balance|usage|used|cost|costs|paid|price|purchase|buy)\b/.test(normalized);
}

function isTrackingQuestion(normalized: string) {
  return (
    /\b(jobs?|applications?|tracking|pipeline|interviews?|applied|roles?)\b/.test(normalized) &&
    /\b(what|which|tracking|status|show|list|have|am i)\b/.test(normalized)
  );
}

function isNextMoveQuestion(normalized: string) {
  return /\b(next|do next|career advice|advice|recommend|should i do|best move|where should|what should)\b/.test(
    normalized,
  );
}

function buildCreditAdvisorFallback(credits: CreditSummary | null) {
  if (!credits) {
    return "I cannot read the credit ledger right now. Check Settings for the latest balance, purchase packs, and usage history; I should not guess at credits.";
  }

  const warning = credits.warningThreshold
    ? ` You have crossed the ${credits.warningThreshold}% usage threshold, so I would be deliberate about exports and role-specific generations.`
    : "";
  const packs =
    credits.purchaseOptions.map((option) => `${option.label}: ${option.credits} credits for $${option.priceUsd}`).join("; ") ||
    "purchase packs are not configured yet";

  return `You have ${credits.balance} credits available. You have used ${credits.usedCredits} of ${credits.totalCredits} total credits.${warning}

Typical costs are: reading a profile/resume source ${CREDIT_COSTS.profileSourceExtract} credit, ingesting a job ${CREDIT_COSTS.jobIngest} credit, generating a master resume ${CREDIT_COSTS.masterResumeGenerate} credits, exporting a master resume ${CREDIT_COSTS.masterResumeExport} credit, generating application materials ${CREDIT_COSTS.applicationMaterialsGenerate} credits, and exporting application files ${CREDIT_COSTS.applicationMaterialsExport} credit.

Available packs: ${packs}.`;
}

function buildTrackingAdvisorFallback(workspace: AdvisorWorkspaceContext) {
  const applications = workspace.applications?.recentApplications.filter((application) => !application.archivedAt) ?? [];
  const jobs = workspace.jobs?.recentJobs.filter((job) => !job.archived_at) ?? [];

  if (applications.length === 0 && jobs.length === 0) {
    return "You are not actively tracking any jobs or applications yet. The next useful move is to paste a job link into Pramania; I will read it, compare it against your profile, and ask before logging it as an application.";
  }

  const applicationLines = applications
    .slice(0, 4)
    .map(
      (application) =>
        `${application.jobTitle ?? "Untitled role"} at ${application.companyName} is ${application.status}; resume ${application.latestResumeStatus ?? "not generated"}, cover letter ${application.latestCoverLetterStatus ?? "not generated"}`,
    );
  const jobLines = jobs
    .slice(0, 4)
    .map(
      (job) =>
        `${job.title ?? "Untitled role"} at ${job.company ?? "unknown company"} is ${job.review_status}; fit ${job.fitSnapshot.score ?? "unknown"}%`,
    );

  return `Here is what you are tracking right now.

Applications: ${applicationLines.length > 0 ? applicationLines.join("; ") : "none logged yet"}.

Jobs under review: ${jobLines.length > 0 ? jobLines.join("; ") : "none waiting for review"}.

The practical next step is to move any real submitted application out of Draft/Review and keep the status current, because that is how Pramania can help with follow-ups and outcome tracking.`;
}

function buildNextMoveAdvisorFallback({
  impactEvidence,
  impactEvidenceFallback,
  intelligence,
  latestResume,
  profile,
  roleRead,
  workspace,
}: {
  impactEvidence: string[];
  impactEvidenceFallback: string;
  intelligence: ProfileIntelligence | null;
  latestResume: unknown;
  profile: AdvisorProfile | null;
  roleRead: string;
  workspace: AdvisorWorkspaceContext;
}) {
  const resumeText = formatLatestResumeForAdvisor(latestResume);
  const activeApplications = workspace.applications?.summary.active ?? 0;
  const activeJobs = workspace.jobs?.summary.active ?? 0;
  const missing = intelligence?.highValueGaps.map((gap) => gap.label).slice(0, 3) ?? [];
  const evidence = formatListForSentence(
    impactEvidence,
    impactEvidenceFallback || profile?.summary || "the strongest saved profile evidence",
  );

  return `My current read is ${roleRead}. The strongest saved evidence is ${evidence}.

The next best move is to make the master resume undeniable before creating more variants: clean role chronology, clear company/title/dates/location, and two or three high-value outcomes per major role. The current resume snapshot is: ${resumeText.replace(/\n/g, " ")}

After that, use Jobs to compare roles before applying. You currently have ${activeJobs} active job(s) under review and ${activeApplications} active application(s). The highest-value gaps to close are ${formatListForSentence(missing, "scope, measurable outcomes, and role focus")}.`;
}

function formatAdvisorSourceType(type: string) {
  const labels: Record<string, string> = {
    docx: "Word document",
    image: "image",
    linkedin: "LinkedIn profile",
    linkedin_archive: "LinkedIn export",
    natural_language: "note",
    pdf: "PDF",
    profile_link: "profile link",
    text: "text file",
  };

  return labels[type] ?? type.replace(/_/g, " ");
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

function formatArtifactKindForAdvisor(kind: string) {
  const labels: Record<string, string> = {
    cover_letter: "cover letter",
    resume: "resume",
  };

  return labels[kind] ?? kind.replace(/_/g, " ");
}

function stripJsonOnlyInstruction(input: string) {
  return input.replace(/\n+Return JSON only\.\s*$/i, "").trim();
}

function buildMetricGuidance({
  facts,
  profile,
  resumeText,
  sources,
}: {
  facts: ConversationFact[];
  profile: AdvisorProfile | null;
  resumeText: string;
  sources: AdvisorSource[];
}) {
  const corpus = [
    profile?.headline,
    profile?.summary,
    profile?.target_direction,
    profile?.target_level,
    resumeText,
    ...facts.map((fact) => fact.fact_value),
    ...sources.map((source) => source.extracted_text),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  const recommendations: string[] = [];

  if (/\b(gtm|sales|revenue|commercial|pricing|pipeline|services)\b/.test(corpus)) {
    recommendations.push("revenue or bookings influenced, CAGR, margin/profitability movement, pricing or portfolio impact");
  }

  if (/\b(customer|client|success|retention|renewal|adoption|service)\b/.test(corpus)) {
    recommendations.push("customer base served, renewal or retention impact, adoption, CSAT/NPS, time-to-value, escalation reduction");
  }

  if (/\b(operation|delivery|process|capacity|efficiency|cost|governance|execution)\b/.test(corpus)) {
    recommendations.push("cycle-time reduction, delivery capacity, operating cost, productivity, governance cadence, execution quality");
  }

  if (/\b(ai|automation|data|analytics|cloud|platform|api|technology|digital)\b/.test(corpus)) {
    recommendations.push("automation throughput, data/AI use cases shipped, platform scale, integration scope, deployment speed, adoption");
  }

  if (/\b(global|regional|emea|mea|board|vp|executive|p&l|budget|team)\b/.test(corpus)) {
    recommendations.push("team size, geographic scope, budget or P&L exposure, executive stakeholders, decision authority");
  }

  if (recommendations.length === 0) {
    return "revenue, cost, customer, risk, speed, quality, scale, and decision-authority evidence";
  }

  return formatListForSentence(recommendations.slice(0, 4), recommendations[0]);
}

function extractMetricClaim(message: string) {
  const quoted = message.match(/["“](.+?)["”]/)?.[1]?.trim();

  if (quoted && quoted.length <= 260) {
    return quoted;
  }

  const metricSentence = message
    .split(/(?<=[.!?])\s+/)
    .find((sentence) => /\b\d+|%|cagr|revenue|profit|margin|cost|growth|scale|reduced|increased|improved\b/i.test(sentence));

  if (!metricSentence) {
    return null;
  }

  return metricSentence.replace(/\s+/g, " ").trim().slice(0, 260);
}

function formatListForSentence(items: string[], fallback: string) {
  const cleanItems = items.map((item) => item.trim()).filter(Boolean);

  if (cleanItems.length === 0) return fallback;
  if (cleanItems.length === 1) return cleanItems[0];
  if (cleanItems.length === 2) return `${cleanItems[0]} and ${cleanItems[1]}`;

  return `${cleanItems.slice(0, -1).join(", ")}, and ${cleanItems[cleanItems.length - 1]}`;
}

function normalizeAdvisorMessage(message: string) {
  const sectionLabels =
    "What I see|What I learned|What is missing|What to fix first|Best lanes|Strongest lanes|Role lanes|Best next move|Next step|Next question|Why it matters|Recommendation|My recommendation|Conservative|Balanced|Executive\\/board-ready|Board-ready|Headline improvement|Summary clarity|Impact evidence|Proof of impact|Leadership depth|Experience structure|Role fit|Resume impact|Resume fix|Metrics to quantify|Metric to quantify|Missing metrics|Useful evidence|What I would do next";
  const normalized = message
    .replace(/\r\n/g, "\n")
    .replace(/\*\*([^*\n:]{2,80}):\*\*:/g, "**$1:**")
    .replace(/\*\*([^*\n:]{2,80}):\*\*/g, "**$1:**")
    .replace(/\*\*([^*\n]{2,80})\*\*::/g, "**$1:**")
    .replace(/\*\*([^*\n]{2,80})\*\*:/g, "**$1:**")
    .replace(/\b([A-Z][A-Za-z0-9 /&+()'-]{2,54})::/g, "$1:")
    .replace(/^\s{0,3}#{1,6}\s+(.+)$/gm, "$1:")
    .replace(/\s+-\s+(?=(?:\*\*)?[A-Z0-9])/g, "\n- ")
    .replace(
      new RegExp(`([.!?])\\s+((?:${sectionLabels})\\s*:)`, "g"),
      "$1\n\n$2",
    )
    .replace(new RegExp(`\\s+((?:${sectionLabels})\\s*:)`, "g"), "\n\n$1")
    .replace(/(\S)\s+(\*\*[A-Z][^*]{2,64}\*\*:)/g, "$1\n\n$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (normalized.length <= 1050) {
    return normalized;
  }

  const naturalBreak = normalized.lastIndexOf("\n", 1050);
  const sentenceBreak = normalized.lastIndexOf(". ", 1050);
  const cutAt = Math.max(naturalBreak, sentenceBreak);

  return normalized.slice(0, cutAt > 720 ? cutAt + 1 : 1050).trim();
}

function hashUserId(userId: string) {
  return createHash("sha256").update(userId).digest("hex").slice(0, 64);
}
