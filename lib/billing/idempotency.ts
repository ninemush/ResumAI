export function createIdempotencyHeaders(scope: string, operationId?: string): HeadersInit {
  return {
    "Idempotency-Key": createIdempotencyKey(scope, operationId),
  };
}

export function createIdempotencyKey(scope: string, operationId?: string) {
  const safeScope = scope.trim().replace(/[^A-Za-z0-9._:/=-]+/g, "-").slice(0, 80);
  const rawOperationId =
    operationId && operationId.trim().length > 0
      ? operationId
      : typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const safeOperationId = rawOperationId.trim().replace(/[^A-Za-z0-9._:/=-]+/g, "-").slice(0, 96);

  return `${safeScope}:${safeOperationId}`;
}
