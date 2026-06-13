import "server-only";

import { z } from "zod";

import {
  CREDIT_COSTS,
  CREDIT_EXAMPLE_JOURNEYS,
  CREDIT_FREE_ACTIONS,
  CREDIT_PURCHASE_OPTIONS,
  CREDIT_USAGE_GUIDE,
  formatCreditCost,
  getCreditUsageItem,
  getCreditUsageSummary,
  type CreditFeature,
} from "@/lib/billing/credit-catalog";
import { logAdminUserAccess } from "@/lib/admin/access-audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export {
  CREDIT_COSTS,
  CREDIT_EXAMPLE_JOURNEYS,
  CREDIT_FREE_ACTIONS,
  CREDIT_PURCHASE_OPTIONS,
  CREDIT_USAGE_GUIDE,
  formatCreditCost,
  getCreditUsageItem,
  getCreditUsageSummary,
};
export type { CreditFeature };

const creditSummarySchema = z.object({
  balance: z.number().int(),
  isExhausted: z.boolean(),
  promoCredits: z.number().int(),
  purchasedCredits: z.number().int(),
  signupCredits: z.number().int(),
  totalCredits: z.number().int(),
  usagePercent: z.number(),
  usedCredits: z.number().int(),
  warningThreshold: z.number().int().nullable(),
});

export type CreditSummary = z.infer<typeof creditSummarySchema> & {
  purchaseOptions: CreditPurchaseOption[];
};

export type CreditPurchaseOption = {
  credits: number;
  description: string;
  label: string;
  priceUsd: number;
  productId: string;
  recommended: boolean;
  url: string | null;
};

export type CreditLedgerEvent = {
  amount: number;
  createdAt: string;
  description: string;
  eventType: string;
  id: string;
  invoiceStatus: "not_applicable" | "receipt_emailed";
  kind: "grant" | "purchase" | "usage";
  resourceLabel: string;
};

export type CreditHistory = {
  invoices: CreditLedgerEvent[];
  purchases: CreditLedgerEvent[];
  usage: CreditLedgerEvent[];
};

export class CreditsExhaustedError extends Error {
  readonly summary: CreditSummary | null;

  constructor(summary: CreditSummary | null = null) {
    super("CREDITS_EXHAUSTED");
    this.summary = summary;
  }
}

const creditReservationStatusSchema = z.enum([
  "reserved",
  "finalized",
  "released",
  "expired",
]);

const creditReservationResultSchema = z.object({
  ledgerEventId: z.string().uuid().nullable(),
  reservationId: z.string().uuid(),
  status: creditReservationStatusSchema,
  summary: creditSummarySchema,
});

export type CreditReservationResult = z.infer<typeof creditReservationResultSchema> & {
  summary: CreditSummary;
};

const staleCreditReservationCleanupSchema = z.object({
  affectedFeatureTotals: z.record(z.string(), z.number().int().nonnegative()).default({}),
  expiredCount: z.number().int().nonnegative(),
  releasedCount: z.number().int().nonnegative(),
});

export type StaleCreditReservationCleanup = z.infer<
  typeof staleCreditReservationCleanupSchema
>;

const creditOperationOutputSchema = z.object({
  feature: z.string(),
  ledger_event_id: z.string().uuid().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  operation_key: z.string(),
  output_ids: z.record(z.string(), z.unknown()),
  reservation_id: z.string().uuid().nullable(),
  resource_id: z.string().uuid().nullable(),
  resource_type: z.string(),
  status: z.string(),
});

export type CreditOperationOutput = z.infer<typeof creditOperationOutputSchema>;

export async function getCreditSummary(): Promise<CreditSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_credit_summary");

  if (error || !data) {
    throw mapCreditError(error?.message);
  }

  return withPurchaseOptions(creditSummarySchema.parse(data));
}

export async function requireCredits(feature: CreditFeature) {
  const summary = await getCreditSummary();
  const required = CREDIT_COSTS[feature];

  if (summary.balance < required) {
    throw new CreditsExhaustedError(summary);
  }

  return summary;
}

export async function consumeCredits({
  feature,
  metadata = {},
  operationKey,
  resourceId,
  resourceType,
}: {
  feature: CreditFeature;
  metadata?: Record<string, unknown>;
  operationKey?: string | null;
  resourceId?: string;
  resourceType: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("consume_credits", {
    p_amount: CREDIT_COSTS[feature],
    p_event_type: `feature_${feature}`,
    p_metadata: metadata,
    p_operation_key: operationKey ?? null,
    p_resource_id: resourceId ?? null,
    p_resource_type: resourceType,
  });

  if (error || !data) {
    throw mapCreditError(error?.message);
  }

  return withPurchaseOptions(creditSummarySchema.parse(data));
}

export async function reserveCredits({
  feature,
  metadata = {},
  operationKey,
  resourceId,
  resourceType,
}: {
  feature: CreditFeature;
  metadata?: Record<string, unknown>;
  operationKey: string;
  resourceId?: string | null;
  resourceType: string;
}): Promise<CreditReservationResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reserve_credits", {
    p_amount: CREDIT_COSTS[feature],
    p_feature: feature,
    p_idempotency_key: operationKey,
    p_metadata: metadata,
    p_resource_id: resourceId ?? null,
    p_resource_type: resourceType,
  });

  if (error || !data) {
    throw mapCreditError(error?.message);
  }

  return normalizeReservationResult(data);
}

export async function finalizeCreditReservation({
  metadata = {},
  reservationId,
  resourceId,
}: {
  metadata?: Record<string, unknown>;
  reservationId: string;
  resourceId?: string | null;
}): Promise<CreditReservationResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finalize_credit_reservation", {
    p_metadata: metadata,
    p_reservation_id: reservationId,
    p_resource_id: resourceId ?? null,
  });

  if (error || !data) {
    throw mapCreditError(error?.message);
  }

  return normalizeReservationResult(data);
}

export async function releaseCreditReservation({
  metadata = {},
  reason,
  reservationId,
}: {
  metadata?: Record<string, unknown>;
  reason?: string;
  reservationId: string;
}): Promise<CreditReservationResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("release_credit_reservation", {
    p_metadata: metadata,
    p_reason: reason ?? null,
    p_reservation_id: reservationId,
  });

  if (error || !data) {
    throw mapCreditError(error?.message);
  }

  return normalizeReservationResult(data);
}

export async function cleanupStaleCreditReservations(): Promise<StaleCreditReservationCleanup> {
  const supabase = await createClient();
  await requireAdminUser(supabase);
  const { data, error } = await supabase.rpc("cleanup_stale_credit_reservations");

  if (error || !data) {
    throw new Error(
      error?.message?.includes("ADMIN_REQUIRED")
        ? "ADMIN_REQUIRED"
        : "CREDIT_RESERVATION_CLEANUP_FAILED",
    );
  }

  return staleCreditReservationCleanupSchema.parse(data);
}

export function getCreditOperationKey(request: Request, fallback: string) {
  const headerValue = request.headers.get("Idempotency-Key");
  const rawKey = headerValue && headerValue.trim().length > 0 ? headerValue : fallback;
  const normalized = rawKey.trim().replace(/\s+/g, "-").slice(0, 180);

  if (!/^[A-Za-z0-9._:/=-]{8,180}$/.test(normalized)) {
    return fallback.slice(0, 180);
  }

  return normalized;
}

export async function getFinalizedCreditOperationOutput({
  feature,
  operationKey,
}: {
  feature: CreditFeature;
  operationKey: string;
}): Promise<CreditOperationOutput | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("credit_operation_outputs")
    .select(
      "feature, operation_key, reservation_id, ledger_event_id, resource_type, resource_id, output_ids, status, metadata",
    )
    .eq("feature", feature)
    .eq("operation_key", operationKey)
    .eq("status", "succeeded")
    .maybeSingle();

  if (error) {
    return null;
  }

  return data ? creditOperationOutputSchema.parse(data) : null;
}

export async function recordCreditOperationOutput({
  feature,
  ledgerEventId,
  metadata = {},
  operationKey,
  outputIds,
  reservationId,
  resourceId,
  resourceType,
  status = "succeeded",
}: {
  feature: CreditFeature;
  ledgerEventId?: string | null;
  metadata?: Record<string, unknown>;
  operationKey: string;
  outputIds: Record<string, unknown>;
  reservationId?: string | null;
  resourceId?: string | null;
  resourceType: string;
  status?: "succeeded" | "failed" | "ignored" | "reversed";
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { error } = await supabase.from("credit_operation_outputs").upsert(
    {
      feature,
      ledger_event_id: ledgerEventId ?? null,
      metadata,
      operation_key: operationKey,
      output_ids: outputIds,
      reservation_id: reservationId ?? null,
      resource_id: resourceId ?? null,
      resource_type: resourceType,
      status,
      user_id: user.id,
    },
    {
      onConflict: "user_id,feature,operation_key",
    },
  );

  if (error) {
    throw new Error("CREDIT_OPERATION_OUTPUT_RECORD_FAILED");
  }
}

export async function redeemPromoCode(code: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("redeem_promo_code", {
    p_code: code,
  });

  if (error || !data) {
    throw mapCreditError(error?.message);
  }

  return withPurchaseOptions(creditSummarySchema.parse(data));
}

const creditLedgerRowSchema = z.object({
  created_at: z.string(),
  credit_delta: z.number().int(),
  event_type: z.string(),
  id: z.string().uuid(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  resource_type: z.string().nullable(),
});

export async function getCreditHistory(): Promise<CreditHistory> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("credit_ledger")
    .select("id, event_type, credit_delta, resource_type, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) {
    throw mapCreditError(error.message);
  }

  const rows = z
    .array(creditLedgerRowSchema)
    .parse(data ?? [])
    .map(mapCreditLedgerRow);

  return {
    invoices: rows.filter((row) => row.kind === "purchase"),
    purchases: rows.filter((row) => row.kind === "purchase"),
    usage: rows,
  };
}

export const createPromoCodeSchema = z.object({
  assignedUserEmail: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase())
    .optional()
    .or(z.literal("").transform(() => undefined)),
  code: z
    .string()
    .trim()
    .min(4)
    .max(40)
    .transform((value) => value.toUpperCase().replace(/\s+/g, "-"))
    .refine((value) => /^[A-Z0-9][A-Z0-9_-]{3,39}$/.test(value), {
      message:
        "Promo codes can use uppercase letters, numbers, dashes, and underscores.",
    }),
  creditAmount: z.number().int().min(1).max(500),
  description: z.string().trim().max(240).default(""),
  expiresAt: z
    .string()
    .datetime()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  maxRedemptions: z.number().int().min(1).max(5000).default(1),
});

export const grantCreditsSchema = z
  .object({
    creditAmount: z.number().int().min(1).max(500),
    description: z.string().trim().max(240).default(""),
    userEmail: z
      .string()
      .trim()
      .email()
      .transform((value) => value.toLowerCase())
      .optional()
      .or(z.literal("").transform(() => undefined)),
    userId: z
      .string()
      .trim()
      .uuid()
      .optional()
      .or(z.literal("").transform(() => undefined)),
  })
  .superRefine((value, context) => {
    if (!value.userEmail && !value.userId) {
      context.addIssue({
        code: "custom",
        message: "Provide a user email or user id.",
        path: ["userEmail"],
      });
    }
  });

export async function createPromoCode(
  input: z.input<typeof createPromoCodeSchema>,
) {
  const parsed = createPromoCodeSchema.parse(input);
  const supabase = await createClient();
  const user = await requireAdminUser(supabase);

  const { data, error } = await supabase
    .from("promo_codes")
    .insert({
      assigned_user_email: parsed.assignedUserEmail ?? null,
      code: parsed.code,
      created_by: user.id,
      credit_amount: parsed.creditAmount,
      description: parsed.description,
      expires_at: parsed.expiresAt ?? null,
      max_redemptions: parsed.maxRedemptions,
    })
    .select(
      "id, code, description, credit_amount, max_redemptions, assigned_user_email, expires_at, is_active, created_at",
    )
    .single();

  if (error || !data) {
    throw new Error(
      error?.code === "42501" ? "ADMIN_REQUIRED" : "PROMO_CREATE_FAILED",
    );
  }

  return {
    assignedUserEmail: data.assigned_user_email,
    code: data.code,
    createdAt: data.created_at,
    creditAmount: data.credit_amount,
    description: data.description,
    expiresAt: data.expires_at,
    id: data.id,
    isActive: data.is_active,
    maxRedemptions: data.max_redemptions,
    redeemedCount: 0,
  };
}

export async function grantCreditsToUser(
  input: z.input<typeof grantCreditsSchema>,
) {
  const parsed = grantCreditsSchema.parse(input);
  const supabase = await createClient();
  const adminUser = await requireAdminUser(supabase);
  const adminClient = createAdminClient();
  const targetUser = await resolveCreditGrantTarget(adminClient, {
    userEmail: parsed.userEmail,
    userId: parsed.userId,
  });

  if (!targetUser?.id) {
    throw new Error("CREDIT_TARGET_USER_NOT_FOUND");
  }

  const { data, error } = await adminClient
    .from("credit_ledger")
    .insert({
      credit_delta: parsed.creditAmount,
      event_type: "owner_credit_grant",
      metadata: {
        description: parsed.description,
        granted_by: adminUser.id,
        target_email: targetUser.email ?? parsed.userEmail ?? null,
      },
      resource_id: targetUser.id,
      resource_type: "owner_credit_grant",
      user_id: targetUser.id,
    })
    .select("id, credit_delta, created_at")
    .single();

  if (error || !data) {
    throw new Error("OWNER_CREDIT_GRANT_FAILED");
  }

  await logAdminUserAccess({
    accessReason: "owner_credit_grant",
    actorUserId: adminUser.id,
    metadata: {
      creditAmount: parsed.creditAmount,
      description: parsed.description,
      targetEmail: targetUser.email ?? parsed.userEmail ?? null,
    },
    resourceId: data.id,
    resourceType: "credit_ledger",
    supabase: adminClient,
    targetUserId: targetUser.id,
    visibilityLevel: "owner_override",
  });

  return {
    createdAt: data.created_at,
    creditAmount: data.credit_delta,
    description: parsed.description,
    id: data.id,
    userEmail: targetUser.email ?? parsed.userEmail ?? null,
    userId: targetUser.id,
  };
}

async function resolveCreditGrantTarget(
  adminClient: ReturnType<typeof createAdminClient>,
  {
    userEmail,
    userId,
  }: {
    userEmail?: string;
    userId?: string;
  },
) {
  if (userId) {
    const { data, error } = await adminClient.auth.admin.getUserById(userId);

    if (error) {
      return null;
    }

    return data.user
      ? { email: data.user.email ?? null, id: data.user.id }
      : null;
  }

  if (!userEmail) {
    throw new Error("CREDIT_TARGET_REQUIRED");
  }

  let page = 1;
  const perPage = 1000;

  while (page <= 20) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw new Error("CREDIT_TARGET_LOOKUP_FAILED");
    }

    const user = data.users.find(
      (candidate) => candidate.email?.toLowerCase() === userEmail,
    );

    if (user) {
      return { email: user.email ?? null, id: user.id };
    }

    if (data.users.length < perPage) {
      break;
    }

    page += 1;
  }

  return null;
}

const promoCodeRowSchema = z.object({
  assigned_user_email: z.string().nullable(),
  code: z.string(),
  created_at: z.string(),
  credit_amount: z.number().int(),
  description: z.string(),
  expires_at: z.string().nullable(),
  id: z.string().uuid(),
  is_active: z.boolean(),
  max_redemptions: z.number().int(),
  promo_code_redemptions: z
    .array(z.object({ id: z.string().uuid() }))
    .optional(),
});

export async function listPromoCodes() {
  const supabase = await createClient();
  await requireAdminUser(supabase);
  const { data, error } = await supabase
    .from("promo_codes")
    .select(
      "id, code, description, credit_amount, max_redemptions, assigned_user_email, expires_at, is_active, created_at, promo_code_redemptions(id)",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(
      error.code === "42501" ? "ADMIN_REQUIRED" : "PROMO_LIST_FAILED",
    );
  }

  return z
    .array(promoCodeRowSchema)
    .parse(data ?? [])
    .map((row) => ({
      assignedUserEmail: row.assigned_user_email,
      code: row.code,
      createdAt: row.created_at,
      creditAmount: row.credit_amount,
      description: row.description,
      expiresAt: row.expires_at,
      id: row.id,
      isActive: row.is_active,
      maxRedemptions: row.max_redemptions,
      redeemedCount: row.promo_code_redemptions?.length ?? 0,
    }));
}

async function requireAdminUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { data: isAdmin, error } = await supabase.rpc("is_admin");

  if (error || !isAdmin) {
    throw new Error("ADMIN_REQUIRED");
  }

  return user;
}

export function buildCreditsApiError(error: unknown) {
  if (error instanceof CreditsExhaustedError) {
    return {
      category: "billing",
      code: "billing.credits_exhausted",
      message:
        "You're out of credits, so I paused this action before it ran. Add credits to keep reading sources, creating packets, and downloading files.",
      purchaseOptions: error.summary?.purchaseOptions ?? getPurchaseOptions(),
      resolution: {
        label: "Add credits",
        view: "settings",
      },
      status: 402,
      summary: error.summary,
    };
  }

  if (error instanceof Error) {
    if (error.message === "AUTH_REQUIRED") {
      return {
        category: "auth",
        code: "auth.required",
        message: "Please sign in before using credits.",
        status: 401,
      };
    }

    if (error.message === "TERMS_REQUIRED") {
      return {
        category: "auth",
        code: "terms.required",
        message: "Accept the current Terms and Privacy Policy before using credits.",
        status: 403,
      };
    }

    if (error.message === "EMAIL_MFA_REQUIRED") {
      return {
        category: "auth",
        code: "auth.email_code_required",
        message: "Verify your email code before using credits.",
        status: 403,
      };
    }

    if (error.message === "ADMIN_REQUIRED") {
      return {
        category: "auth",
        code: "auth.owner_required",
        message: "Owner/admin access is required.",
        status: 403,
      };
    }

    if (error.message === "IDEMPOTENCY_KEY_REQUIRED") {
      return {
        category: "validation",
        code: "billing.idempotency_key_required",
        message: "This action needs a retry-safe request key before it can use credits.",
        status: 400,
      };
    }

    if (
      error.message === "CREDIT_RESERVATION_NOT_FOUND" ||
      error.message === "CREDIT_RESERVATION_NOT_FINALIZABLE"
    ) {
      return {
        category: "billing",
        code: "billing.reservation_failed",
        message: "Credit reservation could not be finalized. Please retry the action once.",
        status: 409,
      };
    }

    if (error.message === "PROMO_CODE_INVALID") {
      return {
        category: "validation",
        code: "billing.promo_invalid",
        message: "That promo code is not active or has expired.",
        status: 400,
      };
    }

    if (error.message === "PROMO_CODE_EXHAUSTED") {
      return {
        category: "validation",
        code: "billing.promo_exhausted",
        message: "That promo code has already reached its redemption limit.",
        status: 400,
      };
    }

    if (error.message === "PROMO_CODE_ALREADY_REDEEMED") {
      return {
        category: "validation",
        code: "billing.promo_already_redeemed",
        message: "You have already used that promo code.",
        status: 400,
      };
    }

    if (error.message === "PROMO_CODE_NOT_ASSIGNED") {
      return {
        category: "validation",
        code: "billing.promo_not_assigned",
        message: "That promo code is assigned to a different account.",
        status: 400,
      };
    }

    if (error.message === "CREDIT_TARGET_REQUIRED") {
      return {
        category: "validation",
        code: "billing.credit_target_required",
        message: "Choose a user before adding credits.",
        status: 400,
      };
    }

    if (error.message === "CREDIT_TARGET_USER_NOT_FOUND") {
      return {
        category: "validation",
        code: "billing.credit_target_not_found",
        message: "No user was found with that email or user id.",
        status: 404,
      };
    }

    if (error.message === "CREDIT_TARGET_LOOKUP_FAILED") {
      return {
        category: "server",
        code: "billing.credit_target_lookup_failed",
        message: "Unable to look up that user right now.",
        status: 500,
      };
    }

    if (error.message === "OWNER_CREDIT_GRANT_FAILED") {
      return {
        category: "server",
        code: "billing.owner_credit_grant_failed",
        message: "Unable to add credits to that user right now.",
        status: 500,
      };
    }
  }

  return {
    category: "server",
    code: "billing.operation_failed",
    message: "Unable to update credits right now.",
    status: 500,
  };
}

function mapCreditError(message: string | undefined) {
  const normalizedMessage = message?.toUpperCase() ?? "";

  if (
    normalizedMessage.includes("CREDITS_EXHAUSTED") ||
    normalizedMessage.includes("INSUFFICIENT_CREDIT_BALANCE")
  ) {
    return new CreditsExhaustedError();
  }

  if (normalizedMessage.includes("AUTH_REQUIRED")) {
    return new Error("AUTH_REQUIRED");
  }

  if (normalizedMessage.includes("IDEMPOTENCY_KEY_REQUIRED")) {
    return new Error("IDEMPOTENCY_KEY_REQUIRED");
  }

  if (normalizedMessage.includes("CREDIT_RESERVATION_NOT_FOUND")) {
    return new Error("CREDIT_RESERVATION_NOT_FOUND");
  }

  if (normalizedMessage.includes("CREDIT_RESERVATION_NOT_FINALIZABLE")) {
    return new Error("CREDIT_RESERVATION_NOT_FINALIZABLE");
  }

  if (normalizedMessage.includes("ADMIN_REQUIRED")) {
    return new Error("ADMIN_REQUIRED");
  }

  if (normalizedMessage.includes("PROMO_CODE_INVALID")) {
    return new Error("PROMO_CODE_INVALID");
  }

  if (normalizedMessage.includes("PROMO_CODE_EXHAUSTED")) {
    return new Error("PROMO_CODE_EXHAUSTED");
  }

  if (normalizedMessage.includes("PROMO_CODE_ALREADY_REDEEMED")) {
    return new Error("PROMO_CODE_ALREADY_REDEEMED");
  }

  if (normalizedMessage.includes("PROMO_CODE_NOT_ASSIGNED")) {
    return new Error("PROMO_CODE_NOT_ASSIGNED");
  }

  return new Error("CREDIT_OPERATION_FAILED");
}

function normalizeReservationResult(data: unknown): CreditReservationResult {
  const parsed = creditReservationResultSchema.parse(data);

  return {
    ...parsed,
    summary: withPurchaseOptions(parsed.summary),
  };
}

function normalizeCreditSummary(
  summary: z.infer<typeof creditSummarySchema>,
): z.infer<typeof creditSummarySchema> {
  const signupCredits = Math.max(0, summary.signupCredits);
  const promoCredits = Math.max(0, summary.promoCredits);
  const purchasedCredits = Math.max(0, summary.purchasedCredits);
  const totalCredits = Math.max(
    0,
    summary.totalCredits,
    signupCredits + promoCredits + purchasedCredits,
  );
  const usedCredits = Math.max(0, summary.usedCredits);
  const balance = Math.max(0, summary.balance);
  const usagePercent =
    totalCredits > 0
      ? Math.min(
          100,
          Math.max(0, Number(((usedCredits / totalCredits) * 100).toFixed(2))),
        )
      : 0;
  const warningThreshold =
    usagePercent >= 90
      ? 90
      : usagePercent >= 75
        ? 75
        : usagePercent >= 50
          ? 50
          : null;

  return {
    ...summary,
    balance,
    isExhausted: balance <= 0,
    promoCredits,
    purchasedCredits,
    signupCredits,
    totalCredits,
    usagePercent,
    usedCredits,
    warningThreshold,
  };
}

function withPurchaseOptions(
  summary: z.infer<typeof creditSummarySchema>,
): CreditSummary {
  const normalizedSummary = normalizeCreditSummary(summary);

  return {
    ...normalizedSummary,
    purchaseOptions: getPurchaseOptions(),
  };
}

export function getPurchaseOptions(): CreditPurchaseOption[] {
  return CREDIT_PURCHASE_OPTIONS.map((option) => ({
    credits: option.credits,
    description: option.description,
    label: option.label,
    priceUsd: option.priceUsd,
    productId: option.productId,
    recommended: option.recommended,
    url: process.env[option.envKey] ?? null,
  }));
}

function mapCreditLedgerRow(
  row: z.infer<typeof creditLedgerRowSchema>,
): CreditLedgerEvent {
  const amount = row.credit_delta;
  const metadata = row.metadata ?? {};
  const productId =
    typeof metadata.product_id === "string" ? metadata.product_id : null;
  const purchaseOption = productId
    ? CREDIT_PURCHASE_OPTIONS.find((option) => option.productId === productId)
    : null;
  const kind: CreditLedgerEvent["kind"] =
    row.event_type === "revenuecat_purchase"
      ? "purchase"
      : amount > 0
        ? "grant"
        : "usage";

  return {
    amount,
    createdAt: row.created_at,
    description: describeCreditEvent(
      row.event_type,
      row.resource_type,
      purchaseOption?.label,
    ),
    eventType: row.event_type,
    id: row.id,
    invoiceStatus: kind === "purchase" ? "receipt_emailed" : "not_applicable",
    kind,
    resourceLabel: describeResource(row.resource_type),
  };
}

function describeCreditEvent(
  eventType: string,
  resourceType: string | null,
  purchaseLabel?: string,
) {
  if (eventType === "signup_bonus") return "Starter credits";
  if (eventType === "owner_credit_grant") return "Owner credit grant";
  if (eventType === "promo_code_redeemed") return "Promo code credit grant";
  if (eventType === "revenuecat_purchase")
    return `${purchaseLabel ?? "Credit pack"} purchase`;

  const isHistoricalEstimate = eventType.startsWith("historical_feature_");
  const feature = eventType
    .replace(/^historical_/, "")
    .replace(/^feature_/, "");

  let description: string;
  switch (feature) {
    case "applicationMaterialsExport":
      description = "Downloaded application files";
      break;
    case "applicationMaterialsGenerate":
      description = "Drafted job-specific materials";
      break;
    case "jobIngest":
      description = "Read and analyzed a job link";
      break;
    case "masterResumeExport":
      description = "Downloaded master resume files";
      break;
    case "masterResumeGenerate":
      description = "Created master resume draft";
      break;
    case "profileSourceExtract":
      description = "Read a resume, profile, link, or file";
      break;
    default:
      description = resourceType
        ? `Credit activity for ${describeResource(resourceType)}`
        : "Credit activity";
  }

  return isHistoricalEstimate
    ? `Historical estimate: ${description}`
    : description;
}

function describeResource(resourceType: string | null) {
  switch (resourceType) {
    case "application":
      return "Application";
    case "application_materials":
      return "Application materials";
    case "application_materials_export":
      return "Application export";
    case "job_ingestion":
      return "Job post";
    case "job_post":
      return "Job post";
    case "master_resume":
      return "Master resume";
    case "master_resume_export":
      return "Master resume export";
    case "profile_source":
      return "Profile source";
    case "promo_code":
      return "Promo code";
    case "owner_credit_grant":
      return "Owner credit grant";
    case "revenuecat_purchase":
      return "Purchase";
    case "account":
      return "Account";
    default:
      return "Workspace";
  }
}
