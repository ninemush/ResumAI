import "server-only";

import { z } from "zod";

import {
  CREDIT_COSTS,
  CREDIT_EXAMPLE_JOURNEYS,
  CREDIT_FREE_ACTIONS,
  CREDIT_PURCHASE_OPTIONS,
  CREDIT_USAGE_GUIDE,
  type CreditFeature,
} from "@/lib/billing/credit-catalog";
import { createClient } from "@/lib/supabase/server";

export {
  CREDIT_COSTS,
  CREDIT_EXAMPLE_JOURNEYS,
  CREDIT_FREE_ACTIONS,
  CREDIT_PURCHASE_OPTIONS,
  CREDIT_USAGE_GUIDE,
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
  resourceId,
  resourceType,
}: {
  feature: CreditFeature;
  metadata?: Record<string, unknown>;
  resourceId?: string;
  resourceType: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("consume_credits", {
    p_amount: CREDIT_COSTS[feature],
    p_event_type: `feature_${feature}`,
    p_metadata: metadata,
    p_resource_id: resourceId ?? null,
    p_resource_type: resourceType,
  });

  if (error || !data) {
    throw mapCreditError(error?.message);
  }

  return withPurchaseOptions(creditSummarySchema.parse(data));
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

  const rows = z.array(creditLedgerRowSchema).parse(data ?? []).map(mapCreditLedgerRow);

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
      message: "Promo codes can use uppercase letters, numbers, dashes, and underscores.",
    }),
  creditAmount: z.number().int().min(1).max(500),
  description: z.string().trim().max(240).default(""),
  expiresAt: z.string().datetime().optional().or(z.literal("").transform(() => undefined)),
  maxRedemptions: z.number().int().min(1).max(5000).default(1),
});

export async function createPromoCode(input: z.input<typeof createPromoCodeSchema>) {
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
    throw new Error(error?.code === "42501" ? "ADMIN_REQUIRED" : "PROMO_CREATE_FAILED");
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
  promo_code_redemptions: z.array(z.object({ id: z.string().uuid() })).optional(),
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
    throw new Error(error.code === "42501" ? "ADMIN_REQUIRED" : "PROMO_LIST_FAILED");
  }

  return z.array(promoCodeRowSchema).parse(data ?? []).map((row) => ({
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

async function requireAdminUser(supabase: Awaited<ReturnType<typeof createClient>>) {
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
        "You have used your included credits. Add credits to keep reading sources, creating packets, and downloading files.",
      purchaseOptions: error.summary?.purchaseOptions ?? getPurchaseOptions(),
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

    if (error.message === "ADMIN_REQUIRED") {
      return {
        category: "auth",
        code: "auth.owner_required",
        message: "Owner/admin access is required.",
        status: 403,
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
  }

  return {
    category: "server",
    code: "billing.operation_failed",
    message: "Unable to update credits right now.",
    status: 500,
  };
}

function mapCreditError(message: string | undefined) {
  if (message?.includes("CREDITS_EXHAUSTED")) {
    return new CreditsExhaustedError();
  }

  if (message?.includes("AUTH_REQUIRED")) {
    return new Error("AUTH_REQUIRED");
  }

  if (message?.includes("ADMIN_REQUIRED")) {
    return new Error("ADMIN_REQUIRED");
  }

  if (message?.includes("PROMO_CODE_INVALID")) {
    return new Error("PROMO_CODE_INVALID");
  }

  if (message?.includes("PROMO_CODE_EXHAUSTED")) {
    return new Error("PROMO_CODE_EXHAUSTED");
  }

  if (message?.includes("PROMO_CODE_ALREADY_REDEEMED")) {
    return new Error("PROMO_CODE_ALREADY_REDEEMED");
  }

  if (message?.includes("PROMO_CODE_NOT_ASSIGNED")) {
    return new Error("PROMO_CODE_NOT_ASSIGNED");
  }

  return new Error("CREDIT_OPERATION_FAILED");
}

function withPurchaseOptions(summary: z.infer<typeof creditSummarySchema>): CreditSummary {
  return {
    ...summary,
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

function mapCreditLedgerRow(row: z.infer<typeof creditLedgerRowSchema>): CreditLedgerEvent {
  const amount = row.credit_delta;
  const metadata = row.metadata ?? {};
  const productId = typeof metadata.product_id === "string" ? metadata.product_id : null;
  const purchaseOption =
    productId ? CREDIT_PURCHASE_OPTIONS.find((option) => option.productId === productId) : null;
  const kind: CreditLedgerEvent["kind"] =
    row.event_type === "revenuecat_purchase"
      ? "purchase"
      : amount > 0
        ? "grant"
        : "usage";

  return {
    amount,
    createdAt: row.created_at,
    description: describeCreditEvent(row.event_type, row.resource_type, purchaseOption?.label),
    eventType: row.event_type,
    id: row.id,
    invoiceStatus: kind === "purchase" ? "receipt_emailed" : "not_applicable",
    kind,
    resourceLabel: describeResource(row.resource_type),
  };
}

function describeCreditEvent(eventType: string, resourceType: string | null, purchaseLabel?: string) {
  if (eventType === "signup_bonus") return "Starter credits";
  if (eventType === "promo_code_redeemed") return "Promo code credit grant";
  if (eventType === "revenuecat_purchase") return `${purchaseLabel ?? "Credit pack"} purchase`;

  const feature = eventType.replace(/^feature_/, "");

  switch (feature) {
    case "applicationMaterialsExport":
      return "Downloaded application files";
    case "applicationMaterialsGenerate":
      return "Created role-specific application packet";
    case "jobIngest":
      return "Read and analyzed a job link";
    case "masterResumeExport":
      return "Downloaded master resume files";
    case "masterResumeGenerate":
      return "Created master resume draft";
    case "profileSourceExtract":
      return "Read a resume, profile, link, or file";
    default:
      return resourceType ? `Credit activity for ${describeResource(resourceType)}` : "Credit activity";
  }
}

function describeResource(resourceType: string | null) {
  switch (resourceType) {
    case "application":
      return "Application";
    case "application_materials":
      return "Application materials";
    case "job_post":
      return "Job post";
    case "master_resume":
      return "Master resume";
    case "profile_source":
      return "Profile source";
    case "promo_code":
      return "Promo code";
    case "revenuecat_purchase":
      return "Purchase";
    case "account":
      return "Account";
    default:
      return "Workspace";
  }
}
