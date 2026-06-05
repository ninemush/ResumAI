import { NextResponse } from "next/server";
import { z } from "zod";

import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

const tierMutationSchema = z.object({
  applicationLimit: z.number().int().min(0).max(10000),
  description: z.string().trim().max(400).default(""),
  generationLimit: z.number().int().min(0).max(10000),
  id: z.string().uuid().optional(),
  isActive: z.boolean(),
  key: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/),
  name: z.string().trim().min(2).max(80),
  periodDays: z.number().int().min(1).max(366),
});

type TierRow = {
  application_limit: number;
  created_at: string;
  description: string;
  generation_limit: number;
  id: string;
  is_active: boolean;
  key: string;
  name: string;
  period_days: number;
  updated_at: string;
};

export async function GET() {
  const requestId = crypto.randomUUID();
  const supabase = await createClient();

  try {
    await requireAdmin(supabase);

    const { data, error } = await supabase
      .from("tiers")
      .select("id, key, name, description, application_limit, generation_limit, period_days, is_active, created_at, updated_at")
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: true });

    if (error) {
      throw error;
    }

    return NextResponse.json({
      ok: true,
      requestId,
      tiers: (data ?? []).map(normalizeTierRow),
    });
  } catch (error) {
    const apiError = toTierApiError(error, "admin.tiers_failed", "Unable to load tiers right now.");

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: apiError,
      },
      { status: apiError.status },
    );
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "admin_tier_upsert"),
    limit: 24,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Tier configuration is being updated too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "request.invalid_json",
          message: "Invalid JSON body.",
        },
      },
      { status: 400 },
    );
  }

  const parsed = tierMutationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "admin.tier_invalid",
          message: "Use a tier key, name, period, active state, and non-negative application/generation limits.",
        },
      },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  try {
    const adminUserId = await requireAdmin(supabase);
    const mutation = parsed.data;
    const patch = {
      application_limit: mutation.applicationLimit,
      description: mutation.description,
      generation_limit: mutation.generationLimit,
      is_active: mutation.isActive,
      key: mutation.key,
      name: mutation.name,
      period_days: mutation.periodDays,
      updated_at: new Date().toISOString(),
    };

    const query = mutation.id
      ? supabase.from("tiers").update(patch).eq("id", mutation.id)
      : supabase.from("tiers").insert(patch);

    const { data, error } = await query
      .select("id, key, name, description, application_limit, generation_limit, period_days, is_active, created_at, updated_at")
      .single();

    if (error || !data) {
      throw error ?? new Error("TIER_UPSERT_FAILED");
    }

    await supabase.from("audit_events").insert({
      actor_user_id: adminUserId,
      event_type: mutation.id ? "admin.tier.updated" : "admin.tier.created",
      metadata: {
        applicationLimit: mutation.applicationLimit,
        generationLimit: mutation.generationLimit,
        isActive: mutation.isActive,
        key: mutation.key,
        periodDays: mutation.periodDays,
      },
      request_id: requestId,
      resource_id: data.id,
      resource_type: "tier",
    });

    return NextResponse.json({
      ok: true,
      requestId,
      tier: normalizeTierRow(data),
    });
  } catch (error) {
    const apiError = toTierApiError(error, "admin.tier_upsert_failed", "Tier configuration could not be saved.");

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: apiError,
      },
      { status: apiError.status },
    );
  }
}

async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("ADMIN_REQUIRED");
  }

  const { data, error } = await supabase.rpc("is_admin");

  if (error || !data) {
    throw new Error("ADMIN_REQUIRED");
  }

  return user.id;
}

function normalizeTierRow(row: TierRow) {
  return {
    applicationLimit: row.application_limit,
    createdAt: row.created_at,
    description: row.description,
    generationLimit: row.generation_limit,
    id: row.id,
    isActive: row.is_active,
    key: row.key,
    name: row.name,
    periodDays: row.period_days,
    updatedAt: row.updated_at,
  };
}

function toTierApiError(error: unknown, code: string, message: string) {
  if (error instanceof Error && error.message === "ADMIN_REQUIRED") {
    return {
      category: "auth",
      code: "admin.required",
      message: "Owner or admin access is required.",
      status: 403,
    };
  }

  return {
    category: "server",
    code,
    message,
    status: 500,
  };
}
