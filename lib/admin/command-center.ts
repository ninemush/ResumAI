import type { OwnerMetrics } from "@/lib/admin/owner-metrics";
import type { ComplianceDashboard } from "@/lib/privacy/compliance-dashboard";

export type PromoCodeState = "Active" | "Expired" | "Fully redeemed" | "Inactive" | "Scheduled";

export type AdminUserQuickFilter =
  | "all"
  | "needs_attention"
  | "open_support"
  | "no_credits"
  | "recent_failure"
  | "no_profile"
  | "active_week";

type PromoLike = {
  expiresAt: string | null;
  isActive: boolean;
  maxRedemptions: number;
  redeemedCount: number;
};

type AdminUserLike = OwnerMetrics["usersList"][number];

export function computePromoCodeState(promo: PromoLike, now = new Date()): PromoCodeState {
  if (!promo.isActive) {
    return "Inactive";
  }

  if (promo.expiresAt && new Date(promo.expiresAt).getTime() <= now.getTime()) {
    return "Expired";
  }

  if (promo.maxRedemptions > 0 && promo.redeemedCount >= promo.maxRedemptions) {
    return "Fully redeemed";
  }

  return "Active";
}

export function groupPrivacyRequestsById(
  requests: ComplianceDashboard["privacyRequests"]["recentOpen"],
) {
  const groups = new Map<string, ComplianceDashboard["privacyRequests"]["recentOpen"]>();

  for (const request of requests) {
    const groupingKey = [
      request.requestType,
      request.subject ?? "",
      request.userId,
    ].join("::");
    const existing = groups.get(groupingKey) ?? [];
    existing.push(request);
    groups.set(groupingKey, existing);
  }

  return [...groups.values()].map((items) => {
    const [first] = items;

    return {
      count: items.length,
      dueAt: first?.dueAt ?? null,
      id: first?.id ?? "unknown",
      requestType: first?.requestType ?? "unknown",
      status: first?.status ?? "unknown",
      subject: first?.subject ?? null,
      userId: first?.userId ?? "unknown",
    };
  });
}

export function userMatchesAdminQuickFilter(
  user: AdminUserLike,
  filter: AdminUserQuickFilter,
  metrics: OwnerMetrics,
  now = new Date(),
) {
  if (filter === "all") {
    return true;
  }

  const userSignals = getUserAttentionSignals(user, metrics, now);

  if (filter === "needs_attention") return userSignals.length > 0;
  if (filter === "open_support") return user.openTickets > 0;
  if (filter === "no_credits") return user.creditsAvailable === 0;
  if (filter === "recent_failure") return hasRecentUserFailure(user, metrics, now);
  if (filter === "no_profile") return isMissingProfile(user);
  if (filter === "active_week") return isActiveWithinDays(user, 7, now);

  return true;
}

export function getUserAttentionSignals(
  user: AdminUserLike,
  metrics: OwnerMetrics,
  now = new Date(),
) {
  const signals: string[] = [];

  if (user.openTickets > 0) {
    signals.push("Open support");
  }

  if (isMissingProfile(user)) {
    signals.push(user.sources > 0 ? "Profile stalled" : "No profile");
  }

  if (user.creditsAvailable === 0 && isActiveWithinDays(user, 14, now)) {
    signals.push("No credits");
  }

  if (hasRecentUserFailure(user, metrics, now)) {
    signals.push("Recent failure");
  }

  return signals;
}

export function getOutcomeSampleSize(values: Record<string, Record<string, number>>) {
  return Object.values(values).reduce((total, metrics) => total + readOutcomeVolume(metrics), 0);
}

export function summarizeOutcomePatternWithSample(
  values: Record<string, Record<string, number>>,
  segmentName = "segment",
) {
  const sampleSize = getOutcomeSampleSize(values);
  const sampleText = `Sample size: ${sampleSize.toLocaleString()} record${sampleSize === 1 ? "" : "s"}.`;

  if (sampleSize === 0) {
    return `${sampleText} No outcome pattern yet; wait for application status updates before drawing conclusions.`;
  }

  if (sampleSize < 20) {
    return `${sampleText} Treat this as directional only until more users log outcomes.`;
  }

  return `${sampleText} Compare ${segmentName} patterns, then review the underlying users before changing guidance.`;
}

function isMissingProfile(user: AdminUserLike) {
  const status = user.profileStatus?.toLowerCase() ?? "";

  return !status || status === "missing" || status === "draft" || status === "empty";
}

function hasRecentUserFailure(user: AdminUserLike, metrics: OwnerMetrics, now: Date) {
  const userEmail = user.email?.toLowerCase();

  if (!userEmail) {
    return false;
  }

  return metrics.errorDetails.some((error) => {
    if (error.userEmail?.toLowerCase() !== userEmail) {
      return false;
    }

    return error.fixRequired && now.getTime() - new Date(error.createdAt).getTime() <= 14 * 86_400_000;
  });
}

function isActiveWithinDays(user: AdminUserLike, days: number, now: Date) {
  const activityAt = user.lastActivityAt ?? user.lastSignInAt;

  if (!activityAt) {
    return false;
  }

  return now.getTime() - new Date(activityAt).getTime() <= days * 86_400_000;
}

function readOutcomeVolume(metrics: Record<string, number>) {
  return Math.round(
    metrics.total ??
      metrics.applications ??
      metrics.logged ??
      metrics.count ??
      Object.entries(metrics)
        .filter(([key]) => !key.toLowerCase().includes("rate"))
        .reduce((sum, [, value]) => sum + value, 0),
  );
}
