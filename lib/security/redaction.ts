const API_KEY_PATTERN = /\b(?:sk|rk|pk|whsec|supabase)_[A-Za-z0-9_-]{12,}\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)(?!\d)/g;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

export function redactOperationalText(value: string, maxLength = 2000) {
  const redacted = value
    .replace(API_KEY_PATTERN, "[redacted_key]")
    .replace(BEARER_PATTERN, "Bearer [redacted_token]")
    .replace(JWT_PATTERN, "[redacted_token]")
    .replace(EMAIL_PATTERN, "[redacted_email]")
    .replace(PHONE_PATTERN, "[redacted_phone]");

  return redacted.length > maxLength ? `${redacted.slice(0, maxLength - 1)}...` : redacted;
}

export function redactOperationalMetadata(value: Record<string, unknown>, maxDepth = 3) {
  return redactUnknown(value, maxDepth) as Record<string, unknown>;
}

function redactUnknown(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return redactOperationalText(value, 1000);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (depth <= 0) {
    return "[redacted_nested_metadata]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactUnknown(item, depth - 1));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      if (isSensitiveKey(key)) {
        return [key, "[redacted]"];
      }

      return [key, redactUnknown(entry, depth - 1)];
    }),
  );
}

function isSensitiveKey(key: string) {
  return /\b(token|secret|password|authorization|api[_-]?key|session|cookie)\b/i.test(key);
}
