import { z } from "zod";

import { brand } from "@/lib/brand";

export const advisorViewSchema = z.enum([
  "applications",
  "jobs",
  "library",
  "owner",
  "profile",
  "resume",
  "settings",
  "support",
]);

export const advisorSurfaceSchema = z.enum([
  "applications",
  "artifacts",
  "jobs",
  "library",
  "owner",
  "profile",
  "resume",
  "settings",
  "sources",
  "support",
  "unknown",
]);

export const advisorSuggestedLinkSchema = z.object({
  label: z.string().trim().min(1).max(70),
  reason: z.string().trim().min(1).max(180),
  view: advisorViewSchema,
});

export const advisorSuggestedActionSchema = z.object({
  creditCost: z.number().int().nonnegative().nullable(),
  id: z.string().trim().min(1).max(80),
  kind: z.enum(["export", "generate", "navigate", "owner_triage", "redeem", "review", "support", "upload"]),
  label: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(1).max(200),
  view: advisorViewSchema,
});

export type AdvisorSuggestedAction = z.infer<typeof advisorSuggestedActionSchema>;
export type AdvisorSuggestedLink = z.infer<typeof advisorSuggestedLinkSchema>;
export type AdvisorSurface = z.infer<typeof advisorSurfaceSchema>;
export type AdvisorView = z.infer<typeof advisorViewSchema>;

type AppCapability = {
  actionLabel: string;
  creditCost: number | null;
  description: string;
  examples: string[];
  id: string;
  userValue: string;
  view: AdvisorView;
};

export const APP_CAPABILITIES: AppCapability[] = [
  {
    actionLabel: "Review profile",
    creditCost: null,
    description: "Review and edit the user's career profile, target direction, role lanes, photo, and master resume.",
    examples: ["profile", "direction", "target role", "career advice", "what do you know about me"],
    id: "profile_review",
    userValue: `See what ${brand.name} currently believes about your positioning and adjust it.`,
    view: "profile",
  },
  {
    actionLabel: "Open master resume",
    creditCost: null,
    description: "Review, edit, and export the master ATS resume.",
    examples: ["master resume", "ATS resume", "resume structure", "experience section"],
    id: "master_resume",
    userValue: "Turn saved career evidence into the resume foundation used for job-specific versions.",
    view: "resume",
  },
  {
    actionLabel: "Open Library",
    creditCost: null,
    description: "Review uploaded files, source text, screenshots, generated resumes, cover letters, and exports.",
    examples: ["uploaded file", "source", "artifact", "generated doc", "download my upload"],
    id: "library",
    userValue: `Audit what ${brand.name} used and download previous uploads or generated documents.`,
    view: "library",
  },
  {
    actionLabel: "Review jobs",
    creditCost: null,
    description: "Review roles the user provided through job URLs or pasted job text.",
    examples: ["job post", "job URL", "fit", "role under review"],
    id: "jobs",
    userValue: "See fit, gaps, risks, and the next decision for each role.",
    view: "jobs",
  },
  {
    actionLabel: "Open applications",
    creditCost: null,
    description: "Track roles the user chose to pursue, stages, tailored materials, and next follow-up actions.",
    examples: ["application", "status", "interview", "rejected", "follow up", "tailored resume"],
    id: "applications",
    userValue: "Manage the pipeline and download job-specific materials.",
    view: "applications",
  },
  {
    actionLabel: "Open credits",
    creditCost: null,
    description:
      "Review credit balance, usage history, purchase history, receipts, promo codes, password reset, and additional credit packs.",
    examples: [
      "credits",
      "billing",
      "promo",
      "purchase",
      "pricing",
      "invoice",
      "receipt",
      "usage",
      "password reset",
      "forgot password",
    ],
    id: "credits",
    userValue: "Understand remaining credits, see account history, reset access, and top up when needed.",
    view: "settings",
  },
  {
    actionLabel: "Get support",
    creditCost: null,
    description: "Log an issue, view issue status, or ask for help with unexpected behavior.",
    examples: ["support", "bug", "issue", "not working", "error"],
    id: "support",
    userValue: "Get help without repeating context.",
    view: "support",
  },
  {
    actionLabel: "Owner console",
    creditCost: null,
    description: "Owner-only operating metrics, support triage, error root causes, user activity, credits, and profitability.",
    examples: ["owner", "admin", "profitability", "root cause", "users", "console"],
    id: "owner_console",
    userValue: `Operate ${brand.name} with evidence, not guesses.`,
    view: "owner",
  },
];

export function formatCapabilitiesForAdvisor() {
  return APP_CAPABILITIES.map(
    (capability) =>
      `- ${capability.actionLabel} (${capability.view}): ${capability.userValue} Cost: ${
        capability.creditCost === null ? "none" : `${capability.creditCost} credit(s)`
      }. Use when user mentions: ${capability.examples.join(", ")}.`,
  ).join("\n");
}

export function inferSuggestedLinksFromMessage({
  isOwner,
  message,
  surface,
}: {
  isOwner: boolean;
  message: string;
  surface: AdvisorSurface;
}): AdvisorSuggestedLink[] {
  const normalized = message.toLowerCase();
  const matches = APP_CAPABILITIES.filter((capability) => {
    if (capability.view === "owner" && !isOwner) {
      return false;
    }

    return (
      surface === capability.view ||
      capability.examples.some((example) => normalized.includes(example.toLowerCase()))
    );
  });

  return matches.slice(0, 3).map((capability) => ({
    label: capability.actionLabel,
    reason: capability.userValue,
    view: capability.view,
  }));
}
