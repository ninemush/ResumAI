"use client";

import {
  AlertTriangle,
  BarChart3,
  BriefcaseBusiness,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Activity,
  ClipboardCheck,
  Download,
  ExternalLink,
  FileText,
  Gauge,
  HeartHandshake,
  RefreshCcw,
  Search,
  ShieldCheck,
  Wrench,
  UsersRound,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState, useTransition } from "react";

import {
  countActionableComplianceItems,
  countAvailabilityPlatformIssues,
  countCleanupPlatformItems,
  computePromoCodeState,
  formatAdminRootCauseLabel,
  getUserAttentionSignals,
  groupPrivacyRequestsById,
  promoNeedsOwnerAction,
  summarizeOutcomePatternWithSample,
  supportTicketNeedsOwnerAction,
  userMatchesAdminQuickFilter,
  type AdminUserQuickFilter,
} from "@/lib/admin/command-center";
import type { OwnerMetrics } from "@/lib/admin/owner-metrics";
import type { PlatformStatusOverview } from "@/lib/admin/platform-status";
import { brand } from "@/lib/brand";
import type { ComplianceDashboard } from "@/lib/privacy/compliance-dashboard";
import {
  buildRootCauseGroups,
  buildRootCauseKey,
  readRootCauseQueueStatus,
  type RootCauseGroup,
} from "@/lib/support/root-cause-groups";

type OwnerConsoleProps = {
  metrics: OwnerMetrics;
};

type PromoCodeRow = {
  assignedUserEmail: string | null;
  code: string;
  createdAt: string;
  creditAmount: number;
  description: string;
  expiresAt: string | null;
  id: string;
  isActive: boolean;
  maxRedemptions: number;
  redeemedCount: number;
};

type CreditGrant = {
  createdAt: string;
  creditAmount: number;
  description: string;
  id: string;
  userEmail: string | null;
  userId: string;
};

type CreditGrantTarget = {
  displayName: string | null;
  email: string | null;
  userId: string;
};

type TierConfigRow = {
  applicationLimit: number;
  createdAt: string;
  description: string;
  generationLimit: number;
  id: string;
  isActive: boolean;
  key: string;
  name: string;
  periodDays: number;
  updatedAt: string;
};

type AdminSection =
  | "operate"
  | "users"
  | "support"
  | "billing"
  | "compliance"
  | "configuration"
  | "reports";

type PendingIssuePatch = {
  closedReason?: string;
  fixStatus?: string;
  ownerNotes?: string;
  resolutionVerification?: string;
  status?: string;
  userVisibleResolution?: string;
};

type SupportAutopilotPreview = {
  dryRun: boolean;
  errorsQueued: number;
  errorsResolved: number;
  mode: string;
  reviewed: number;
  skipped: number;
  ticketsEscalated: number;
  ticketsQueued: number;
  ticketsResolved: number;
  ticketsWaitingOnUser: number;
};

type ArtifactCleanupReport = {
  createdAt: string;
  id: string;
  missingArtifacts: ("pdf" | "docx")[];
  resumeType: string;
  statusBefore: string;
  updatedAt: string;
  userId: string;
};

type ArtifactCleanupResult = {
  appliedCount: number;
  auditEventId: string | null;
  dryRun: boolean;
  reports: ArtifactCleanupReport[];
  staleCount: number;
};

const periodOptions = [
  { label: "Today", value: 1 },
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
  { label: "All time", value: 0 },
];

const supportRiskFilters = [
  "all",
  "billing_refund",
  "privacy",
  "account_access",
  "inaccurate_ai_output",
] as const;

type SupportRiskFilter = (typeof supportRiskFilters)[number];

const userQuickFilters: { label: string; value: AdminUserQuickFilter }[] = [
  { label: "Needs attention", value: "needs_attention" },
  { label: "Open support", value: "open_support" },
  { label: "No credits", value: "no_credits" },
  { label: "Recent failure", value: "recent_failure" },
  { label: "No profile", value: "no_profile" },
  { label: "Active this week", value: "active_week" },
  { label: "All users", value: "all" },
];

export function OwnerConsole({ metrics: initialMetrics }: OwnerConsoleProps) {
  const router = useRouter();
  const [metrics, setMetrics] = useState(initialMetrics);
  const [periodDays, setPeriodDays] = useState(initialMetrics.period.days);
  const [activeTab, setActiveTab] = useState<AdminSection>("operate");
  const [selectedRootCause, setSelectedRootCause] = useState<string | null>(null);
  const [issueNotes, setIssueNotes] = useState<Record<string, string>>({});
  const [issueResolutionNotes, setIssueResolutionNotes] = useState<Record<string, string>>({});
  const [issueVerificationNotes, setIssueVerificationNotes] = useState<Record<string, string>>({});
  const [pendingIssuePatches, setPendingIssuePatches] = useState<Record<string, PendingIssuePatch>>({});
  const [issueUpdatingId, setIssueUpdatingId] = useState<string | null>(null);
  const [queueMode, setQueueMode] = useState<"open" | "history" | "all">("open");
  const [supportRiskFilter, setSupportRiskFilter] = useState<SupportRiskFilter>("all");
  const [promoCodes, setPromoCodes] = useState<PromoCodeRow[]>([]);
  const [tiers, setTiers] = useState<TierConfigRow[]>([]);
  const [grantMessage, setGrantMessage] = useState<string | null>(null);
  const [grantLoading, setGrantLoading] = useState(false);
  const [promoMessage, setPromoMessage] = useState<string | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [tierMessage, setTierMessage] = useState<string | null>(null);
  const [tierLoading, setTierLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [issueUpdateMessage, setIssueUpdateMessage] = useState<string | null>(null);
  const [autopilotLoading, setAutopilotLoading] = useState(false);
  const [autopilotPreview, setAutopilotPreview] = useState<SupportAutopilotPreview | null>(null);
  const [grantTargetQuery, setGrantTargetQuery] = useState("");
  const [selectedGrantTargets, setSelectedGrantTargets] = useState<CreditGrantTarget[]>([]);
  const [compliance, setCompliance] = useState<ComplianceDashboard | null>(null);
  const [complianceMessage, setComplianceMessage] = useState<string | null>(null);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [platformStatus, setPlatformStatus] = useState<PlatformStatusOverview | null>(null);
  const [platformStatusMessage, setPlatformStatusMessage] = useState<string | null>(null);
  const [platformStatusLoading, setPlatformStatusLoading] = useState(false);
  const [artifactCleanupLoading, setArtifactCleanupLoading] = useState(false);
  const [artifactCleanupResult, setArtifactCleanupResult] = useState<ArtifactCleanupResult | null>(null);
  const [userQuickFilter, setUserQuickFilter] = useState<AdminUserQuickFilter>("needs_attention");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return metrics.usersList
      .filter((user) => userMatchesAdminQuickFilter(user, userQuickFilter, metrics))
      .filter((user) =>
        !normalizedQuery
          ? true
          : [user.email, user.displayName, user.tier, user.profileStatus]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(normalizedQuery)),
      );
  }, [metrics, query, userQuickFilter]);

  const selectedUser = useMemo(
    () => metrics.usersList.find((user) => user.userId === selectedUserId) ?? null,
    [metrics.usersList, selectedUserId],
  );

  const rootCauseGroups = useMemo(() => {
    return buildRootCauseGroups([
      ...metrics.errorDetails.map((error) => ({
        area: error.area,
        code: error.code,
        createdAt: error.createdAt,
        fixRequired: error.fixRequired,
        id: error.id,
        rootCause: error.rootCause,
        rootCauseCategory: error.rootCause,
        source: "error" as const,
        status: error.status,
        summary: error.summary,
        userEmail: error.userEmail,
      })),
      ...metrics.supportTickets.map((ticket) => ({
        area: ticket.area,
        code: ticket.errorCode,
        createdAt: ticket.createdAt,
        fixRequired: ticket.fixStatus === "needs_code_fix",
        id: ticket.id,
        rootCause: ticket.rootCause,
        rootCauseCategory: ticket.rootCauseCategory,
        source: "support" as const,
        status: ticket.status,
        summary: ticket.subject,
        userEmail: ticket.userEmail,
      })),
    ]);
  }, [metrics.errorDetails, metrics.supportTickets]);
  const rootCauseDisplayLabels = useMemo(() => buildRootCauseDisplayLabels(rootCauseGroups), [rootCauseGroups]);
  const selectedRootCauseGroup = rootCauseGroups.find((group) => group.key === selectedRootCause) ?? null;
  const openRootCauseGroups = rootCauseGroups.filter((group) => readRootCauseQueueStatus(group) === "open");
  const needsAttentionCards = useMemo(
    () =>
      buildNeedsAttentionCards({
        compliance,
        metrics,
        platformStatus,
        promoCodes,
        rootCauseGroups,
        rootCauseLabels: rootCauseDisplayLabels,
      }),
    [compliance, metrics, platformStatus, promoCodes, rootCauseDisplayLabels, rootCauseGroups],
  );
  const badgeCounts = useMemo(
    () => ({
      billing:
        promoCodes.filter((promo) => promoNeedsOwnerAction(promo)).length +
        metrics.profitability.consumptionEvidence.filter((event) => event.credits >= 100).length,
      compliance: countActionableComplianceItems(compliance),
      operate: needsAttentionCards.filter((card) => card.count > 0).length,
      support: metrics.supportTickets.filter(supportTicketNeedsOwnerAction).length,
      users: metrics.usersList.filter((user) => getUserAttentionSignals(user, metrics).length > 0).length,
    }),
    [compliance, metrics, needsAttentionCards, promoCodes],
  );
  const filteredErrors = useMemo(() => {
    return metrics.errorDetails.filter((error) => {
      const matchesRootCause =
        !selectedRootCause ||
        buildRootCauseKey({
          area: error.area,
          code: error.code,
          rootCause: error.rootCause,
          rootCauseCategory: error.rootCause,
          summary: error.summary,
        }) === selectedRootCause;
      const matchesMode =
        queueMode === "all" ||
        (queueMode === "open" && error.status !== "resolved" && error.fixRequired) ||
        (queueMode === "history" && (error.status === "resolved" || !error.fixRequired));

      return matchesRootCause && matchesMode;
    });
  }, [metrics.errorDetails, queueMode, selectedRootCause]);
  const filteredSupportTickets = useMemo(() => {
    return metrics.supportTickets.filter((ticket) => {
      const matchesRootCause =
        !selectedRootCause ||
        buildRootCauseKey({
          area: ticket.area,
          code: ticket.errorCode,
          rootCause: ticket.rootCause,
          rootCauseCategory: ticket.rootCauseCategory,
          summary: ticket.subject,
        }) === selectedRootCause;
      const isClosed = ["resolved", "closed"].includes(ticket.status);
      const matchesMode =
        queueMode === "all" ||
        (queueMode === "open" && !isClosed) ||
        (queueMode === "history" && isClosed);
      const matchesRisk = ticketMatchesSupportRiskFilter(ticket, supportRiskFilter);

      return matchesRootCause && matchesMode && matchesRisk;
    });
  }, [metrics.supportTickets, queueMode, selectedRootCause, supportRiskFilter]);

  const grantTargetSuggestions = useMemo(() => {
    const normalizedQuery = grantTargetQuery.trim().toLowerCase();
    const selectedIds = new Set(selectedGrantTargets.map((target) => target.userId));

    if (!normalizedQuery) {
      return [];
    }

    return metrics.usersList
      .filter((user) => !selectedIds.has(user.userId))
      .filter((user) => {
        return [user.email, user.displayName, user.userId]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(normalizedQuery));
      })
      .slice(0, 8)
      .map((user) => ({
        displayName: user.displayName,
        email: user.email,
        userId: user.userId,
      }));
  }, [grantTargetQuery, metrics.usersList, selectedGrantTargets]);

  function openRootCause(rootCause: string) {
    const group = rootCauseGroups.find((item) => item.key === rootCause || item.displayName === rootCause);

    setSelectedRootCause(group?.key ?? rootCause);
    setActiveTab("operate");
  }

  function addGrantTarget(target: CreditGrantTarget) {
    setSelectedGrantTargets((current) =>
      current.some((item) => item.userId === target.userId) ? current : [...current, target],
    );
    setGrantTargetQuery("");
    setGrantMessage(null);
  }

  function removeGrantTarget(userId: string) {
    setSelectedGrantTargets((current) => current.filter((target) => target.userId !== userId));
  }

  function selectFirstGrantTargetSuggestion() {
    const [firstSuggestion] = grantTargetSuggestions;

    if (firstSuggestion) {
      addGrantTarget(firstSuggestion);
    }
  }

  async function loadPeriod(nextPeriodDays: number) {
    setPeriodDays(nextPeriodDays);

    startTransition(async () => {
      const response = await fetch(`/api/admin/metrics?periodDays=${nextPeriodDays}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as { metrics?: OwnerMetrics };

      if (payload.metrics) {
        setMetrics(payload.metrics);
      } else {
        setIssueUpdateMessage("Owner metrics could not be refreshed. Try again before acting on stale data.");
      }
    });
  }

  function downloadMetricsExport() {
    if (
      !window.confirm(
        "Export CSV includes owner operating metadata and may include support-safe user identifiers. Continue only if you need this file for owner review.",
      )
    ) {
      return;
    }

    window.location.href = `/api/admin/metrics/export?periodDays=${periodDays}`;
  }

  async function loadCompliance() {
    setComplianceLoading(true);
    setComplianceMessage(null);

    try {
      const response = await fetch("/api/admin/compliance", { cache: "no-store" });
      const payload = (await response.json()) as {
        compliance?: ComplianceDashboard;
        error?: { message?: string };
      };

      if (!response.ok || !payload.compliance) {
        setComplianceMessage(payload.error?.message ?? "Compliance dashboard could not be loaded.");
        return;
      }

      setCompliance(payload.compliance);
    } finally {
      setComplianceLoading(false);
    }
  }

  async function loadPlatformStatus() {
    setPlatformStatusLoading(true);
    setPlatformStatusMessage(null);

    try {
      const response = await fetch("/api/admin/platform-status", { cache: "no-store" });
      const payload = (await response.json()) as {
        error?: { message?: string };
        status?: PlatformStatusOverview;
      };

      if (!response.ok || !payload.status) {
        setPlatformStatusMessage(payload.error?.message ?? "Platform status could not be loaded.");
        return;
      }

      setPlatformStatus(payload.status);
    } finally {
      setPlatformStatusLoading(false);
    }
  }

  async function runArtifactCleanup(dryRun: boolean) {
    const resumeIds = artifactCleanupResult?.reports.map((report) => report.id) ?? [];

    if (!dryRun && resumeIds.length === 0) {
      setPlatformStatusMessage("Preview stale artifacts before applying cleanup.");
      return;
    }

    if (
      !dryRun &&
      !window.confirm(
        `Reset ${resumeIds.length.toLocaleString()} stale resume artifact record${resumeIds.length === 1 ? "" : "s"} to draft so exports can be regenerated?`,
      )
    ) {
      return;
    }

    setArtifactCleanupLoading(true);
    setPlatformStatusMessage(null);

    try {
      const response = await fetch("/api/admin/artifact-cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dryRun ? { dryRun } : { dryRun, resumeIds }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
        result?: ArtifactCleanupResult;
      } | null;

      if (!response.ok || !payload?.result) {
        setPlatformStatusMessage(
          payload?.error?.message ?? "Artifact cleanup could not be completed.",
        );
        return;
      }

      setArtifactCleanupResult(payload.result);
      setPlatformStatusMessage(
        dryRun
          ? `${payload.result.staleCount.toLocaleString()} stale artifact record${payload.result.staleCount === 1 ? "" : "s"} found.`
          : `${payload.result.appliedCount.toLocaleString()} stale artifact record${payload.result.appliedCount === 1 ? "" : "s"} reset for regeneration.`,
      );

      if (!dryRun) {
        await loadPlatformStatus();
      }
    } finally {
      setArtifactCleanupLoading(false);
    }
  }

  async function updateIssue(
    issueId: string,
    patch: {
      closedReason?: string;
      fixStatus?: string;
      ownerNotes?: string;
      resolutionVerification?: string;
      status?: string;
      userVisibleResolution?: string;
    },
  ) {
    setIssueUpdatingId(issueId);
    setIssueUpdateMessage(null);

    try {
      const response = await fetch(`/api/admin/issues/${issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setIssueUpdateMessage(
          payload?.error?.message ?? "Support issue update failed. The queue was not changed.",
        );
        return;
      }

      await loadPeriod(periodDays);
      setPendingIssuePatches((current) => {
        const next = { ...current };
        delete next[issueId];
        return next;
      });
      setIssueUpdateMessage("Support issue updated.");
    } finally {
      setIssueUpdatingId(null);
    }
  }

  function stageIssuePatch(issueId: string, patch: PendingIssuePatch) {
    setPendingIssuePatches((current) => ({
      ...current,
      [issueId]: {
        ...(current[issueId] ?? {}),
        ...patch,
      },
    }));
    setIssueUpdateMessage("Support changes are staged. Use Save changes to write the audit event.");
  }

  async function saveIssueChanges(ticket: OwnerMetrics["supportTickets"][number]) {
    const patch = {
      ...(pendingIssuePatches[ticket.id] ?? {}),
      ownerNotes: issueNotes[ticket.id] ?? ticket.ownerNotes,
      resolutionVerification: issueVerificationNotes[ticket.id] ?? ticket.resolutionVerification,
      userVisibleResolution: issueResolutionNotes[ticket.id] ?? ticket.userVisibleResolution,
    };

    await updateIssue(ticket.id, patch);
  }

  async function previewSupportAutopilot() {
    setAutopilotLoading(true);
    setIssueUpdateMessage(null);
    setAutopilotPreview(null);

    try {
      const response = await fetch("/api/admin/support/autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true, limit: 120, mode: "backlog" }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
        result?: SupportAutopilotPreview;
      } | null;

      if (!response.ok || !payload?.result) {
        setIssueUpdateMessage(
          payload?.error?.message ?? "Support autopilot preview could not review the queue.",
        );
        return;
      }

      setAutopilotPreview(payload.result);
      setIssueUpdateMessage(
        [
          `Previewed ${payload.result.reviewed.toLocaleString()} item${payload.result.reviewed === 1 ? "" : "s"}.`,
          `${payload.result.ticketsResolved.toLocaleString()} ticket${payload.result.ticketsResolved === 1 ? "" : "s"} would resolve.`,
          `${payload.result.ticketsEscalated.toLocaleString()} would escalate.`,
          `${payload.result.errorsResolved.toLocaleString()} error${payload.result.errorsResolved === 1 ? "" : "s"} would clear.`,
        ].join(" "),
      );
    } finally {
      setAutopilotLoading(false);
    }
  }

  async function applySupportAutopilot() {
    if (!autopilotPreview) {
      setIssueUpdateMessage("Preview the L1 review before applying changes.");
      return;
    }

    if (
      !window.confirm(
        `Apply the previewed L1 review to ${autopilotPreview.reviewed.toLocaleString()} queue item${autopilotPreview.reviewed === 1 ? "" : "s"}? This writes ticket/error updates and audit messages.`,
      )
    ) {
      return;
    }

    setAutopilotLoading(true);
    setIssueUpdateMessage(null);

    try {
      const response = await fetch("/api/admin/support/autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false, limit: 120, mode: "backlog" }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
        result?: SupportAutopilotPreview;
      } | null;

      if (!response.ok || !payload?.result) {
        setIssueUpdateMessage(payload?.error?.message ?? "Support autopilot could not apply changes.");
        return;
      }

      setAutopilotPreview(null);
      await loadPeriod(periodDays);
      setIssueUpdateMessage(
        `Applied L1 review: ${payload.result.ticketsResolved.toLocaleString()} resolved, ${payload.result.ticketsEscalated.toLocaleString()} escalated, ${payload.result.errorsResolved.toLocaleString()} errors cleared.`,
      );
    } finally {
      setAutopilotLoading(false);
    }
  }

  async function loadPromoCodes({ preserveMessage = false }: { preserveMessage?: boolean } = {}) {
    setPromoLoading(true);
    if (!preserveMessage) {
      setPromoMessage(null);
    }

    try {
      const response = await fetch("/api/admin/promo-codes", { cache: "no-store" });
      const payload = (await response.json()) as {
        error?: { message?: string };
        promoCodes?: PromoCodeRow[];
      };

      if (!response.ok || !payload.promoCodes) {
        setPromoMessage(payload.error?.message ?? "Promo codes could not be loaded.");
        return;
      }

      setPromoCodes(payload.promoCodes);
    } finally {
      setPromoLoading(false);
    }
  }

  async function loadTiers({ preserveMessage = false }: { preserveMessage?: boolean } = {}) {
    setTierLoading(true);
    if (!preserveMessage) {
      setTierMessage(null);
    }

    try {
      const response = await fetch("/api/admin/tiers", { cache: "no-store" });
      const payload = (await response.json()) as {
        error?: { message?: string };
        tiers?: TierConfigRow[];
      };

      if (!response.ok || !payload.tiers) {
        setTierMessage(payload.error?.message ?? "Tier configuration could not be loaded.");
        return;
      }

      setTiers(payload.tiers);
    } finally {
      setTierLoading(false);
    }
  }

  async function saveTierConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const id = formData.get("id")?.toString() ?? "";
    const name = formData.get("name")?.toString().trim() ?? "";
    const key = formData.get("key")?.toString().trim() ?? "";
    const description = formData.get("description")?.toString().trim() ?? "";
    const applicationLimit = Number(formData.get("applicationLimit") ?? 0);
    const generationLimit = Number(formData.get("generationLimit") ?? 0);
    const tierPeriodDays = Number(formData.get("periodDays") ?? 30);
    const isActive = formData.get("isActive") === "on";
    const sandboxQaComplete = formData.get("sandboxQaComplete") === "on";

    if (description.length < 12) {
      setTierMessage("Add a clear owner note in the description before saving a tier.");
      return;
    }

    if (!sandboxQaComplete) {
      setTierMessage("Confirm sandbox QA for tier updates before saving.");
      return;
    }

    if (
      !window.confirm(
        `Save ${name || key}? Tier changes affect quota enforcement and write an admin audit event.`,
      )
    ) {
      return;
    }

    if (
      id &&
      !window.confirm(
        `Save changes to ${name || key}? Active assignments may rely on this tier, so confirm the limits are intentional.`,
      )
    ) {
      return;
    }

    setTierLoading(true);
    setTierMessage(null);

    try {
      const response = await fetch("/api/admin/tiers", {
        body: JSON.stringify({
          applicationLimit,
          description,
          generationLimit,
          id: id || undefined,
          isActive,
          key,
          name,
          periodDays: tierPeriodDays,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
        tier?: TierConfigRow;
      };

      if (!response.ok || !payload.tier) {
        setTierMessage(payload.error?.message ?? "Tier configuration could not be saved.");
        return;
      }

      if (!id) {
        form.reset();
      }

      await loadTiers({ preserveMessage: true });
      await loadPeriod(periodDays);
      setTierMessage(`${payload.tier.name} tier saved. Audit evidence was written.`);
      router.refresh();
    } finally {
      setTierLoading(false);
    }
  }

  async function createPromoCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPromoMessage(null);
    const formData = new FormData(event.currentTarget);
    const expiresAt = formData.get("expiresAt")?.toString() ?? "";
    const creditAmount = Number(formData.get("creditAmount") ?? 0);
    const maxRedemptions = Number(formData.get("maxRedemptions") ?? 1);
    const description = formData.get("description")?.toString().trim() ?? "";
    const sandboxQaComplete = formData.get("sandboxQaComplete") === "on";

    if (description.length < 8) {
      setPromoMessage("Add an owner reason before creating a promo code.");
      return;
    }

    if (!sandboxQaComplete) {
      setPromoMessage("Confirm sandbox QA for promo creation, redemption, and expiry before creating this code.");
      return;
    }

    if (
      creditAmount * maxRedemptions >= 250 &&
      !window.confirm(
        `This promo can grant up to ${creditAmount * maxRedemptions} credits. Confirm that the owner reason and redemption scope are correct.`,
      )
    ) {
      return;
    }

    setPromoLoading(true);

    try {
      const response = await fetch("/api/admin/promo-codes", {
        body: JSON.stringify({
          assignedUserEmail: formData.get("assignedUserEmail")?.toString() ?? "",
          code: formData.get("code")?.toString() ?? "",
          creditAmount,
          description,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : "",
          maxRedemptions,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
        promoCode?: PromoCodeRow;
      };

      if (!response.ok || !payload.promoCode) {
        setPromoMessage(payload.error?.message ?? "Promo code could not be created.");
        return;
      }

      form.reset();
      await loadPromoCodes({ preserveMessage: true });
      setPromoMessage(`Promo code ${payload.promoCode.code} created and ready to redeem.`);
      router.refresh();
    } finally {
      setPromoLoading(false);
    }
  }

  async function grantCreditsDirectly(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const creditAmount = Number(formData.get("creditAmount") ?? 0);
    const description = formData.get("description")?.toString().trim() ?? "";
    const sandboxQaComplete = formData.get("sandboxQaComplete") === "on";
    const manualTarget = grantTargetQuery.trim();
    const targets = selectedGrantTargets.map((target) => ({
      label: formatGrantTargetLabel(target),
      userEmail: "",
      userId: target.userId,
    }));

    if (targets.length === 0 && manualTarget) {
      targets.push({
        label: manualTarget,
        userEmail: manualTarget.includes("@") ? manualTarget : "",
        userId: manualTarget.includes("@") ? "" : manualTarget,
      });
    }

    if (targets.length === 0) {
      setGrantMessage("Choose at least one user before adding credits.");
      return;
    }

    if (description.length < 8) {
      setGrantMessage("Add an owner note before granting credits.");
      return;
    }

    if (!sandboxQaComplete) {
      setGrantMessage("Confirm sandbox QA for credit grants before writing ledger events.");
      return;
    }

    if (
      !window.confirm(
        `Add ${creditAmount} credits to ${targets.length} user${targets.length === 1 ? "" : "s"}? This writes credit ledger and admin audit records.`,
      )
    ) {
      return;
    }

    if (
      creditAmount * targets.length >= 100 &&
      !window.confirm(
        `This will add ${creditAmount} credits to ${targets.length} user${targets.length === 1 ? "" : "s"}. Confirm the reason and recipients before writing ledger events.`,
      )
    ) {
      return;
    }

    setGrantLoading(true);
    setGrantMessage(null);
    try {
      const successes: CreditGrant[] = [];
      const failures: string[] = [];

      for (const target of targets) {
        const response = await fetch("/api/admin/credits/grants", {
          body: JSON.stringify({
            creditAmount,
            description,
            userEmail: target.userEmail,
            userId: target.userId,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const payload = (await response.json()) as {
          error?: { message?: string };
          grant?: CreditGrant;
        };

        if (!response.ok || !payload.grant) {
          failures.push(`${target.label}: ${payload.error?.message ?? "Credits could not be added."}`);
        } else {
          successes.push(payload.grant);
        }
      }

      if (successes.length === 0) {
        setGrantMessage(failures[0] ?? "Credits could not be added.");
        return;
      }

      if (failures.length === 0) {
        form.reset();
        setGrantTargetQuery("");
        setSelectedGrantTargets([]);
        setGrantMessage(
          `Added ${creditAmount} credits to ${successes.length} user${successes.length === 1 ? "" : "s"}.`,
        );
      } else {
        const successfulIds = new Set(successes.map((grant) => grant.userId));
        setSelectedGrantTargets((current) => current.filter((target) => !successfulIds.has(target.userId)));
        setGrantMessage(
          `Added credits to ${successes.length} user${successes.length === 1 ? "" : "s"}. ${failures.length} failed: ${failures.join(" ")}`,
        );
      }

      await loadPeriod(periodDays);
      router.refresh();
    } finally {
      setGrantLoading(false);
    }
  }

  const shouldShowGrantTargetSuggestions = grantTargetQuery.trim().length > 0;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCompliance();
      void loadPlatformStatus();
      void loadPromoCodes({ preserveMessage: true });
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="owner-console" aria-labelledby="owner-console-title">
      <div className="owner-console-header">
        <div className="pane-heading">
          <p className="eyebrow">Owner console</p>
          <h1 id="owner-console-title">Operating command center</h1>
          <p>
            Monitor acquisition, activation, profile quality, application outcomes, errors,
            support load, and product friction. This view is designed to answer what needs
            attention, not just count what happened.
          </p>
        </div>
        <div className="owner-console-controls" aria-label="Owner console filters">
          <div className="segmented-control compact">
            {periodOptions.map((option) => (
              <button
                className={periodDays === option.value ? "active" : ""}
                disabled={isPending}
                key={option.value}
                onClick={() => loadPeriod(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          <button className="secondary-action" disabled={isPending} onClick={() => loadPeriod(periodDays)} type="button">
            <RefreshCcw size={16} aria-hidden="true" />
            Refresh
          </button>
          <button className="secondary-action" disabled={isPending} onClick={downloadMetricsExport} type="button">
            <Download size={16} aria-hidden="true" />
            Export CSV
          </button>
        </div>
      </div>

      <nav className="owner-tab-list" aria-label="Owner console sections">
        {[
          ["operate", "Operate", badgeCounts.operate, "actionable operating items"],
          ["users", "Users", badgeCounts.users, "users needing attention"],
          ["support", "Support", badgeCounts.support, "support tickets needing owner action"],
          ["billing", "Billing & Credits", badgeCounts.billing, "billing or credit records needing review"],
          ["compliance", "Compliance", badgeCounts.compliance, "privacy or compliance items needing action"],
          ["configuration", "Configuration", undefined, ""],
          ["reports", "Reports", undefined, ""],
        ].map(([key, label, count, countLabel]) => (
          <button
            className={activeTab === key ? "active" : ""}
            key={key}
            onClick={() => {
              setActiveTab(key as AdminSection);
              if (key === "billing" && promoCodes.length === 0) {
                void loadPromoCodes();
              }
              if (key === "configuration" && tiers.length === 0) {
                void loadTiers();
              }
              if (key === "compliance" && !compliance && !complianceLoading) {
                void loadCompliance();
              }
              if (key === "operate" && !platformStatus && !platformStatusLoading) {
                void loadPlatformStatus();
              }
            }}
            type="button"
          >
            {label}
            {typeof count === "number" && count > 0 ? (
              <span className="owner-tab-badge" aria-hidden="true" title={`${count} ${countLabel}`}>
                {count}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      {activeTab === "operate" ? (
        <>
          <section className="owner-command-center" aria-label="Needs attention now">
            <SectionHeading
              eyebrow="Operate"
              title="Needs attention now"
              body="Ranked by operational risk so an owner can see reliability, support, user success, compliance, and credit anomalies before broad analytics."
            />
            <div className="owner-command-grid">
              {needsAttentionCards.map((card) => (
                <CommandCenterCard
                  card={card}
                  key={card.title}
                  onAction={() => {
                    if (card.targetRootCause) {
                      setSelectedRootCause(card.targetRootCause);
                    }
                    setActiveTab(card.targetTab);
                  }}
                />
              ))}
            </div>
          </section>

          <section className="owner-metric-grid owner-pulse-grid" aria-label="Operating pulse">
            <MetricCard
              icon={UsersRound}
              label="Users"
              onClick={() => setActiveTab("users")}
              value={metrics.users.totalSignedUp}
              detail={`${metrics.users.newInPeriod} new, ${metrics.users.activeInPeriod} active in selected period`}
            />
            <MetricCard
              icon={FileText}
              label="Profiles"
              onClick={() => setActiveTab("users")}
              value={metrics.profiles.created}
              detail={`${metrics.profiles.ready} ready, ${metrics.profiles.needsReview} need review`}
            />
            <MetricCard
              icon={AlertTriangle}
              label="Fix required"
              onClick={() => {
                setSelectedRootCause(null);
                setActiveTab("operate");
              }}
              value={metrics.systemHealth.fixRequired}
              detail={`${openRootCauseGroups.length} active root-cause groups, ${metrics.errorDetails.length} retained signals`}
              tone={metrics.systemHealth.fixRequired > 0 ? "warning" : "normal"}
            />
            <MetricCard
              icon={HeartHandshake}
              label="Support"
              onClick={() => setActiveTab("support")}
              value={metrics.support.ticketsOpen}
              detail={`${metrics.support.ticketsEscalated} escalated, ${metrics.support.l1Resolved} L1 resolved`}
            />
          </section>
        </>
      ) : null}

      {activeTab === "operate" ? (
        <section className="owner-detail-panel owner-wide-panel" aria-label="Platform status">
          <SectionHeading
            eyebrow="Platform status"
            title="Dependency health"
            body="Owner-only view of service availability, recent failures, and artifact readiness. Diagnostics are aggregate and do not expose secrets."
          />
          <div className="owner-action-strip">
            <button
              className="owner-operating-action"
              disabled={platformStatusLoading}
              onClick={loadPlatformStatus}
              type="button"
            >
              <span>Status</span>
              <strong>{platformStatus ? formatLabel(platformStatus.overallStatus) : "Not loaded"}</strong>
              <p>{platformStatus ? `Generated ${formatDateTime(platformStatus.generatedAt)}.` : "Load the latest platform status."}</p>
              <small>{platformStatusLoading ? "Refreshing" : "Refresh status"}</small>
            </button>
          </div>
          {platformStatusMessage ? <p className="system-note error">{platformStatusMessage}</p> : null}
          {platformStatus ? (
            <PlatformStatusPanel
              cleanupLoading={artifactCleanupLoading}
              cleanupResult={artifactCleanupResult}
              onApplyCleanup={() => runArtifactCleanup(false)}
              onPreviewCleanup={() => runArtifactCleanup(true)}
              status={platformStatus}
            />
          ) : null}
        </section>
      ) : null}

      {activeTab === "operate" ? (
        <section className="owner-detail-panel owner-wide-panel" aria-label="Error details">
          <SectionHeading
            eyebrow="System health"
            title="Errors and root-cause review"
            body="Open queue shows unresolved root causes. History keeps resolved evidence out of the daily queue while preserving what happened, who was affected, and how it was verified."
          />
          <QueueModeControl queueMode={queueMode} setQueueMode={setQueueMode} />
          {rootCauseGroups.length > 0 ? (
            <div className="root-cause-filter" aria-label="Root-cause queue">
              <button
                className={!selectedRootCause ? "active" : ""}
                onClick={() => setSelectedRootCause(null)}
                type="button"
              >
                <span>All root causes</span>
                <small>{rootCauseGroups.length.toLocaleString()}</small>
              </button>
              {rootCauseGroups
                .filter((group) => queueMode === "all" || readRootCauseQueueStatus(group) === queueMode)
                .map((group) => (
                <button
                  className={selectedRootCause === group.key ? "active" : ""}
                  key={group.key}
                  onClick={() => setSelectedRootCause(group.key)}
                  title={rootCauseDisplayLabels[group.key] ?? formatLabel(group.displayName)}
                  type="button"
                >
                  <span>{rootCauseDisplayLabels[group.key] ?? formatLabel(group.displayName)}</span>
                  <strong>{(group.activeErrors + group.activeTickets || group.resolvedSignals).toLocaleString()}</strong>
                  <small>
                    {group.impactedUsers || "Unknown"} affected ·{" "}
                    {readRootCauseQueueStatus(group) === "open" ? "Needs action" : "Retained"}
                  </small>
                </button>
                ))}
            </div>
          ) : null}
          {selectedRootCauseGroup ? (
            <RootCauseDrilldown
              group={selectedRootCauseGroup}
              errors={filteredErrors}
              onOpenSupport={() => setActiveTab("support")}
              queueMode={queueMode}
              tickets={filteredSupportTickets}
              updateIssue={updateIssue}
            />
          ) : null}
          <div className="owner-table error-table" role="table" aria-label="Error details">
            <div className="owner-table-row owner-table-head" role="row">
              <span>Issue</span>
              <span>Root cause</span>
              <span>Rationale</span>
              <span>Suggested action</span>
            </div>
            {filteredErrors.length > 0 ? (
              filteredErrors.map((error) => (
                <div className="owner-table-row" key={`${error.source}-${error.id}`} role="row">
                  <span>
                    <strong>{error.summary}</strong>
                    <small>{error.area} · {error.code} · {formatDateTime(error.createdAt)}</small>
                  </span>
                  <span>
                    <Pill tone={error.severity === "critical" || error.severity === "high" ? "danger" : "neutral"}>
                      {formatLabel(error.rootCause)}
                    </Pill>
                    <small>{error.userEmail || "No user attached"}</small>
                  </span>
                  <span>
                    <strong>{error.rationale}</strong>
                    <small>{formatAge(error.createdAt)} old</small>
                  </span>
                  <span>
                    <Pill tone={error.fixRequired ? "danger" : "neutral"}>
                      {error.fixRequired ? "Fix required" : "Monitor / guidance"}
                    </Pill>
                    <small>{suggestErrorFix(error)}</small>
                  </span>
                </div>
              ))
            ) : (
              <p className="empty-state">No error signals in this period.</p>
            )}
          </div>
        </section>
      ) : null}

      {activeTab === "users" ? (
        <section className="owner-detail-panel owner-wide-panel" aria-label="Users">
          <SectionHeading
            eyebrow="Users"
            title="User operating list"
            body="Use this to spot stalled onboarding, credit constraints, users with repeated failures, and high-intent users who may need support."
          />
          <div className="record-filter-strip owner-user-filter-strip" aria-label="User quick filters">
            {userQuickFilters.map((filter) => (
              <button
                aria-pressed={userQuickFilter === filter.value}
                className={`record-filter-chip ${userQuickFilter === filter.value ? "active" : ""}`}
                key={filter.value}
                onClick={() => setUserQuickFilter(filter.value)}
                type="button"
              >
                <span>{filter.label}</span>
              </button>
            ))}
          </div>
          <label className="owner-search">
            <Search size={16} aria-hidden="true" />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search users by email, name, tier, or status"
              value={query}
            />
          </label>
          <div className="owner-table" role="table" aria-label="User list">
            <div className="owner-table-row owner-table-head" role="row">
              <span>User</span>
              <span>Activity</span>
              <span>Profile</span>
              <span>Credits</span>
              <span>Workspace</span>
              <span>Support</span>
            </div>
            {filteredUsers.map((user) => (
              <div className="owner-table-row" key={user.userId} role="row">
                <span>
                  <strong>{user.displayName || "Unnamed user"}</strong>
                  <small>{user.email || "No email"}</small>
                </span>
                <span>
                  <strong>{formatRelativeTime(user.lastActivityAt ?? user.lastSignInAt ?? user.createdAt)}</strong>
                  <small>Joined {formatDate(user.createdAt)}</small>
                </span>
                <span>
                  <strong>{formatLabel(user.profileStatus ?? "missing")}</strong>
                  <small>{user.sources} sources</small>
                </span>
                <span>
                  <strong>{user.creditsAvailable} available</strong>
                  <small>
                    {user.creditsUsed} used {periodDays === 0 ? "all time" : `in ${periodDays}d`} ·{" "}
                    {user.creditsUsedAllTime} lifetime
                  </small>
                </span>
                <span>
                  <strong>{user.applications} applications</strong>
                  <small>{user.resumes} resumes · {user.tier}</small>
                </span>
                <span>
                  <strong>{user.openTickets} open</strong>
                  <small>
                    {getUserAttentionSignals(user, metrics).join(" · ") || "No flagged risk"}
                  </small>
                  <button
                    className="owner-inline-action"
                    onClick={() => setSelectedUserId(user.userId)}
                    type="button"
                  >
                    Open user
                  </button>
                </span>
              </div>
            ))}
          </div>
          {selectedUser ? (
            <UserDetailDrawer
              metrics={metrics}
              onClose={() => setSelectedUserId(null)}
              periodDays={periodDays}
              user={selectedUser}
            />
          ) : null}
        </section>
      ) : null}

      {activeTab === "support" ? (
        <section className="owner-detail-panel owner-wide-panel" aria-label="Support tickets">
          <SectionHeading
            eyebrow="Support"
            title="Support queue"
            body="The default queue only shows active work. Resolved and closed tickets move to history with owner notes, user-visible updates, supporting logs, and verification evidence retained."
          />
          <div className="owner-action-row" aria-label="Support automation controls">
            <button
              className="secondary-action compact-action"
              disabled={autopilotLoading}
              onClick={previewSupportAutopilot}
              type="button"
            >
              <ClipboardCheck aria-hidden="true" size={16} />
              <span>{autopilotLoading ? "Previewing..." : "Preview L1 review"}</span>
            </button>
            <button
              className="secondary-action compact-action"
              disabled={autopilotLoading || !autopilotPreview}
              onClick={applySupportAutopilot}
              type="button"
            >
              <CheckCircle2 aria-hidden="true" size={16} />
              <span>Apply previewed changes</span>
            </button>
            {autopilotPreview ? (
              <p className="owner-safety-note">
                Preview: {autopilotPreview.reviewed.toLocaleString()} reviewed,{" "}
                {autopilotPreview.ticketsResolved.toLocaleString()} ticket resolutions,{" "}
                {autopilotPreview.ticketsEscalated.toLocaleString()} escalations,{" "}
                {autopilotPreview.errorsResolved.toLocaleString()} error clears. Nothing has been changed yet.
              </p>
            ) : null}
          </div>
          <QueueModeControl queueMode={queueMode} setQueueMode={setQueueMode} />
          <div className="record-filter-strip" aria-label="Trust-critical support filters">
            {supportRiskFilters.map((filter) => (
              <button
                aria-pressed={supportRiskFilter === filter}
                className={`record-filter-chip ${supportRiskFilter === filter ? "active" : ""}`}
                key={filter}
                onClick={() => setSupportRiskFilter(filter)}
                type="button"
              >
                <span>{formatSupportRiskFilter(filter)}</span>
              </button>
            ))}
          </div>
          {issueUpdateMessage ? <p className="owner-generated-note">{issueUpdateMessage}</p> : null}
          {filteredSupportTickets.length > 0 ? (
            <div className="support-issue-list" aria-label="Support issues">
              {filteredSupportTickets.map((ticket) => {
                const pendingPatch = pendingIssuePatches[ticket.id] ?? {};
                const hasPendingPatch = Object.keys(pendingPatch).length > 0;
                const verificationNote = readIssueVerificationNote(issueVerificationNotes, ticket, "");
                const userVisibleUpdate = readIssueResolutionNote(
                  issueResolutionNotes,
                  ticket,
                  "This has been addressed. Please retry the workflow and reopen the issue if it still behaves unexpectedly.",
                );

                return (
                <article className="support-issue-card" key={ticket.id}>
                  <div className="support-issue-header">
                    <div>
                      <span className="owner-pill">{ticket.id.slice(0, 8).toUpperCase()}</span>
                      <h3>{ticket.subject}</h3>
                      <p>{ticket.summary || "No summary yet."}</p>
                    </div>
                    <div className="support-issue-status">
                      <Pill tone={ticket.priority === "urgent" || ticket.priority === "high" ? "danger" : "neutral"}>
                        {formatLabel(ticket.priority)}
                      </Pill>
                      <small>
                        {formatLabel(ticket.status)} · {formatLabel(ticket.fixStatus)} · age {formatAge(ticket.createdAt)}
                      </small>
                    </div>
                  </div>

                  <div className="support-issue-grid">
                    <div>
                      <span>Plain-English root cause</span>
                      <p>{ticket.rootCause}</p>
                    </div>
                    <div>
                      <span>Suggested fix</span>
                      <p>{ticket.suggestedFix || "No suggested fix captured yet."}</p>
                    </div>
                    <div>
                      <span>User and area</span>
                      <p>
                        {ticket.userEmail || "No user attached"} · {formatLabel(ticket.area)} ·{" "}
                        {ticket.errorCode || "No error code"}
                      </p>
                    </div>
                    <div>
                      <span>Diagnostic context</span>
                      <p>{formatTicketDiagnosticContext(ticket.metadata)}</p>
                    </div>
                    <div>
                      <span>User-visible resolution</span>
                      <p>
                        {ticket.userVisibleResolution ||
                          "No user-visible update yet. Add a concise note before resolving, cancelling, or asking for more information."}
                      </p>
                    </div>
                    <div>
                      <span>Reopen window</span>
                      <p>{formatSupportReopenWindow(ticket)}</p>
                    </div>
                    <div>
                      <span>Resolution verification</span>
                      <p>
                        {ticket.resolutionVerification ||
                          "Not verified yet. Add what was reviewed and tested before marking fixed."}
                      </p>
                    </div>
                  </div>

                  {renderSupportIncidentSnapshot(ticket.metadata)}

                  <details className="support-log-details">
                    <summary>
                      Supporting logs and conversation ({ticket.supportingLogs.length + readRecentConversation(ticket.metadata).length})
                    </summary>
                    {readRecentConversation(ticket.metadata).length > 0 ? (
                      <ol className="support-conversation-snapshot">
                        {readRecentConversation(ticket.metadata).map((message, index) => (
                          <li key={`${message.at}-${index}`}>
                            <strong>{formatLabel(message.speaker)}</strong>
                            <span>{message.at ? formatDateTime(message.at) : "Recent"}</span>
                            <p>{message.text}</p>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                    {ticket.supportingLogs.length > 0 ? (
                      <ul>
                        {ticket.supportingLogs.map((log) => (
                          <li key={log.id}>
                            <strong>{log.code}</strong>
                            <span>{formatLabel(log.area)} · {formatDateTime(log.createdAt)}</span>
                            <p>{log.message}</p>
                            <small>
                              Root cause: {formatLabel(log.rootCause)} ·{" "}
                              {log.fixRequired ? "Fix required" : "Monitor"}
                            </small>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No linked error logs yet. Review recent conversation and app events for this user.</p>
                    )}
                  </details>

                  <div className="support-issue-actions">
                    <label>
                      Status
                      <select
                        disabled={issueUpdatingId === ticket.id}
                        onChange={(event) => stageIssuePatch(ticket.id, { status: event.target.value })}
                        value={pendingPatch.status ?? ticket.status}
                      >
                        <option value="open">Open</option>
                        <option value="in_progress">Investigating</option>
                        <option value="waiting_on_user">Waiting on user</option>
                        <option value="escalated">Escalated</option>
                        <option value="resolved">Resolved</option>
                        <option value="closed">Cancelled/closed</option>
                      </select>
                    </label>
                    <label>
                      Fix disposition
                      <select
                        disabled={issueUpdatingId === ticket.id}
                        onChange={(event) => stageIssuePatch(ticket.id, { fixStatus: event.target.value })}
                        value={pendingPatch.fixStatus ?? ticket.fixStatus}
                      >
                        <option value="not_started">Not started</option>
                        <option value="investigating">Investigating</option>
                        <option value="needs_code_fix">Needs product fix</option>
                        <option value="fixed">Fixed</option>
                        <option value="wont_fix">Will not fix</option>
                        <option value="user_action_required">User action required</option>
                      </select>
                    </label>
                    <label className="support-issue-notes">
                      User-visible update
                      <textarea
                        disabled={issueUpdatingId === ticket.id}
                        onChange={(event) =>
                          setIssueResolutionNotes((current) => ({
                            ...current,
                            [ticket.id]: event.target.value,
                          }))
                        }
                        placeholder="What the user should see about the outcome or next step."
                        value={issueResolutionNotes[ticket.id] ?? ticket.userVisibleResolution}
                      />
                    </label>
                    <label className="support-issue-notes">
                      Owner notes
                      <textarea
                        disabled={issueUpdatingId === ticket.id}
                        onChange={(event) =>
                          setIssueNotes((current) => ({
                            ...current,
                            [ticket.id]: event.target.value,
                          }))
                        }
                        placeholder="What was investigated? What fix was applied, or why was it cancelled?"
                        value={issueNotes[ticket.id] ?? ticket.ownerNotes}
                      />
                    </label>
                    <label className="support-issue-notes">
                      Verification before fixed
                      <textarea
                        disabled={issueUpdatingId === ticket.id}
                        onChange={(event) =>
                          setIssueVerificationNotes((current) => ({
                            ...current,
                            [ticket.id]: event.target.value,
                          }))
                        }
                        placeholder="What logs, workflow, or regression test proved this is fixed?"
                        value={issueVerificationNotes[ticket.id] ?? ticket.resolutionVerification}
                      />
                    </label>
                    <button
                      className="secondary-action"
                      disabled={issueUpdatingId === ticket.id}
                      onClick={() => saveIssueChanges(ticket)}
                      type="button"
                    >
                      Save changes
                    </button>
                    {hasPendingPatch ? (
                      <button
                        className="secondary-action"
                        disabled={issueUpdatingId === ticket.id}
                        onClick={() =>
                          setPendingIssuePatches((current) => {
                            const next = { ...current };
                            delete next[ticket.id];
                            return next;
                          })
                        }
                        type="button"
                      >
                        Discard staged
                      </button>
                    ) : null}
                    <div className="support-user-preview">
                      <span>User-visible update preview</span>
                      <p>{userVisibleUpdate}</p>
                      <small>Resolving or asking the user posts this in the in-app support thread.</small>
                    </div>
                    <p className={verificationNote ? "owner-safety-note" : "owner-safety-note warning"}>
                      {verificationNote
                        ? "Ready to mark fixed. The verification note will be retained in the audit trail."
                        : "Add verification before Mark fixed becomes available."}
                    </p>
                    <div className="support-issue-quick-actions" aria-label={`Quick actions for ${ticket.subject}`}>
                      <button
                        className="secondary-action"
                        disabled={issueUpdatingId === ticket.id}
                        onClick={() =>
                          updateIssue(ticket.id, {
                            ownerNotes: readIssueNote(issueNotes, ticket, "Asked user for additional context."),
                            userVisibleResolution: readIssueResolutionNote(
                              issueResolutionNotes,
                              ticket,
                              "I need a little more information to finish this cleanly. Please reply in Support with the exact step, file, or page where this happened.",
                            ),
                            status: "waiting_on_user",
                            fixStatus: "user_action_required",
                          })
                        }
                        type="button"
                      >
                        Ask user
                      </button>
                      <button
                        className="secondary-action"
                        disabled={issueUpdatingId === ticket.id || !verificationNote}
                        onClick={() =>
                          updateIssue(ticket.id, {
                            ownerNotes: readIssueNote(issueNotes, ticket, "Marked fixed after owner review."),
                            resolutionVerification: verificationNote,
                            userVisibleResolution: userVisibleUpdate,
                            status: "resolved",
                            fixStatus: "fixed",
                          })
                        }
                        title={
                          verificationNote ? "Mark this issue fixed" : "Add verification notes before marking fixed"
                        }
                        type="button"
                      >
                        Mark fixed
                      </button>
                      <button
                        className="secondary-action danger-action"
                        disabled={issueUpdatingId === ticket.id}
                        onClick={() => {
                          if (
                            !window.confirm(
                              "Close this support issue with no fix? This writes an audit trail and a user-visible resolution.",
                            )
                          ) {
                            return;
                          }

                          void updateIssue(ticket.id, {
                            closedReason: "not_planned",
                            ownerNotes: readIssueNote(issueNotes, ticket, "Closed after owner review. No product change planned."),
                            userVisibleResolution: readIssueResolutionNote(
                              issueResolutionNotes,
                              ticket,
                              "Closed after review. No product change is planned right now, but the issue remains retained for audit and trend review.",
                            ),
                            status: "closed",
                            fixStatus: "wont_fix",
                          });
                        }}
                        type="button"
                      >
                        Close no fix
                      </button>
                    </div>
                  </div>
                </article>
                );
              })}
            </div>
          ) : (
            <p className="empty-state">
              {selectedRootCauseGroup
                ? `No support tickets linked to ${formatLabel(selectedRootCauseGroup.displayName)} in this view. Related app issues are still visible in System health.`
                : "No support issues in this period. Chat failures and user-reported issues will appear here with supporting logs."}
            </p>
          )}
        </section>
      ) : null}

      {activeTab === "reports" ? (
        <>
        <section className="owner-detail-grid" aria-label="Operating reports">
          <TrendPanel title="Daily operating trend" values={metrics.trends.daily} />
          <PageUsagePanel values={metrics.trends.pageUsage} />
          <MetricBreakdown title="Feature usage" values={metrics.featureUsage} />
          <MetricBreakdown title="Profile sources" values={metrics.sources} />
          <MetricBreakdown title="Application statuses" values={metrics.applications.byStatus} />
          <MetricBreakdown
            actionLabel="Drill down"
            onSelect={openRootCause}
            title="Root causes"
            values={Object.fromEntries(
              rootCauseGroups.map((group) => [
                rootCauseDisplayLabels[group.key] ?? formatLabel(group.displayName),
                group.activeErrors + group.activeTickets || group.resolvedSignals,
              ]),
            )}
          />
        </section>
        <section className="owner-detail-grid" aria-label="Outcome analytics">
          <OutcomeBreakdown title="Outcome by tier" values={metrics.outcomes.byTier} />
          <OutcomeBreakdown title="Outcome by role family" values={metrics.outcomes.byRoleFamily} />
          <OutcomeBreakdown title="Outcome by source" values={metrics.outcomes.bySourceType} />
          <OutcomeBreakdown title="Outcome by resume type" values={metrics.outcomes.byResumeType} />
          <div className="owner-detail-panel">
            <SectionHeading
              eyebrow="Response time"
              title="Time to first response"
              body={`A lagging indicator of whether ${brand.name} is helping users target roles that create market response.`}
            />
            <strong className="owner-large-number">
              {metrics.outcomes.averageHoursToFirstResponse.toLocaleString()}h
            </strong>
          </div>
        </section>
        </>
      ) : null}

      {activeTab === "billing" ? (
        <section className="owner-detail-panel owner-wide-panel" aria-label="Profitability">
          <SectionHeading
            eyebrow="Economics"
            title="Cost and profitability model"
            body="Revenue, credit consumption, estimated platform cost, and per-user economics for the selected period. Treat this as an operating model until Stripe, RevenueCat, OpenAI, Vercel, and Supabase cost exports are reconciled automatically."
          />

          <div className="profitability-grid" aria-label="Profitability summary">
            <FinancialTile label="Revenue" value={formatMoney(metrics.profitability.revenueUsd)} />
            <FinancialTile label="Estimated cost" value={formatMoney(metrics.profitability.totalCostUsd)} />
            <FinancialTile
              label="Gross profit"
              tone={metrics.profitability.grossProfitUsd < 0 ? "warning" : "normal"}
              value={formatMoney(metrics.profitability.grossProfitUsd)}
            />
            <FinancialTile label="Margin" value={`${metrics.profitability.grossMarginPercent.toFixed(1)}%`} />
            <FinancialTile label="Credits used" value={metrics.profitability.creditsUsed.toLocaleString()} />
            <FinancialTile
              label="Cost / active user"
              value={formatMoney(metrics.profitability.costPerActiveUserUsd)}
            />
          </div>

          <div className="owner-detail-grid two-column">
            <div className="owner-detail-panel compact-panel">
              <SectionHeading
                eyebrow="Assumptions"
                title="Cost assumptions"
                body="These defaults can be tuned with owner environment variables until live provider cost telemetry is wired."
              />
              <dl className="metric-list">
                {metrics.profitability.assumptions.map((assumption) => (
                  <div key={assumption.label}>
                    <dt>{assumption.label}</dt>
                    <dd>
                      <span>{assumption.value}</span>
                      <small>{assumption.detail}</small>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="owner-detail-panel compact-panel">
              <SectionHeading
                eyebrow="Cost split"
                title="What drove cost"
                body="Separates fixed platform baseline from variable credit consumption and estimated payment fees."
              />
              <dl className="metric-list">
                <div>
                  <dt>AI and variable cost</dt>
                  <dd><span>{formatMoney(metrics.profitability.aiVariableCostUsd)}</span></dd>
                </div>
                <div>
                  <dt>Fixed platform cost</dt>
                  <dd><span>{formatMoney(metrics.profitability.platformFixedCostUsd)}</span></dd>
                </div>
                <div>
                  <dt>Payment fees</dt>
                  <dd><span>{formatMoney(metrics.profitability.paymentFeesUsd)}</span></dd>
                </div>
                <div>
                  <dt>Revenue / active user</dt>
                  <dd><span>{formatMoney(metrics.profitability.revenuePerActiveUserUsd)}</span></dd>
                </div>
              </dl>
            </div>

            <div className="owner-detail-panel compact-panel">
              <SectionHeading
                eyebrow="Reconciliation"
                title="Launch finance checklist"
                body="Use this before treating estimates as financial reporting."
              />
              <ul className="owner-checklist">
                <li>Match RevenueCat purchases and entitlements to credit ledger grants.</li>
                <li>Match Stripe/payment-provider receipts, refunds, and duplicate webhooks.</li>
                <li>Compare OpenAI usage against credit-consuming feature events.</li>
                <li>Compare Vercel and Supabase exports against fixed platform assumptions.</li>
                <li>Export the selected date range for owner review before launch reporting.</li>
              </ul>
            </div>
          </div>

          <div className="owner-table profitability-table" role="table" aria-label="User economics">
            <div className="owner-table-row owner-table-head" role="row">
              <span>User</span>
              <span>Paid</span>
              <span>Credits</span>
              <span>Estimated cost</span>
              <span>Profit</span>
            </div>
            {metrics.profitability.userEconomics.length > 0 ? (
              metrics.profitability.userEconomics.map((user) => (
                <div className="owner-table-row" key={user.userId} role="row">
                  <span>
                    <strong>{user.email || "No email"}</strong>
                    <small>{user.userId}</small>
                  </span>
                  <span>
                    <strong>{formatMoney(user.paidUsd)}</strong>
                    <small>period purchases</small>
                  </span>
                  <span>
                    <strong>{user.creditsUsed} used</strong>
                    <small>{user.creditsAvailable} available</small>
                  </span>
                  <span>
                    <strong>{formatMoney(user.estimatedCostUsd)}</strong>
                    <small>variable + allocated fixed</small>
                  </span>
                  <span>
                    <strong>{formatMoney(user.grossProfitUsd)}</strong>
                    <small>{user.marginPercent.toFixed(1)}% margin</small>
                  </span>
                </div>
              ))
            ) : (
              <p className="empty-state">No user economics yet for this period.</p>
            )}
          </div>

          <div className="owner-table profitability-table" role="table" aria-label="Credit consumption evidence">
            <div className="owner-table-row owner-table-head" role="row">
              <span>Event</span>
              <span>User</span>
              <span>Credits</span>
              <span>Revenue / cost</span>
              <span>Resource</span>
            </div>
            {metrics.profitability.consumptionEvidence.length > 0 ? (
              metrics.profitability.consumptionEvidence.map((event, index) => (
                <div
                  className="owner-table-row"
                  key={`${event.userId}-${event.createdAt}-${event.eventType}-${index}`}
                  role="row"
                >
                  <span>
                    <strong>{formatLabel(event.eventType)}</strong>
                    <small>{formatDateTime(event.createdAt)}</small>
                  </span>
                  <span>
                    <strong>{event.email || "No email"}</strong>
                    <small>{event.userId}</small>
                  </span>
                  <span>
                    <strong>{event.credits > 0 ? `+${event.credits}` : event.credits}</strong>
                    <small>{event.credits < 0 ? "consumed" : "granted/purchased"}</small>
                  </span>
                  <span>
                    <strong>{formatMoney(event.paidUsd)}</strong>
                    <small>{formatMoney(event.estimatedCostUsd)} estimated cost</small>
                  </span>
                  <span>
                    <strong>{event.resourceType || "general"}</strong>
                    <small>{event.resourceId || "No resource id"}</small>
                  </span>
                </div>
              ))
            ) : (
              <p className="empty-state">No credit events in this period.</p>
            )}
          </div>
        </section>
      ) : null}

      {activeTab === "compliance" ? (
        <section className="owner-detail-panel owner-wide-panel" aria-label="Compliance readiness">
          <SectionHeading
            eyebrow="Compliance readiness"
            title="Privacy operations and audit evidence"
            body="Track practical privacy controls, request aging, incident review, subprocessors, retention posture, and production hardening gaps. This is operational readiness, not a certification claim."
          />
          <div className="owner-form-actions">
            <button className="owner-action-button secondary" disabled={complianceLoading} onClick={loadCompliance} type="button">
              <RefreshCcw aria-hidden="true" size={16} />
              {complianceLoading ? "Loading..." : "Refresh compliance"}
            </button>
          </div>
          {complianceMessage ? <p className="owner-generated-note">{complianceMessage}</p> : null}
          {!compliance && !complianceLoading ? (
            <p className="empty-state">Open this tab to load compliance readiness data.</p>
          ) : null}
          {compliance ? (
            <>
              <div className="profitability-grid" aria-label="Compliance summary">
                <FinancialTile label="Open requests" value={String(compliance.privacyRequests.open)} />
                <FinancialTile
                  label="Overdue requests"
                  tone={compliance.privacyRequests.overdue > 0 ? "warning" : "normal"}
                  value={String(compliance.privacyRequests.overdue)}
                />
                <FinancialTile label="Completed 30d" value={String(compliance.privacyRequests.completedRecent)} />
                <FinancialTile label="Open incidents" value={String(compliance.incidents.open)} />
                <FinancialTile
                  label="72h review overdue"
                  tone={compliance.incidents.overdueNotificationReview > 0 ? "warning" : "normal"}
                  value={String(compliance.incidents.overdueNotificationReview)}
                />
                <FinancialTile label="Inventory tables" value={String(compliance.dataInventory.length)} />
              </div>

              <div className="owner-detail-grid two-column">
                <div className="owner-detail-panel compact-panel">
                  <SectionHeading
                    eyebrow="Privacy requests"
                    title="Open request queue"
                    body="Requests should move through review without exposing sensitive free text in logs."
                  />
                  <dl className="metric-list">
                    {Object.entries(compliance.privacyRequests.countsByType).map(([type, count]) => (
                      <div key={type}>
                        <dt>{formatLabel(type)}</dt>
                        <dd><span>{count}</span></dd>
                      </div>
                    ))}
                  </dl>
                  <div className="owner-table compact-owner-table" role="table" aria-label="Open privacy requests">
                    {groupPrivacyRequestsById(compliance.privacyRequests.recentOpen).map((request) => (
                      <div className="owner-table-row" key={request.id} role="row">
                        <span>
                          <strong>{request.subject ?? formatLabel(request.requestType)}</strong>
                          <small>
                            {formatLabel(request.status)} · due {request.dueAt ? formatDate(request.dueAt) : "not set"}
                            {request.count > 1 ? ` · ${request.count} grouped rows` : ""}
                          </small>
                        </span>
                        <span>
                          <strong>{formatLabel(request.requestType)}</strong>
                          <small>{request.userId}</small>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="owner-detail-panel compact-panel">
                  <SectionHeading
                    eyebrow="Incidents"
                    title="Security incident log summary"
                    body="Notification deadlines are surfaced for review only and are not legal advice."
                  />
                  <dl className="metric-list">
                    <div>
                      <dt>Notification review flagged</dt>
                      <dd><span>{compliance.incidents.breachNotificationReviewCount}</span></dd>
                    </div>
                    <div>
                      <dt>Open incident records</dt>
                      <dd><span>{compliance.incidents.open}</span></dd>
                    </div>
                  </dl>
                  <div className="owner-table compact-owner-table" role="table" aria-label="Recent incidents">
                    {compliance.incidents.recent.map((incident) => (
                      <div className="owner-table-row" key={incident.id} role="row">
                        <span>
                          <strong>{incident.title}</strong>
                          <small>{formatLabel(incident.severity)} · {formatLabel(incident.status)} · {formatDate(incident.detectedAt)}</small>
                        </span>
                        <span>
                          <strong>{incident.notificationDeadlineAt ? formatDate(incident.notificationDeadlineAt) : "No deadline"}</strong>
                          <small>72h-style review target when notification may be required</small>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="owner-table profitability-table" role="table" aria-label="Data inventory summary">
                <div className="owner-table-row owner-table-head" role="row">
                  <span>Data category</span>
                  <span>Table</span>
                  <span>Records</span>
                </div>
                {compliance.dataInventory.map((item) => (
                  <div className="owner-table-row" key={item.table} role="row">
                    <span><strong>{item.label}</strong></span>
                    <span><small>{item.table}</small></span>
                    <span><strong>{item.count.toLocaleString()}</strong></span>
                  </div>
                ))}
              </div>

              <div className="owner-detail-grid two-column">
                <ComplianceListPanel title="Subprocessors" items={compliance.subprocessors.map((item) => ({
                  detail: `${item.processingPurpose} Data: ${item.dataCategories.join(", ")} Region: ${item.hostingRegion}`,
                  label: item.name,
                  status: item.status,
                }))} />
                <ComplianceListPanel title="Retention policy status" items={compliance.retentionPolicies.map((item) => ({
                  detail: item.retentionRule,
                  label: item.dataCategory,
                  status: item.status,
                }))} />
              </div>

              <ComplianceListPanel
                title="Production hardening checklist"
                items={compliance.hardeningChecklist.map((item) => ({
                  detail: "Tracked as a remaining operational task before public launch.",
                  label: item.item,
                  status: item.status,
                }))}
              />

              <p className="owner-generated-note">
                Compliance dashboard generated {formatDateTime(compliance.generatedAt)}.
              </p>
            </>
          ) : null}
        </section>
      ) : null}

      {activeTab === "configuration" ? (
        <section className="owner-detail-panel owner-wide-panel" aria-label="Tier configuration">
          <SectionHeading
            eyebrow="Tiers"
            title="Tier and limit configuration"
            body="Create or update application and generation limits without a code change. Changes are owner/admin actions and should match the approved launch policy."
          />
          <p className="owner-generated-note">
            Payment gateway removal is dismissed/backlog as a policy change because live payments were explicitly approved. This panel manages tier limits; it does not disable RevenueCat, Stripe-style reconciliation, or credit purchases.
          </p>
          {tierMessage ? <p className="owner-generated-note">{tierMessage}</p> : null}
          <div className="owner-credit-actions">
            <article className="owner-credit-card">
              <div className="owner-credit-card-header">
                <CircleDollarSign aria-hidden="true" size={22} />
                <div>
                  <h3>Create a tier</h3>
                  <p>Use lower-case keys such as launch_starter or beta-pro. Limits apply per period.</p>
                </div>
              </div>
              <TierForm
                disabled={tierLoading}
                onSubmit={saveTierConfig}
                submitLabel="Create tier"
              />
            </article>
          </div>
          <div className="owner-table owner-tier-table" role="table" aria-label="Tier list">
            <div className="owner-table-row owner-table-head" role="row">
              <span>Tier</span>
              <span>Limits</span>
              <span>Status</span>
              <span>Update</span>
            </div>
            {tiers.length > 0 ? (
              tiers.map((tier) => (
                <div className="owner-table-row owner-tier-row" key={tier.id} role="row">
                  <span>
                    <strong>{tier.name}</strong>
                    <small>{tier.key} · updated {formatDate(tier.updatedAt)}</small>
                  </span>
                  <span>
                    <strong>{tier.applicationLimit} applications</strong>
                    <small>{tier.generationLimit} generations · {tier.periodDays}d period</small>
                  </span>
                  <span>
                    <strong>{tier.isActive ? "Active" : "Inactive"}</strong>
                    <small>{tier.description || "No description"}</small>
                  </span>
                  <span>
                    <TierForm
                      disabled={tierLoading}
                      onSubmit={saveTierConfig}
                      submitLabel="Save tier"
                      tier={tier}
                    />
                  </span>
                </div>
              ))
            ) : (
              <p className="empty-state">
                {tierLoading ? "Loading tiers..." : "No tiers loaded yet. Refresh to read tier configuration."}
              </p>
            )}
          </div>
          <div className="owner-form-actions">
            <button className="owner-action-button secondary" disabled={tierLoading} onClick={() => loadTiers()} type="button">
              <RefreshCcw aria-hidden="true" size={16} />
              Refresh tiers
            </button>
          </div>
        </section>
      ) : null}

      {activeTab === "billing" ? (
        <section className="owner-detail-panel owner-wide-panel" aria-label="Promo codes">
          <SectionHeading
            eyebrow="Credits"
            title="Promo code management"
            body="Create redeemable codes or grant credits directly to one or more users. Both paths write to the credit ledger so owner actions remain auditable."
          />
          <div className="owner-credit-actions">
            <article className="owner-credit-card">
              <div className="owner-credit-card-header">
                <CircleDollarSign aria-hidden="true" size={22} />
                <div>
                  <h3>Generate a promo code</h3>
                  <p>Best for launch campaigns, beta groups, or a user who should redeem the grant themselves.</p>
                </div>
              </div>
              <form className="owner-credit-form owner-credit-form-promo" onSubmit={createPromoCode}>
                <label className="owner-field-code">
                  <span>Code</span>
                  <input name="code" placeholder="BETA-THANKYOU" required />
                </label>
                <label className="owner-field-small">
                  <span>Credits</span>
                  <input name="creditAmount" defaultValue="10" min="1" max="500" required type="number" />
                </label>
                <label className="owner-field-small">
                  <span>Max redemptions</span>
                  <input name="maxRedemptions" defaultValue="1" min="1" max="5000" required type="number" />
                </label>
                <label className="owner-field-medium">
                  <span>User email optional</span>
                  <input name="assignedUserEmail" placeholder="specific.user@example.com" type="email" />
                </label>
                <label className="owner-field-medium">
                  <span>Expiry optional</span>
                  <input name="expiresAt" type="datetime-local" />
                </label>
                <label className="owner-credit-description">
                  <span>Description</span>
                  <input name="description" placeholder="Why this code exists" required />
                </label>
                <p className="owner-credit-guardrail">
                  Owner reason is required. High-total codes ask for confirmation before creation.
                </p>
                <label className="owner-safety-checkbox">
                  <input name="sandboxQaComplete" type="checkbox" />
                  <span>Sandbox QA completed for creation, redemption, and expiry behavior.</span>
                </label>
                <div className="owner-form-actions">
                  <button className="owner-action-button primary" disabled={promoLoading} type="submit">
                    Create code
                  </button>
                  <button
                    className="owner-action-button secondary"
                    disabled={promoLoading}
                    onClick={() => loadPromoCodes()}
                    type="button"
                  >
                    <RefreshCcw aria-hidden="true" size={16} />
                    Refresh
                  </button>
                </div>
              </form>
              {promoMessage ? <p className="owner-generated-note">{promoMessage}</p> : null}
            </article>
            <article className="owner-credit-card owner-credit-card-direct">
              <div className="owner-credit-card-header">
                <UsersRound aria-hidden="true" size={22} />
                <div>
                  <h3>Add credits to users</h3>
                  <p>Use this when you want grants to land immediately without asking recipients for a code.</p>
                </div>
              </div>
              <form className="owner-credit-form owner-credit-form-direct" onSubmit={grantCreditsDirectly}>
                <div className="owner-user-picker">
                  <span className="owner-field-label">Recipients</span>
                  <div className="owner-user-picker-combobox">
                    <div className="owner-user-picker-input">
                      {selectedGrantTargets.map((target) => (
                        <button
                          className="owner-user-chip"
                          key={target.userId}
                          onClick={() => removeGrantTarget(target.userId)}
                          title="Remove recipient"
                          type="button"
                        >
                          <span>{formatGrantTargetLabel(target)}</span>
                          <small>{target.email && target.displayName ? target.email : target.userId}</small>
                        </button>
                      ))}
                      <input
                        aria-autocomplete="list"
                        aria-controls={
                          shouldShowGrantTargetSuggestions ? "owner-credit-user-suggestions" : undefined
                        }
                        aria-expanded={shouldShowGrantTargetSuggestions}
                        id="credit-grant-recipient-search"
                        onChange={(event) => setGrantTargetQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            selectFirstGrantTargetSuggestion();
                          }

                          if (
                            event.key === "Backspace" &&
                            !grantTargetQuery &&
                            selectedGrantTargets.length > 0
                          ) {
                            removeGrantTarget(selectedGrantTargets[selectedGrantTargets.length - 1].userId);
                          }
                        }}
                        placeholder={
                          selectedGrantTargets.length > 0
                            ? "Add another user..."
                            : "Search name, email, or user id"
                        }
                        role="combobox"
                        value={grantTargetQuery}
                      />
                    </div>
                    {shouldShowGrantTargetSuggestions ? (
                      <div className="owner-user-suggestions" id="owner-credit-user-suggestions" role="listbox">
                        {grantTargetSuggestions.length > 0 ? (
                          grantTargetSuggestions.map((target) => (
                            <button
                              aria-selected="false"
                              className="owner-user-suggestion"
                              key={target.userId}
                              onClick={() => addGrantTarget(target)}
                              role="option"
                              type="button"
                            >
                              <strong>{formatGrantTargetLabel(target)}</strong>
                              <small>{[target.email, target.userId].filter(Boolean).join(" · ")}</small>
                            </button>
                          ))
                        ) : (
                          <p>No matching user. Paste an exact email or user id and submit.</p>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <small>Choose one or more users. Each grant is written as a separate ledger event.</small>
                </div>
                <label className="owner-field-small">
                  <span>Credits</span>
                  <input name="creditAmount" defaultValue="10" min="1" max="500" required type="number" />
                </label>
                <label className="owner-credit-description">
                  <span>Owner note</span>
                  <input name="description" placeholder="Beta goodwill, support fix, launch grant..." required />
                </label>
                <p className="owner-credit-guardrail">
                  Each recipient receives a separate ledger event. High-total grants ask for confirmation.
                </p>
                <label className="owner-safety-checkbox">
                  <input name="sandboxQaComplete" type="checkbox" />
                  <span>Sandbox QA completed for credit grant ledger and admin audit behavior.</span>
                </label>
                <div className="owner-form-actions">
                  <button className="owner-action-button primary" disabled={grantLoading} type="submit">
                    Add credits
                  </button>
                </div>
              </form>
              {grantMessage ? <p className="owner-generated-note">{grantMessage}</p> : null}
            </article>
          </div>
          <div className="owner-table owner-promo-table" role="table" aria-label="Promo code list">
            <div className="owner-table-row owner-table-head" role="row">
              <span>Code</span>
              <span>Credits</span>
              <span>Scope</span>
              <span>Redemptions</span>
            </div>
            {promoCodes.length > 0 ? (
              promoCodes.map((promo) => {
                const promoState = computePromoCodeState(promo);

                return (
                  <div className="owner-table-row" key={promo.id} role="row">
                    <span>
                      <strong>{promo.code}</strong>
                      <small>{promo.description || "No description"}</small>
                    </span>
                    <span>
                      <strong>{promo.creditAmount}</strong>
                      <small>{promoState}</small>
                    </span>
                    <span>
                      <strong>{promo.assignedUserEmail ?? "General"}</strong>
                      <small>{promo.expiresAt ? `Expires ${formatDateTime(promo.expiresAt)}` : "No expiry"}</small>
                    </span>
                    <span>
                      <strong>{promo.redeemedCount} / {promo.maxRedemptions}</strong>
                      <small>created {formatDate(promo.createdAt)}</small>
                    </span>
                  </div>
                );
              })
            ) : (
              <p className="empty-state">No promo codes loaded yet.</p>
            )}
          </div>
        </section>
      ) : null}

      <p className="owner-generated-note">
        Generated {formatDateTime(metrics.generatedAt)} for {formatOwnerPeriod(metrics.period.days, periodDays)}.
      </p>
    </main>
  );
}

function TierForm({
  disabled,
  onSubmit,
  submitLabel,
  tier,
}: {
  disabled: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  tier?: TierConfigRow;
}) {
  return (
    <form className={tier ? "owner-credit-form owner-tier-form compact" : "owner-credit-form owner-tier-form"} onSubmit={onSubmit}>
      {tier ? <input name="id" type="hidden" value={tier.id} /> : null}
      <label className={tier ? "owner-field-medium" : "owner-field-small"}>
        <span>Key</span>
        <input
          defaultValue={tier?.key ?? ""}
          name="key"
          placeholder="launch_starter"
          required
        />
      </label>
      <label className={tier ? "owner-field-medium" : "owner-field-small"}>
        <span>Name</span>
        <input
          defaultValue={tier?.name ?? ""}
          name="name"
          placeholder="Launch Starter"
          required
        />
      </label>
      <label className="owner-field-small">
        <span>Applications</span>
        <input
          defaultValue={tier?.applicationLimit ?? 5}
          min="0"
          max="10000"
          name="applicationLimit"
          required
          type="number"
        />
      </label>
      <label className="owner-field-small">
        <span>Generations</span>
        <input
          defaultValue={tier?.generationLimit ?? 25}
          min="0"
          max="10000"
          name="generationLimit"
          required
          type="number"
        />
      </label>
      <label className="owner-field-small">
        <span>Period days</span>
        <input
          defaultValue={tier?.periodDays ?? 30}
          min="1"
          max="366"
          name="periodDays"
          required
          type="number"
        />
      </label>
      <label className="owner-tier-active-toggle">
        <input
          defaultChecked={tier?.isActive ?? true}
          name="isActive"
          type="checkbox"
        />
        <span>Active</span>
      </label>
      <label className="owner-credit-description">
        <span>Description / owner note</span>
        <input
          defaultValue={tier?.description ?? ""}
          name="description"
          placeholder="What this tier is for and who approved it"
          required
        />
      </label>
      <p className="owner-credit-guardrail">
        Saving writes an audit event. Disable a tier instead of deleting it when active users or quota history may rely on it.
      </p>
      <label className="owner-safety-checkbox">
        <input name="sandboxQaComplete" type="checkbox" />
        <span>Sandbox QA completed for tier update, quota refresh, and audit behavior.</span>
      </label>
      <div className="owner-form-actions">
        <button className="owner-action-button primary" disabled={disabled} type="submit">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function MetricCard({
  detail,
  icon: Icon,
  label,
  onClick,
  tone = "normal",
  value,
}: {
  detail: string;
  icon: typeof UsersRound;
  label: string;
  onClick?: () => void;
  tone?: "normal" | "warning";
  value: number | string;
}) {
  const className = [
    "owner-metric-card",
    tone === "warning" ? "warning" : "",
    onClick ? "interactive" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const content = (
    <>
      <div>
        <Icon size={18} aria-hidden="true" />
        <span>{label}</span>
      </div>
      <strong>{typeof value === "number" ? value.toLocaleString() : value}</strong>
      <p>{detail}</p>
    </>
  );

  if (onClick) {
    return (
      <button className={className} onClick={onClick} type="button">
        {content}
      </button>
    );
  }

  return (
    <article className={className}>
      {content}
    </article>
  );
}

function FinancialTile({
  label,
  tone = "normal",
  value,
}: {
  label: string;
  tone?: "normal" | "warning";
  value: number | string;
}) {
  return (
    <article className={tone === "warning" ? "financial-tile warning" : "financial-tile"}>
      <span>{label}</span>
      <strong>{typeof value === "number" ? value.toLocaleString() : value}</strong>
    </article>
  );
}

type CommandCenterCardModel = {
  actionLabel: string;
  body: string;
  count: number;
  icon: typeof UsersRound;
  meta: string;
  targetRootCause?: string | null;
  targetTab: AdminSection;
  title: string;
  tone: "critical" | "normal" | "warning";
};

function CommandCenterCard({
  card,
  onAction,
}: {
  card: CommandCenterCardModel;
  onAction: () => void;
}) {
  const Icon = card.icon;

  return (
    <article className={`owner-command-card ${card.tone}`}>
      <div className="owner-command-card-header">
        <Icon aria-hidden="true" size={19} />
        <div>
          <span>{card.meta}</span>
          <h3>{card.title}</h3>
        </div>
        <strong>{card.count.toLocaleString()}</strong>
      </div>
      <p>{card.body}</p>
      <button className="secondary-action compact-action" onClick={onAction} type="button">
        {card.actionLabel}
      </button>
    </article>
  );
}

function UserDetailDrawer({
  metrics,
  onClose,
  periodDays,
  user,
}: {
  metrics: OwnerMetrics;
  onClose: () => void;
  periodDays: number;
  user: OwnerMetrics["usersList"][number];
}) {
  const userEmail = user.email?.toLowerCase();
  const recentErrors = metrics.errorDetails
    .filter((error) => userEmail && error.userEmail?.toLowerCase() === userEmail)
    .slice(0, 5);
  const openTickets = metrics.supportTickets
    .filter((ticket) => userEmail && ticket.userEmail?.toLowerCase() === userEmail)
    .filter((ticket) => !["resolved", "closed"].includes(ticket.status))
    .slice(0, 5);
  const ledgerEvents = metrics.profitability.consumptionEvidence
    .filter((event) => event.userId === user.userId)
    .slice(0, 5);
  const signals = getUserAttentionSignals(user, metrics);

  return (
    <aside className="owner-user-drawer" aria-label="User detail drawer">
      <div className="owner-user-drawer-header">
        <div>
          <p className="eyebrow">User workbench</p>
          <h3>{user.displayName || user.email || "Unnamed user"}</h3>
          <p>{user.email || user.userId}</p>
        </div>
        <button aria-label="Close user detail" className="owner-icon-button" onClick={onClose} type="button">
          <X aria-hidden="true" size={18} />
        </button>
      </div>

      <div className="owner-user-drawer-grid">
        <UserDrawerPanel title="Account and profile">
          <dl className="metric-list compact-metric-list">
            <div>
              <dt>Status</dt>
              <dd><span>{formatLabel(user.profileStatus ?? "missing")}</span></dd>
            </div>
            <div>
              <dt>Tier</dt>
              <dd><span>{user.tier}</span></dd>
            </div>
            <div>
              <dt>Last activity</dt>
              <dd><span>{formatRelativeTime(user.lastActivityAt ?? user.lastSignInAt ?? user.createdAt)}</span></dd>
            </div>
            <div>
              <dt>Attention</dt>
              <dd><span>{signals.length > 0 ? signals.join(", ") : "No current risk signal"}</span></dd>
            </div>
          </dl>
        </UserDrawerPanel>

        <UserDrawerPanel title="Credits and ledger">
          <p className="owner-drawer-summary">
            {user.creditsAvailable} available, {user.creditsUsed} used {periodDays === 0 ? "all time" : `in ${periodDays}d`}, {user.creditsUsedAllTime} lifetime.
          </p>
          <MiniRecordList
            empty="No recent credit ledger evidence in this period."
            items={ledgerEvents.map((event) => ({
              detail: `${event.credits > 0 ? "+" : ""}${event.credits} credits · ${formatMoney(event.estimatedCostUsd)} est. cost`,
              label: formatLabel(event.eventType),
              meta: formatDateTime(event.createdAt),
            }))}
          />
        </UserDrawerPanel>

        <UserDrawerPanel title="Open support">
          <MiniRecordList
            empty="No open support tickets."
            items={openTickets.map((ticket) => ({
              detail: `${formatLabel(ticket.priority)} · ${formatLabel(ticket.fixStatus)}`,
              label: ticket.subject,
              meta: formatAge(ticket.createdAt),
            }))}
          />
        </UserDrawerPanel>

        <UserDrawerPanel title="Recent errors">
          <MiniRecordList
            empty="No recent linked errors."
            items={recentErrors.map((error) => ({
              detail: `${formatLabel(error.area)} · ${formatLabel(error.rootCause)}`,
              label: error.summary,
              meta: formatAge(error.createdAt),
            }))}
          />
        </UserDrawerPanel>

        <UserDrawerPanel title="Workspace counts">
          <dl className="metric-list compact-metric-list">
            <div>
              <dt>Sources</dt>
              <dd><span>{user.sources}</span></dd>
            </div>
            <div>
              <dt>Resumes</dt>
              <dd><span>{user.resumes}</span></dd>
            </div>
            <div>
              <dt>Applications</dt>
              <dd><span>{user.applications}</span></dd>
            </div>
            <div>
              <dt>Materials</dt>
              <dd><span>{user.resumes + user.applications}</span></dd>
            </div>
          </dl>
        </UserDrawerPanel>

        <UserDrawerPanel title="Admin access audit reason">
          <p className="owner-drawer-summary">
            owner_support_triage: support-safe review of account status, aggregate activity, credits, linked support tickets, and recent error metadata.
          </p>
        </UserDrawerPanel>
      </div>
    </aside>
  );
}

function UserDrawerPanel({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="owner-user-drawer-panel">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function MiniRecordList({
  empty,
  items,
}: {
  empty: string;
  items: { detail: string; label: string; meta: string }[];
}) {
  if (items.length === 0) {
    return <p className="empty-state compact-empty">{empty}</p>;
  }

  return (
    <ol className="owner-mini-record-list">
      {items.map((item) => (
        <li key={`${item.label}-${item.meta}`}>
          <strong>{item.label}</strong>
          <span>{item.detail}</span>
          <small>{item.meta}</small>
        </li>
      ))}
    </ol>
  );
}

function ComplianceListPanel({
  items,
  title,
}: {
  items: { detail: string; label: string; status: string }[];
  title: string;
}) {
  return (
    <div className="owner-detail-panel compact-panel">
      <SectionHeading
        eyebrow="Compliance"
        title={title}
        body="Review status and detail before relying on this in production operations."
      />
      <div className="owner-table compact-owner-table" role="table" aria-label={title}>
        {items.map((item) => (
          <div className="owner-table-row" key={`${item.label}-${item.status}`} role="row">
            <span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
            <span>
              <strong>{formatLabel(item.status)}</strong>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionHeading({ body, eyebrow, title }: { body: string; eyebrow: string; title: string }) {
  return (
    <div className="section-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function TrendPanel({ title, values }: { title: string; values: OwnerMetrics["trends"]["daily"] }) {
  const maxValue = Math.max(
    1,
    ...values.map((value) => value.pageViews + value.applications + value.errors + value.tickets),
  );

  return (
    <div className="owner-detail-panel">
      <SectionHeading
        eyebrow="Trend"
        title={title}
        body="Shows whether acquisition, usage, errors, and support are moving together or diverging."
      />
      <div className="owner-bar-chart" aria-label={title}>
        {values.map((value) => {
          const total = value.pageViews + value.applications + value.errors + value.tickets;
          return (
            <div key={value.date} title={`${formatDate(value.date)}: ${total} events`}>
              <span style={{ height: `${Math.max(4, (total / maxValue) * 100)}%` }} />
              <small>{new Date(value.date).getDate()}</small>
            </div>
          );
        })}
      </div>
      <div className="owner-chart-legend">
        <span><BarChart3 size={14} /> Usage</span>
        <span><BriefcaseBusiness size={14} /> Applications</span>
        <span><AlertTriangle size={14} /> Errors</span>
      </div>
    </div>
  );
}

function PlatformStatusPanel({
  cleanupLoading,
  cleanupResult,
  onApplyCleanup,
  onPreviewCleanup,
  status,
}: {
  cleanupLoading: boolean;
  cleanupResult: ArtifactCleanupResult | null;
  onApplyCleanup: () => void;
  onPreviewCleanup: () => void;
  status: PlatformStatusOverview;
}) {
  const cleanupChecks = status.checks.filter((check) => check.impact === "cleanup");

  return (
    <div className="platform-status-grid">
      <article className={`platform-status-summary ${status.overallStatus}`}>
        <Activity size={18} aria-hidden="true" />
        <span>Overall</span>
        <strong>{formatLabel(status.overallStatus)}</strong>
        <p>
          {status.recentSignals.activeErrors24h} active errors, {status.recentSignals.sourceFailures24h} source failures,
          and {status.recentSignals.jobFailures24h} job failures in the last 24 hours. Cleanup items do not mark
          availability degraded.
        </p>
      </article>
      <article className={`platform-status-check ${status.release.provenanceAvailable ? "healthy" : "degraded"}`}>
        <div>
          <span>Release</span>
          <strong>{status.release.provenanceAvailable ? shortReleaseSha(status.release.gitCommitSha) : "Incomplete"}</strong>
        </div>
        <p>
          {status.release.gitCommitRef ?? "Unknown branch"} · {formatLabel(status.release.targetEnvironment)}
        </p>
        <small>
          Deployment {formatReleaseUrl(status.release.deploymentUrl)} · Captured {formatDateTime(status.release.capturedAt)}
        </small>
        {status.release.branchUrl ? <small>Branch URL {formatReleaseUrl(status.release.branchUrl)}</small> : null}
      </article>
      {status.checks.map((check) => (
        <article className={`platform-status-check ${check.state}`} key={check.label}>
          <div>
            <span>{check.label}</span>
            <strong>{formatPlatformCheckState(check)}</strong>
          </div>
          <p>{check.details}</p>
          <small>
            Last success {check.lastSuccessAt ? formatDateTime(check.lastSuccessAt) : "not recorded"} · Last failure{" "}
            {check.lastFailureAt ? formatDateTime(check.lastFailureAt) : "not recorded"}
          </small>
          {check.impact === "cleanup" ? <small>Clears when stale records are reset or regenerated.</small> : null}
        </article>
      ))}
      {cleanupChecks.some((check) => check.state === "degraded" || check.state === "down") ? (
        <article className="platform-status-cleanup">
          <div>
            <span>Artifact cleanup</span>
            <strong>{cleanupResult ? `${cleanupResult.staleCount.toLocaleString()} found` : "Preview first"}</strong>
          </div>
          <p>
            Preview stale ready records, then reset them to draft so the export workflow can regenerate clean PDF/DOCX
            artifacts.
          </p>
          {cleanupResult?.reports.length ? (
            <ul>
              {cleanupResult.reports.slice(0, 5).map((report) => (
                <li key={report.id}>
                  <strong>{report.resumeType}</strong>
                  <span>
                    {report.missingArtifacts.join(" + ").toUpperCase()} missing · {formatDateTime(report.updatedAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="platform-cleanup-actions">
            <button className="secondary-action" disabled={cleanupLoading} onClick={onPreviewCleanup} type="button">
              Preview cleanup
            </button>
            <button
              className="secondary-action"
              disabled={cleanupLoading || !cleanupResult?.reports.length || !cleanupResult.dryRun}
              onClick={onApplyCleanup}
              type="button"
            >
              Apply cleanup
            </button>
          </div>
        </article>
      ) : null}
    </div>
  );
}

function formatPlatformCheckState(check: PlatformStatusOverview["checks"][number]) {
  if (check.impact === "cleanup" && check.state === "degraded") {
    return "Cleanup needed";
  }

  return formatLabel(check.state);
}

function shortReleaseSha(value: string | null) {
  return value ? value.slice(0, 7) : "Unknown";
}

function formatReleaseUrl(value: string | null) {
  return value ? value.replace(/^https?:\/\//, "") : "not exposed";
}

function PageUsagePanel({ values }: { values: OwnerMetrics["trends"]["pageUsage"] }) {
  return (
    <div className="owner-detail-panel">
      <SectionHeading
        eyebrow="Behavior"
        title="Time spent by page"
        body="Use this to find where users linger, get stuck, or return repeatedly."
      />
      {values.length > 0 ? (
        <dl className="owner-page-usage-list">
          {values.map((value) => (
            <div key={value.page}>
              <dt>
                <Clock3 size={14} aria-hidden="true" />
                {formatLabel(value.page)}
              </dt>
              <dd>
                {formatDuration(value.totalSeconds)} · {value.views} views · {value.uniqueUsers} users
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="empty-state">No page timing yet. It will populate as authenticated users move through the app.</p>
      )}
    </div>
  );
}

function MetricBreakdown({
  actionLabel,
  onSelect,
  title,
  values,
}: {
  actionLabel?: string;
  onSelect?: (label: string) => void;
  title: string;
  values: Record<string, number>;
}) {
  const entries = Object.entries(values);

  return (
    <div className="owner-detail-panel">
      <SectionHeading
        eyebrow="Usage"
        title={title}
        body="Useful when it points to adoption, friction, or an unexpected concentration."
      />
      {entries.length > 0 ? (
        <dl className="metric-list">
          {entries.map(([label, value]) => (
            <div key={label}>
              <dt>{formatLabel(label)}</dt>
              <dd>
                <span>{value.toLocaleString()}</span>
                {onSelect ? (
                  <button onClick={() => onSelect(label)} type="button">
                    {actionLabel ?? "Open"}
                  </button>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="empty-state">No activity recorded yet.</p>
      )}
    </div>
  );
}

function RootCauseDrilldown({
  errors,
  group,
  onOpenSupport,
  queueMode,
  tickets,
  updateIssue,
}: {
  errors: OwnerMetrics["errorDetails"];
  group: RootCauseGroup;
  onOpenSupport: () => void;
  queueMode: "open" | "history" | "all";
  tickets: OwnerMetrics["supportTickets"];
  updateIssue: (
    issueId: string,
    patch: {
      closedReason?: string;
      fixStatus?: string;
      ownerNotes?: string;
      resolutionVerification?: string;
      status?: string;
      userVisibleResolution?: string;
    },
  ) => Promise<void>;
}) {
  const fixRequired = errors.filter((error) => error.fixRequired).length;
  const newest = errors[0];
  const suggestedFix = newest ? suggestErrorFix(newest) : "Review linked support tickets and recent user context.";
  const openTickets = tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status));
  const retainedOnly = queueMode === "history" || readRootCauseQueueStatus(group) === "history";
  const ownerAction = retainedOnly
    ? "This is retained evidence. Reopen only if a new active error or support ticket appears for the same cause."
    : openTickets.length > 0
      ? "Open the linked tickets, review supporting logs, apply the product or guidance fix, verify the workflow, then mark fixed with a user-visible note."
      : "No linked support ticket is open. Use the retained signals to fix the product path or improve recovery copy, then verify the workflow and watch for recurrence.";

  return (
    <section className="root-cause-drilldown" aria-label={`${formatLabel(group.displayName)} root-cause drilldown`}>
      <div>
        <p className="eyebrow">Root cause drilldown</p>
        <h3>{formatLabel(group.displayName)}</h3>
        <p>
          {group.totalSignals.toLocaleString()} retained signal{group.totalSignals === 1 ? "" : "s"},{" "}
          {group.impactedUsers || "unknown"} affected user{group.impactedUsers === 1 ? "" : "s"},{" "}
          {fixRequired.toLocaleString()} active fix signal{fixRequired === 1 ? "" : "s"}, and{" "}
          {openTickets.length.toLocaleString()} linked open support ticket
          {openTickets.length === 1 ? "" : "s"}. First seen {formatDateTime(group.firstSeenAt)};
          latest {formatAge(group.latestAt)} old.
        </p>
      </div>
      <div className="root-cause-action-grid">
        <article>
          <span>Likely rationale</span>
          <p>{newest?.rationale || "No rationale captured yet. Treat this as a triage gap."}</p>
        </article>
        <article>
          <span>Recommended fix path</span>
          <p>{suggestedFix}</p>
        </article>
        <article>
          <span>Owner action</span>
          <p>{ownerAction}</p>
        </article>
      </div>
      <div className="root-cause-actions">
        {openTickets.length > 0 ? (
          <>
            <button className="secondary-action" onClick={onOpenSupport} type="button">
              <ExternalLink size={15} aria-hidden="true" />
              Open linked tickets
            </button>
            {openTickets.slice(0, 3).map((ticket) => (
              <button
                className="secondary-action"
                key={ticket.id}
                onClick={() =>
                  updateIssue(ticket.id, {
                    fixStatus: "investigating",
                    ownerNotes:
                      ticket.ownerNotes ||
                      `Owner triage started for ${formatLabel(group.displayName)}. Reviewing supporting logs and applying the appropriate product or guidance fix.`,
                    userVisibleResolution:
                      ticket.userVisibleResolution ||
                      "I am reviewing the linked details and will update this issue when the fix path is clear.",
                    status: "in_progress",
                  })
                }
                type="button"
              >
                <Wrench size={15} aria-hidden="true" />
                Start {ticket.id.slice(0, 8).toUpperCase()}
              </button>
            ))}
          </>
        ) : (
          <span className="root-cause-empty-action">
            {retainedOnly ? "No current owner action required." : "No linked support ticket. Fix and verify the workflow."}
          </span>
        )}
      </div>
    </section>
  );
}

function QueueModeControl({
  queueMode,
  setQueueMode,
}: {
  queueMode: "open" | "history" | "all";
  setQueueMode: (mode: "open" | "history" | "all") => void;
}) {
  return (
    <div className="owner-queue-toggle" aria-label="Queue view">
      {[
        ["open", "Open queue"],
        ["history", "Resolved history"],
        ["all", "All retained"],
      ].map(([value, label]) => (
        <button
          className={queueMode === value ? "active" : ""}
          key={value}
          onClick={() => setQueueMode(value as "open" | "history" | "all")}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function OutcomeBreakdown({
  title,
  values,
}: {
  title: string;
  values: Record<string, Record<string, number>>;
}) {
  const entries = Object.entries(values);
  const read = summarizeOutcomePattern(values);

  return (
    <div className="owner-detail-panel">
      <SectionHeading
        eyebrow="Outcomes"
        title={title}
        body={read}
      />
      {entries.length > 0 ? (
        <div className="owner-outcome-bars">
          {entries.map(([label, metrics]) => (
            <div className="owner-outcome-row" key={label}>
              <div>
                <strong>{formatLabel(label)}</strong>
                <span>{formatOutcomeVolume(metrics)}</span>
              </div>
              <OutcomeBar label="Interview" value={readOutcomeRate(metrics, "interviewRate")} />
              <OutcomeBar label="Selected" value={readOutcomeRate(metrics, "selectionRate")} />
              <OutcomeBar label="Rejected" value={readOutcomeRate(metrics, "rejectionRate")} muted />
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-state">No outcome data yet.</p>
      )}
    </div>
  );
}

function OutcomeBar({ label, muted = false, value }: { label: string; muted?: boolean; value: number }) {
  return (
    <div className={muted ? "outcome-bar muted" : "outcome-bar"}>
      <span>{label}</span>
      <div aria-label={`${label} ${formatRate(value)}`}>
        <i style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
      </div>
      <strong>{formatRate(value)}</strong>
    </div>
  );
}

function readOutcomeRate(metrics: Record<string, number>, key: string) {
  const requestedKey = normalizeMetricKey(key);
  const match = Object.entries(metrics).find(([metricKey]) => normalizeMetricKey(metricKey) === requestedKey);

  return match?.[1] ?? 0;
}

function normalizeMetricKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function formatOutcomeVolume(metrics: Record<string, number>) {
  const count =
    metrics.total ??
    metrics.applications ??
    metrics.logged ??
    metrics.count ??
    Object.entries(metrics)
      .filter(([key]) => !key.toLowerCase().includes("rate"))
      .reduce((sum, [, value]) => sum + value, 0);

  return `${Math.round(count).toLocaleString()} record${Math.round(count) === 1 ? "" : "s"}`;
}

function summarizeOutcomePattern(values: Record<string, Record<string, number>>) {
  const entries = Object.entries(values);
  const sampleRead = summarizeOutcomePatternWithSample(values, "outcome segment");

  if (entries.length === 0) {
    return sampleRead;
  }

  const ranked = entries
    .map(([label, metrics]) => ({
      interviewRate: readOutcomeRate(metrics, "interviewRate"),
      label,
      selectionRate: readOutcomeRate(metrics, "selectionRate"),
      volume: metrics.total ?? metrics.applications ?? metrics.logged ?? metrics.count ?? 0,
    }))
    .sort((a, b) => b.interviewRate + b.selectionRate - (a.interviewRate + a.selectionRate));

  const best = ranked[0];
  const weakest = [...ranked].sort((a, b) => a.interviewRate + a.selectionRate - (b.interviewRate + b.selectionRate))[0];

  if (!best || best.interviewRate + best.selectionRate === 0) {
    return `${sampleRead} Activity exists, but no interview or selection outcomes are showing yet.`;
  }

  if (weakest && weakest.label !== best.label) {
    return `${sampleRead} Current directional read: ${formatLabel(best.label)} is ahead of ${formatLabel(weakest.label)}; review the underlying records before changing guidance.`;
  }

  return `${sampleRead} Current directional read: ${formatLabel(best.label)} is ahead in this slice; verify with more records before treating it as a product conclusion.`;
}

function suggestErrorFix(error: OwnerMetrics["errorDetails"][number]) {
  if (!error.fixRequired) {
    return "Monitor recurrence; add user guidance if it repeats.";
  }

  const rootCause = error.rootCause.toLowerCase();

  if (rootCause.includes("schema") || rootCause.includes("validation")) {
    return "Fix parser/schema handling, add regression coverage, then mark linked ticket fixed.";
  }

  if (rootCause.includes("provider") || rootCause.includes("third")) {
    return "Add provider fallback or clearer user guidance; verify retry behavior.";
  }

  if (rootCause.includes("ocr") || rootCause.includes("extract")) {
    return "Review file-reading logs, add retry/fallback, and test the source type end to end.";
  }

  if (rootCause.includes("auth") || rootCause.includes("permission")) {
    return "Check auth/RLS path and confirm the user-facing message is actionable.";
  }

  return "Create a root-cause fix, link it to this error, and add a regression test.";
}

function formatAge(value: string) {
  const diffMs = Date.now() - new Date(value).getTime();
  const days = Math.floor(Math.max(0, diffMs) / 86_400_000);

  if (days <= 0) {
    const hours = Math.floor(Math.max(0, diffMs) / 3_600_000);
    return hours <= 0 ? "<1h" : `${hours}h`;
  }

  return `${days}d`;
}

function readIssueNote(
  notes: Record<string, string>,
  ticket: OwnerMetrics["supportTickets"][number],
  fallback: string,
) {
  const draft = notes[ticket.id]?.trim();
  const existing = ticket.ownerNotes?.trim();

  return draft || existing || fallback;
}

function readIssueResolutionNote(
  notes: Record<string, string>,
  ticket: OwnerMetrics["supportTickets"][number],
  fallback: string,
) {
  const draft = notes[ticket.id]?.trim();
  const existing = ticket.userVisibleResolution?.trim();

  return draft || existing || fallback;
}

function readIssueVerificationNote(
  notes: Record<string, string>,
  ticket: OwnerMetrics["supportTickets"][number],
  fallback: string,
) {
  const draft = notes[ticket.id]?.trim();
  const existing = ticket.resolutionVerification?.trim();

  return draft || existing || fallback;
}

function formatSupportReopenWindow(ticket: OwnerMetrics["supportTickets"][number]) {
  if (ticket.status === "closed") {
    return ticket.autoClosedAt
      ? `Closed automatically on ${formatDateTime(ticket.autoClosedAt)}.`
      : "Closed.";
  }

  if (ticket.status === "resolved" && ticket.reopenUntil) {
    return `Can be reopened until ${formatDateTime(ticket.reopenUntil)}.`;
  }

  return "Starts when the issue is resolved.";
}

function Pill({ children, tone }: { children: ReactNode; tone: "danger" | "neutral" }) {
  return <span className={tone === "danger" ? "owner-pill danger" : "owner-pill"}>{children}</span>;
}

function buildNeedsAttentionCards({
  compliance,
  metrics,
  platformStatus,
  promoCodes,
  rootCauseGroups,
  rootCauseLabels,
}: {
  compliance: ComplianceDashboard | null;
  metrics: OwnerMetrics;
  platformStatus: PlatformStatusOverview | null;
  promoCodes: PromoCodeRow[];
  rootCauseGroups: RootCauseGroup[];
  rootCauseLabels: Record<string, string>;
}): CommandCenterCardModel[] {
  const topRootCause = rootCauseGroups.find((group) => group.activeErrors + group.activeTickets > 0);
  const availabilityIssueCount = countAvailabilityPlatformIssues(platformStatus);
  const cleanupItemCount = countCleanupPlatformItems(platformStatus);
  const criticalIssueCount =
    metrics.systemHealth.fixRequired +
    metrics.systemHealth.profileExtractionFailures +
    metrics.systemHealth.jobIngestionFailures +
    availabilityIssueCount +
    cleanupItemCount;
  const urgentSupport = metrics.supportTickets.filter((ticket) => {
    const trustCritical = ticketMatchesSupportRiskFilter(ticket, "billing_refund") ||
      ticketMatchesSupportRiskFilter(ticket, "privacy") ||
      ticketMatchesSupportRiskFilter(ticket, "account_access") ||
      ticketMatchesSupportRiskFilter(ticket, "inaccurate_ai_output");

    return (
      supportTicketNeedsOwnerAction(ticket) &&
      (ticket.escalatedToL2 || ticket.priority === "urgent" || ticket.priority === "high" || trustCritical)
    );
  }).length;
  const userRisk = metrics.usersList.filter((user) =>
    userMatchesAdminQuickFilter(user, "needs_attention", metrics),
  ).length;
  const privacyCount = countActionableComplianceItems(compliance);
  const promoAnomalies = promoCodes.filter((promo) => promoNeedsOwnerAction(promo)).length;
  const largeGrantCount = metrics.profitability.consumptionEvidence.filter((event) => event.credits >= 100).length;

  return [
    {
      actionLabel: "Open health details",
      body:
        criticalIssueCount > 0
          ? `${metrics.systemHealth.fixRequired} fix-required errors, ${metrics.systemHealth.profileExtractionFailures} source failures, ${metrics.systemHealth.jobIngestionFailures} job ingestion failures, ${availabilityIssueCount} availability checks, and ${cleanupItemCount} cleanup items. Top queue: ${topRootCause ? rootCauseLabels[topRootCause.key] ?? formatLabel(topRootCause.displayName) : "none"}. Clears when the listed errors are resolved and cleanup items are repaired.`
          : "No critical platform issues are currently flagged in this period.",
      count: criticalIssueCount,
      icon: Gauge,
      meta: "Critical platform issues",
      targetRootCause: topRootCause?.key ?? null,
      targetTab: "operate",
      title: criticalIssueCount > 0 ? "Reliability needs review" : "Platform stable",
      tone: criticalIssueCount > 0 ? "critical" : "normal",
    },
    {
      actionLabel: "Open support ticket",
      body:
        urgentSupport > 0
          ? "Escalated, urgent, high-priority, billing, privacy, account-access, or inaccurate-output tickets need human review. Clears when tickets are resolved, closed, or waiting on the user."
          : "No trust-critical support tickets are waiting in the selected period.",
      count: urgentSupport,
      icon: HeartHandshake,
      meta: "Human support needed",
      targetTab: "support",
      title: urgentSupport > 0 ? "Human support queue is active" : "Support clear",
      tone: urgentSupport > 0 ? "warning" : "normal",
    },
    {
      actionLabel: "Open user",
      body:
        userRisk > 0
          ? "Users are flagged for stalled profiles, no credits after recent activity, open support, or repeated failures. Clears when those signals are resolved."
          : "No users are currently flagged by the quick-risk filters.",
      count: userRisk,
      icon: UsersRound,
      meta: "User risk",
      targetTab: "users",
      title: userRisk > 0 ? "Users may be blocked" : "No user risk spike",
      tone: userRisk > 0 ? "warning" : "normal",
    },
    {
      actionLabel: "Review",
      body:
        compliance && privacyCount > 0
          ? `${compliance.privacyRequests.overdue} overdue privacy requests, ${compliance.incidents.open} open incidents, and ${compliance.incidents.overdueNotificationReview} notification reviews need attention.`
          : compliance
            ? "No overdue privacy requests or open incident deadlines are currently flagged."
            : "Compliance queue is loading. Open the section if you need the latest privacy and incident detail.",
      count: privacyCount,
      icon: ShieldCheck,
      meta: "Privacy & compliance",
      targetTab: "compliance",
      title: privacyCount > 0 ? "Privacy or incident review due" : "Compliance queue clear",
      tone: privacyCount > 0 ? "critical" : "normal",
    },
    {
      actionLabel: "Open billing record",
      body:
        promoAnomalies + largeGrantCount > 0
          ? `${promoAnomalies} active promo states need review and ${largeGrantCount} large credit grants appear in ledger evidence. Clears when active anomalies are fixed or reviewed.`
          : "No expired, fully redeemed, inactive promo, or large grant anomaly is currently flagged.",
      count: promoAnomalies + largeGrantCount,
      icon: CircleDollarSign,
      meta: "Billing & credit anomalies",
      targetTab: "billing",
      title: promoAnomalies + largeGrantCount > 0 ? "Credit records need review" : "Credits reconciled",
      tone: promoAnomalies + largeGrantCount > 0 ? "warning" : "normal",
    },
  ];
}

function buildRootCauseDisplayLabels(groups: RootCauseGroup[]) {
  const displayCounts = groups.reduce<Record<string, number>>((counts, group) => {
    counts[group.displayName] = (counts[group.displayName] ?? 0) + 1;
    return counts;
  }, {});

  return groups.reduce<Record<string, string>>((labels, group) => {
    const base = formatAdminRootCauseLabel(group.displayName);
    const firstCode = group.signals.find((signal) => signal.code)?.code;

    labels[group.key] =
      displayCounts[group.displayName] > 1 && firstCode
        ? `${base} (${formatAdminRootCauseLabel(firstCode)})`
        : base;

    return labels;
  }, {});
}

function formatTicketDiagnosticContext(metadata: Record<string, unknown>) {
  const parts = [
    readMetadataString(metadata, "activeView") ? `view ${readMetadataString(metadata, "activeView")}` : null,
    readMetadataString(metadata, "path") ? `path ${readMetadataString(metadata, "path")}` : null,
    readMetadataString(metadata, "requestId") ? `request ${readMetadataString(metadata, "requestId")}` : null,
    typeof metadata.creditBalance === "number" ? `${metadata.creditBalance} credits` : null,
    typeof metadata.applicationCount === "number" ? `${metadata.applicationCount} applications` : null,
    typeof metadata.jobCount === "number" ? `${metadata.jobCount} jobs` : null,
  ].filter(Boolean);

  const recentConversation = readRecentConversation(metadata);

  if (recentConversation.length > 0) {
    parts.push(`${recentConversation.length} recent chat messages`);
  }

  return parts.length > 0 ? parts.join(" · ") : "No diagnostic context captured yet.";
}

function renderSupportIncidentSnapshot(metadata: Record<string, unknown>) {
  const fields = [
    ["User asked", readMetadataString(metadata, "userMessage")],
    ["System response", readMetadataString(metadata, "systemResponse")],
    ["Error detail", readMetadataString(metadata, "errorMessage")],
    ["Failed action", formatRequestContext(metadata.requestContext)],
    ["Context", formatTicketDiagnosticContext(metadata)],
  ].filter((field): field is [string, string] => Boolean(field[1]));

  if (fields.length === 0) {
    return null;
  }

  return (
    <section className="support-incident-snapshot" aria-label="Incident snapshot">
      <span>Incident snapshot</span>
      <dl>
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function readRecentConversation(metadata: Record<string, unknown>) {
  const value = metadata.recentConversation;

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const text = typeof record.text === "string" ? record.text : "";

      if (!text.trim()) {
        return null;
      }

      return {
        at: typeof record.at === "string" ? record.at : "",
        speaker: typeof record.speaker === "string" ? record.speaker : "message",
        text,
      };
    })
    .filter((entry): entry is { at: string; speaker: string; text: string } => Boolean(entry))
    .slice(-8);
}

function readMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatRequestContext(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const context = value as Record<string, unknown>;
  const parts = ["title", "area", "source", "errorCode"]
    .map((key) => (typeof context[key] === "string" ? context[key] : null))
    .filter((part): part is string => Boolean(part?.trim()));

  return parts.length > 0 ? parts.join(" · ") : null;
}

function ticketMatchesSupportRiskFilter(
  ticket: OwnerMetrics["supportTickets"][number],
  filter: SupportRiskFilter,
) {
  if (filter === "all") {
    return true;
  }

  const haystack = [
    ticket.area,
    ticket.errorCode,
    ticket.rootCause,
    ticket.rootCauseCategory,
    ticket.subject,
    ticket.summary,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (filter === "billing_refund") {
    return /\b(billing|refund|receipt|payment|credit|purchase|charge)\b/.test(haystack);
  }

  if (filter === "privacy") {
    return /\b(privacy|deletion|delete|export|data rights|retention|minimi[sz]e)\b/.test(haystack);
  }

  if (filter === "account_access") {
    return /\b(account|access|login|sign in|password|mfa|email|locked)\b/.test(haystack);
  }

  return /\b(ai|inaccurate|fabricat|hallucinat|wrong|unsupported|claim|resume output)\b/.test(haystack);
}

function formatSupportRiskFilter(filter: SupportRiskFilter) {
  if (filter === "all") return "All";
  if (filter === "billing_refund") return "Billing/refund";
  if (filter === "privacy") return "Privacy";
  if (filter === "account_access") return "Account access";
  return "Inaccurate AI output";
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

function formatGrantTargetLabel(target: CreditGrantTarget) {
  return target.displayName || target.email || target.userId;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function formatOwnerPeriod(metricsDays: number, selectedDays: number) {
  if (selectedDays === 0) {
    return "all-time reporting";
  }

  return `${metricsDays} day period`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDuration(value: number) {
  if (value < 60) {
    return `${Math.round(value)}s`;
  }

  return `${Math.round(value / 60)}m`;
}

function formatRate(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
    style: "currency",
  }).format(value);
}

function formatRelativeTime(value: string) {
  const diffMs = Date.now() - new Date(value).getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60_000));

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 48) {
    return `${diffHours}h ago`;
  }

  return `${Math.round(diffHours / 24)}d ago`;
}
