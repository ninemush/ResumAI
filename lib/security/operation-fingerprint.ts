import { createHash } from "node:crypto";

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

export function buildOperationFingerprint(input: {
  amount?: number | null;
  basis?: Record<string, unknown> | null;
  feature: string;
  mode?: string | null;
  operationKey?: string | null;
  resourceId?: string | null;
  resourceType: string;
  userId: string;
}) {
  return hashCanonicalValue({
    amount: input.amount ?? null,
    basis: normalizeUnknown(input.basis ?? {}),
    feature: input.feature,
    mode: input.mode ?? null,
    operationKey: input.operationKey ?? null,
    resourceId: input.resourceId ?? null,
    resourceType: input.resourceType,
    userId: input.userId,
  });
}

export function hashCanonicalValue(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(normalizeUnknown(value)))
    .digest("hex");
}

function normalizeUnknown(value: unknown): CanonicalValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value.trim().replace(/\s+/g, " ");
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeUnknown(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeUnknown(item)]),
    );
  }

  return String(value);
}
