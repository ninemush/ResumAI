export type RootCauseSource = "error" | "support";

export type RootCauseSignal = {
  area: string;
  code?: string | null;
  createdAt: string;
  fixRequired?: boolean;
  id: string;
  rootCause: string;
  rootCauseCategory?: string | null;
  source: RootCauseSource;
  status?: string | null;
  summary?: string | null;
  userEmail?: string | null;
};

export type RootCauseGroup = {
  activeErrors: number;
  activeTickets: number;
  category: string;
  displayName: string;
  firstSeenAt: string;
  impactedUsers: number;
  key: string;
  latestAt: string;
  resolvedSignals: number;
  sampleSummary: string;
  signals: RootCauseSignal[];
  totalSignals: number;
};

const activeTicketStatuses = new Set(["open", "waiting_on_user", "in_progress", "escalated"]);

export function buildRootCauseKey(input: {
  area?: string | null;
  code?: string | null;
  rootCause?: string | null;
  rootCauseCategory?: string | null;
  summary?: string | null;
}) {
  const category = normalizeKeyPart(input.rootCauseCategory ?? input.rootCause ?? "needs_triage");
  const code = normalizeKeyPart(input.code ?? "");
  const summary = normalizeOperationalSummary(input.summary ?? "");
  const shouldUseSummary =
    !code ||
    code === "user_reported_issue" ||
    category.includes("client_runtime") ||
    category.includes("needs_triage");

  return [category, code || "no_code", shouldUseSummary ? summary || "no_summary" : "any"].join(":");
}

export function buildRootCauseGroups(signals: RootCauseSignal[]) {
  const groups = new Map<string, RootCauseGroup>();

  for (const signal of signals) {
    const key = buildRootCauseKey({
      area: signal.area,
      code: signal.code,
      rootCause: signal.rootCause,
      rootCauseCategory: signal.rootCauseCategory,
      summary: signal.summary,
    });
    const existing = groups.get(key);
    const createdAt = signal.createdAt;
    const isActiveTicket = signal.source === "support" && activeTicketStatuses.has(signal.status ?? "open");
    const isActiveError = signal.source === "error" && signal.status !== "resolved";
    const resolvedSignals = isActiveTicket || isActiveError ? 0 : 1;

    if (!existing) {
      groups.set(key, {
        activeErrors: isActiveError ? 1 : 0,
        activeTickets: isActiveTicket ? 1 : 0,
        category: signal.rootCauseCategory ?? signal.rootCause,
        displayName: signal.rootCauseCategory ?? signal.rootCause,
        firstSeenAt: createdAt,
        impactedUsers: signal.userEmail ? 1 : 0,
        key,
        latestAt: createdAt,
        resolvedSignals,
        sampleSummary: signal.summary || signal.rootCause,
        signals: [signal],
        totalSignals: 1,
      });
      continue;
    }

    existing.activeErrors += isActiveError ? 1 : 0;
    existing.activeTickets += isActiveTicket ? 1 : 0;
    existing.firstSeenAt = compareIso(createdAt, existing.firstSeenAt) < 0 ? createdAt : existing.firstSeenAt;
    existing.latestAt = compareIso(createdAt, existing.latestAt) > 0 ? createdAt : existing.latestAt;
    existing.resolvedSignals += resolvedSignals;
    existing.signals.push(signal);
    existing.totalSignals += 1;
    existing.impactedUsers = new Set(existing.signals.map((item) => item.userEmail).filter(Boolean)).size;
  }

  return [...groups.values()].sort(
    (left, right) =>
      right.activeErrors +
        right.activeTickets -
        (left.activeErrors + left.activeTickets) ||
      right.totalSignals - left.totalSignals ||
      compareIso(right.latestAt, left.latestAt),
  );
}

export function readRootCauseQueueStatus(group: RootCauseGroup) {
  if (group.activeErrors + group.activeTickets > 0) {
    return "open";
  }

  if (group.resolvedSignals > 0) {
    return "history";
  }

  return "monitor";
}

export function classifyClientRuntimeError(input: { code?: string | null; message?: string | null }) {
  const code = input.code ?? "CLIENT_RUNTIME_ERROR";
  const message = input.message ?? "Client runtime error";

  if (/ReferenceError/i.test(code) || /is not defined/i.test(message)) {
    const symbol = message.match(/([\w$]+) is not defined/)?.[1];

    return {
      fingerprint: buildRootCauseKey({
        code,
        rootCauseCategory: "client_runtime_reference",
        summary: symbol ? `${symbol} is not defined` : message,
      }),
      rationale:
        "The browser tried to run a symbol that was not available in the loaded bundle. This is normally a deploy, stale asset, or product-code defect until a fresh build proves otherwise.",
      rootCauseCategory: "client_runtime_reference",
    };
  }

  if (/ChunkLoadError|Loading chunk|dynamically imported module/i.test(`${code} ${message}`)) {
    return {
      fingerprint: buildRootCauseKey({
        code,
        rootCauseCategory: "client_asset_loading",
        summary: message,
      }),
      rationale:
        "The browser could not load a current application asset. Usually this needs cache/deploy verification and a retry-safe user recovery path.",
      rootCauseCategory: "client_asset_loading",
    };
  }

  return {
    fingerprint: buildRootCauseKey({
      code,
      rootCauseCategory: "client_runtime",
      summary: message,
    }),
    rationale:
      "Captured from the browser runtime. Owner review is required if this repeats or affects a core workflow.",
    rootCauseCategory: "client_runtime",
  };
}

function normalizeOperationalSummary(value: string) {
  return normalizeKeyPart(
    value
      .replace(/\b[0-9a-f]{8,}\b/gi, "id")
      .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, "time")
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "date")
      .slice(0, 160),
  );
}

function normalizeKeyPart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
}

function compareIso(left: string, right: string) {
  return new Date(left).getTime() - new Date(right).getTime();
}
