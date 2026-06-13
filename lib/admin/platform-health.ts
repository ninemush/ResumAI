export type PlatformHealthState = "healthy" | "degraded" | "down" | "unknown";

export type PlatformHealthImpact = "availability" | "cleanup";

export type PlatformHealthCheckSummary = {
  impact: PlatformHealthImpact;
  state: PlatformHealthState;
};

export function summarizeOverallStatus(checks: PlatformHealthCheckSummary[]): PlatformHealthState {
  const availabilityChecks = checks.filter((check) => check.impact === "availability");

  if (availabilityChecks.some((check) => check.state === "down")) return "down";
  if (availabilityChecks.some((check) => check.state === "degraded")) return "degraded";
  if (availabilityChecks.some((check) => check.state === "unknown")) return "unknown";
  return "healthy";
}
