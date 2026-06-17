import { apiSuccess, createRequestId } from "@/lib/api/responses";
import { readReleaseMetadata } from "@/lib/admin/release-metadata";
import { toPublicReleaseMetadata } from "@/lib/admin/release-metadata-core";
import { checkRateLimit, getClientRateLimitKey, rateLimitResponse } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = createRequestId();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "release_metadata_read"),
    limit: 120,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Release metadata is being checked too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }

  return apiSuccess({
    release: toPublicReleaseMetadata(readReleaseMetadata()),
    requestId,
  });
}
