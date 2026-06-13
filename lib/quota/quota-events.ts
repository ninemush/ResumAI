import "server-only";

import { z } from "zod";

import { buildQuotaOperationKey } from "@/lib/quota/operation-key";
import { createClient } from "@/lib/supabase/server";

export { buildQuotaOperationKey } from "@/lib/quota/operation-key";

const quotaEventSchema = z.object({
  amount: z.number().int().positive().default(1),
  eventType: z.enum(["application_logged", "generation_created", "manual_adjustment"]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  operationKey: z.string().trim().min(8).max(180).optional(),
  resourceId: z.string().uuid(),
  resourceType: z.string().min(1).max(120),
});

const quotaReservationStatusSchema = z.enum(["reserved", "finalized", "released", "expired"]);

const quotaReservationResultSchema = z.object({
  quotaEventId: z.string().uuid().nullable(),
  reservationId: z.string().uuid(),
  status: quotaReservationStatusSchema,
});

const quotaReservationSchema = quotaEventSchema.extend({
  operationKey: z.string().trim().min(8).max(180),
  resourceId: z.string().uuid().nullable(),
});

export type QuotaReservationResult = z.infer<typeof quotaReservationResultSchema>;

export async function recordQuotaEvent(input: z.input<typeof quotaEventSchema>) {
  const parsed = quotaEventSchema.parse(input);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_quota_event", {
    p_amount: parsed.amount,
    p_event_type: parsed.eventType,
    p_metadata: {
      ...parsed.metadata,
      operation_key: parsed.operationKey ?? buildQuotaOperationKey(parsed),
    },
    p_resource_id: parsed.resourceId,
    p_resource_type: parsed.resourceType,
  });

  if (error || !data) {
    throw mapQuotaError(error?.message, "QUOTA_EVENT_RECORD_FAILED");
  }

  return data as string;
}

export async function reserveQuotaEvent(
  input: z.input<typeof quotaReservationSchema>,
): Promise<QuotaReservationResult> {
  const parsed = quotaReservationSchema.parse(input);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reserve_quota_event", {
    p_amount: parsed.amount,
    p_event_type: parsed.eventType,
    p_metadata: parsed.metadata,
    p_operation_key: parsed.operationKey,
    p_resource_id: parsed.resourceId,
    p_resource_type: parsed.resourceType,
  });

  if (error || !data) {
    throw mapQuotaError(error?.message, "QUOTA_RESERVATION_FAILED");
  }

  return normalizeQuotaReservationResult(data);
}

export async function finalizeQuotaReservation({
  metadata = {},
  reservationId,
  resourceId,
}: {
  metadata?: Record<string, unknown>;
  reservationId: string;
  resourceId?: string | null;
}): Promise<QuotaReservationResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finalize_quota_reservation", {
    p_metadata: metadata,
    p_reservation_id: reservationId,
    p_resource_id: resourceId ?? null,
  });

  if (error || !data) {
    throw mapQuotaError(error?.message, "QUOTA_FINALIZATION_FAILED");
  }

  return normalizeQuotaReservationResult(data);
}

export async function releaseQuotaReservation({
  metadata = {},
  reason,
  reservationId,
}: {
  metadata?: Record<string, unknown>;
  reason?: string;
  reservationId: string;
}): Promise<QuotaReservationResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("release_quota_reservation", {
    p_metadata: metadata,
    p_reason: reason ?? null,
    p_reservation_id: reservationId,
  });

  if (error || !data) {
    throw mapQuotaError(error?.message, "QUOTA_RELEASE_FAILED");
  }

  return normalizeQuotaReservationResult(data);
}

function normalizeQuotaReservationResult(value: unknown) {
  const parsed = z.object({
    quotaEventId: z.string().uuid().nullable().optional(),
    quota_event_id: z.string().uuid().nullable().optional(),
    reservationId: z.string().uuid().optional(),
    reservation_id: z.string().uuid().optional(),
    status: quotaReservationStatusSchema,
  }).parse(value);

  const reservationId = parsed.reservationId ?? parsed.reservation_id;

  if (!reservationId) {
    throw new Error("QUOTA_RESERVATION_RESULT_INVALID");
  }

  return quotaReservationResultSchema.parse({
    quotaEventId: parsed.quotaEventId ?? parsed.quota_event_id ?? null,
    reservationId,
    status: parsed.status,
  });
}

function mapQuotaError(message: string | undefined, fallback: string) {
  if (message?.includes("QUOTA_TIER_REQUIRED")) return new Error("QUOTA_TIER_REQUIRED");
  if (message?.includes("QUOTA_LIMIT_REACHED")) return new Error("QUOTA_LIMIT_REACHED");
  if (message?.includes("QUOTA_RESERVATION_NOT_ACTIVE")) {
    return new Error("QUOTA_RESERVATION_NOT_ACTIVE");
  }
  if (message?.includes("QUOTA_RESERVATION_NOT_FOUND")) {
    return new Error("QUOTA_RESERVATION_NOT_FOUND");
  }
  if (message?.includes("INVALID_QUOTA_OPERATION_KEY")) {
    return new Error("INVALID_QUOTA_OPERATION_KEY");
  }
  if (message?.includes("INVALID_QUOTA_AMOUNT")) return new Error("INVALID_QUOTA_AMOUNT");
  if (message?.includes("AUTH_REQUIRED")) return new Error("AUTH_REQUIRED");
  return new Error(fallback);
}
