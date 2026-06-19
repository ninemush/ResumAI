export function createIdempotencyHeaders(scope: string, operationId?: string): HeadersInit {
  return {
    "Idempotency-Key": createIdempotencyKey(scope, operationId),
  };
}

export type InFlightOperationStore = {
  current: Record<string, string | undefined>;
};

export function getInFlightOperationId(store: InFlightOperationStore, scope: string) {
  store.current[scope] ??=
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return store.current[scope] as string;
}

export function clearInFlightOperationId(store: InFlightOperationStore, scope: string) {
  delete store.current[scope];
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
