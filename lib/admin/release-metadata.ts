import "server-only";

import {
  readReleaseMetadataFromEnv,
  type ReleaseMetadata,
} from "@/lib/admin/release-metadata-core";

export type { ReleaseMetadata } from "@/lib/admin/release-metadata-core";

const releaseBuildTime = new Date();

export function readReleaseMetadata(): ReleaseMetadata {
  return readReleaseMetadataFromEnv(process.env, new Date(), releaseBuildTime);
}
