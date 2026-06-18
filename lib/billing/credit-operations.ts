import "server-only";

import {
  finalizeCreditReservationWithOutput,
  getFinalizedCreditOperationOutput,
  releaseCreditReservation,
  requireCredits,
  reserveCredits,
  type CreditFeature,
  type CreditOperationOutput,
  type CreditReservationResult,
} from "@/lib/billing/credits";

type PaidOperationBuildOutput<T> = (result: T) => {
  finalize?: boolean;
  ledgerMetadata?: Record<string, unknown>;
  outputIds: Record<string, unknown>;
  recordMetadata?: Record<string, unknown>;
  resourceId?: string | null;
  resourceType?: string;
};

export type PaidCreditOperationContext = {
  operationKey: string;
  reservation: CreditReservationResult;
};

export async function runPaidCreditOperation<T>({
  buildOutput,
  buildReusedResult,
  feature,
  metadata = {},
  operationFingerprint,
  operationKey,
  releaseReason = "PAID_OPERATION_REUSED",
  resourceId = null,
  resourceType,
  run,
}: {
  buildOutput: PaidOperationBuildOutput<T>;
  buildReusedResult?: (output: CreditOperationOutput) => Promise<T> | T;
  feature: CreditFeature;
  metadata?: Record<string, unknown>;
  operationFingerprint?: string | null;
  operationKey: string;
  releaseReason?: string;
  resourceId?: string | null;
  resourceType: string;
  run: (context: PaidCreditOperationContext) => Promise<T>;
}): Promise<{ operationKey: string; result: T; reused: boolean }> {
  const finalizedOutput = await getFinalizedCreditOperationOutput({
    feature,
    operationFingerprint,
    operationKey,
  });

  if (finalizedOutput && buildReusedResult) {
    return {
      operationKey,
      result: await buildReusedResult(finalizedOutput),
      reused: true,
    };
  }

  await requireCredits(feature);
  const reservation = await reserveCredits({
    feature,
    metadata,
    operationFingerprint,
    operationKey,
    resourceId,
    resourceType,
  });

  try {
    const result = await run({ operationKey, reservation });
    const output = buildOutput(result);

    if (output.finalize === false) {
      await releaseCreditReservation({
        reason: releaseReason,
        reservationId: reservation.reservationId,
      }).catch(() => undefined);

      return { operationKey, result, reused: true };
    }

    await finalizeCreditReservationWithOutput({
      ledgerMetadata: {
        ...output.ledgerMetadata,
        resource_id: output.resourceId ?? resourceId,
        resource_type: output.resourceType ?? resourceType,
      },
      outputIds: output.outputIds,
      recordMetadata: {
        ...metadata,
        ...output.recordMetadata,
      },
      operationFingerprint,
      reservationId: reservation.reservationId,
      resourceId: output.resourceId ?? resourceId,
      resourceType: output.resourceType ?? resourceType,
    });

    return { operationKey, result, reused: false };
  } catch (error) {
    await releaseCreditReservation({
      metadata: {
        error: error instanceof Error ? error.message : "PAID_OPERATION_FAILED",
      },
      reason: error instanceof Error ? error.message : "PAID_OPERATION_FAILED",
      reservationId: reservation.reservationId,
    }).catch(() => undefined);
    throw error;
  }
}
