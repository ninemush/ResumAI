import { NextResponse } from "next/server";

type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 5000;

export function checkRateLimit({ key, limit, windowMs }: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    pruneExpiredBuckets(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });

    return {
      allowed: true,
      remaining: Math.max(limit - 1, 0),
      resetAt: now + windowMs,
      retryAfterSeconds: 0,
    };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
      retryAfterSeconds: Math.max(Math.ceil((existing.resetAt - now) / 1000), 1),
    };
  }

  existing.count += 1;

  return {
    allowed: true,
    remaining: Math.max(limit - existing.count, 0),
    resetAt: existing.resetAt,
    retryAfterSeconds: 0,
  };
}

export function getClientRateLimitKey(request: Request, scope: string, subject?: string) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host") ?? "unknown-host";
  const ip = forwardedFor || request.headers.get("x-real-ip") || "unknown-ip";

  return `${scope}:${subject?.trim().toLowerCase() || ip}:${forwardedHost}`;
}

export function rateLimitResponse({
  message = "Too many requests. Please wait a moment and try again.",
  requestId,
  result,
}: {
  message?: string;
  requestId: string;
  result: RateLimitResult;
}) {
  return NextResponse.json(
    {
      ok: false,
      requestId,
      error: {
        category: "rate_limit",
        code: "rate_limit.exceeded",
        message,
        retryAfterSeconds: result.retryAfterSeconds,
      },
    },
    {
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
      },
      status: 429,
    },
  );
}

function pruneExpiredBuckets(now: number) {
  if (buckets.size < MAX_BUCKETS) {
    return;
  }

  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }

  if (buckets.size < MAX_BUCKETS) {
    return;
  }

  const overflow = buckets.size - MAX_BUCKETS + 1;
  let removed = 0;

  for (const key of buckets.keys()) {
    buckets.delete(key);
    removed += 1;

    if (removed >= overflow) {
      break;
    }
  }
}
