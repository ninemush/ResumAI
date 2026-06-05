export function createIdempotencyHeaders(scope: string): HeadersInit {
  const safeScope = scope.trim().replace(/[^A-Za-z0-9._:/=-]+/g, "-").slice(0, 80);
  const key =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return {
    "Idempotency-Key": `${safeScope}:${key}`,
  };
}
