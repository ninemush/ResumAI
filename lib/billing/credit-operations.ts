import "server-only";

import {
  finalizeCreditReservation,
  getFinalizedCreditOperationOutput,
  recordCreditOperationOutput,
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
  operationKey: string;
  releaseReason?: string;
  resourceId?: string | null;
  resourceType: string;
  run: (context: PaidCreditOperationContext) => Promise<T>;
}): Promise<{ operationKey: string; result: T; reused: boolean }> {
  const finalizedOutput = await getFinalizedCreditOperationOutput({
    feature,
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

    const finalizedReservation = await finalizeCreditReservation({
      metadata: {
        ...output.ledgerMetadata,
        output_ids: output.outputIds,
        resource_id: output.resourceId ?? resourceId,
        resource_type: output.resourceType ?? resourceType,
      },
      reservationId: reservation.reservationId,
      resourceId: output.resourceId ?? resourceId,
    });

    await recordCreditOperationOutput({
      feature,
      ledgerEventId: finalizedReservation.ledgerEventId,
      metadata: {
        ...metadata,
        ...output.recordMetadata,
      },
      operationKey,
      outputIds: output.outputIds,
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
