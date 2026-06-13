import { createHash } from "node:crypto";

export type QuotaOperationKeyInput = {
  eventType: "application_logged" | "generation_created" | "manual_adjustment";
  resourceId?: string | null;
  resourceType: string;
};

export function buildQuotaOperationKey({
  eventType,
  resourceId,
  resourceType,
}: QuotaOperationKeyInput) {
  return `${eventType}:${resourceType}:${resourceId ?? crypto.randomUUID()}`.slice(0, 180);
}

export function buildStableOperationKey({
  namespace,
  parts,
}: {
  namespace: string;
  parts: Array<string | null | undefined>;
}) {
  const normalizedNamespace = normalizeNamespace(namespace).slice(0, 48) || "operation";
  const normalizedInput = parts.map((part) => normalizeKeyPart(part ?? "")).join(":");
  const digest = createHash("sha256").update(normalizedInput).digest("hex");

  return `${normalizedNamespace}:${digest}`.slice(0, 180);
}

export function buildJobIngestionOperationKey({
  jobText,
  jobUrl,
  sourceType,
}: {
  jobText?: string | null;
  jobUrl?: string | null;
  sourceType: string;
}) {
  const source = normalizeKeyPart(sourceType);
  const content =
    source === "url_fetch"
      ? normalizeUrlForOperationKey(jobUrl ?? "")
      : normalizeManualJobText(jobText ?? "");

  return buildStableOperationKey({
    namespace: "jobIngest",
    parts: [source, content],
  });
}

function normalizeManualJobText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeUrlForOperationKey(value: string) {
  try {
    const url = new URL(value.trim());
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();

    return url.toString();
  } catch {
    return normalizeKeyPart(value);
  }
}

function normalizeNamespace(value: string) {
  return value
    .trim()
    .replace(/\s+/g, "");
}

function normalizeKeyPart(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
