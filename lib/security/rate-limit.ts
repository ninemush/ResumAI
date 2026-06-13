import { createHash } from "node:crypto";
import { isIP } from "node:net";

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

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
const DURABLE_RATE_LIMIT_FAILURE_RETRY_SECONDS = 60;

export async function checkRateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  if (process.env.NODE_ENV === "production" && !shouldUseDurableRateLimit()) {
    console.warn(
      JSON.stringify({
        event: "security.rate_limit.backend_missing",
        scope: options.key.split(":")[0] ?? "unknown",
      }),
    );

    return {
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + DURABLE_RATE_LIMIT_FAILURE_RETRY_SECONDS * 1000,
      retryAfterSeconds: DURABLE_RATE_LIMIT_FAILURE_RETRY_SECONDS,
    };
  }

  if (shouldUseDurableRateLimit()) {
    try {
      return await checkDurableRateLimit(options);
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: "security.rate_limit.durable_failed",
          scope: options.key.split(":")[0] ?? "unknown",
          error: error instanceof Error ? error.message : "Unknown durable rate-limit failure.",
        }),
      );

      if (process.env.NODE_ENV === "production") {
        return {
          allowed: false,
          remaining: 0,
          resetAt: Date.now() + DURABLE_RATE_LIMIT_FAILURE_RETRY_SECONDS * 1000,
          retryAfterSeconds: DURABLE_RATE_LIMIT_FAILURE_RETRY_SECONDS,
        };
      }
    }
  }

  return checkInMemoryRateLimit(options);
}

function checkInMemoryRateLimit({ key, limit, windowMs }: RateLimitOptions): RateLimitResult {
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

async function checkDurableRateLimit({
  key,
  limit,
  windowMs,
}: RateLimitOptions): Promise<RateLimitResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_bucket_key: key,
    p_limit: limit,
    p_window_ms: windowMs,
  });

  if (error) {
    throw new Error(error.message);
  }

  const result = Array.isArray(data) ? data[0] : data;

  if (!isDurableRateLimitResult(result)) {
    throw new Error("Rate-limit RPC returned an invalid response.");
  }

  return {
    allowed: result.allowed,
    remaining: result.remaining,
    resetAt: new Date(result.reset_at).getTime(),
    retryAfterSeconds: result.retry_after_seconds,
  };
}

function isDurableRateLimitResult(value: unknown): value is {
  allowed: boolean;
  remaining: number;
  reset_at: string;
  retry_after_seconds: number;
} {
  if (!value || typeof value !== "object") {
    return false;
  }

  const result = value as Record<string, unknown>;

  return (
    typeof result.allowed === "boolean" &&
    typeof result.remaining === "number" &&
    typeof result.reset_at === "string" &&
    typeof result.retry_after_seconds === "number"
  );
}

function shouldUseDurableRateLimit() {
  return process.env.RATE_LIMIT_BACKEND === "supabase";
}

export function getClientRateLimitKey(request: Request, scope: string, subject?: string) {
  const ip = getClientIp(request);
  const normalizedScope = normalizeRateLimitKeyPart(scope, "unknown_scope");
  const normalizedSubject = subject?.trim().toLowerCase();

  if (normalizedSubject) {
    return `${normalizedScope}:subject:${hashRateLimitPart(normalizedSubject)}`;
  }

  return `${normalizedScope}:ip:${hashRateLimitPart(ip)}`;
}

function getClientIp(request: Request) {
  const forwardedFor = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((value) => normalizeIpHeaderValue(value))
    .find(Boolean);
  const realIp = normalizeIpHeaderValue(request.headers.get("x-real-ip"));

  return forwardedFor || realIp || "unknown-ip";
}

function normalizeIpHeaderValue(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^\[/, "").replace(/\]$/, "") ?? "";

  return isIP(normalized) ? normalized : "";
}

function normalizeRateLimitKeyPart(value: string, fallback: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

  return normalized || fallback;
}

function hashRateLimitPart(value: string) {
  return createHash("sha256").update(value).digest("hex");
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
