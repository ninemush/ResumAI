export function isUnavailableJobPostingRedirect(input: {
  requestedUrl: string;
  resolvedUrl: string;
}) {
  try {
    const requested = new URL(input.requestedUrl);
    const resolved = new URL(input.resolvedUrl);
    const hostname = resolved.hostname.toLowerCase();
    const isGreenhouse = hostname === "job-boards.greenhouse.io" || hostname.endsWith(".greenhouse.io");

    if (!isGreenhouse) {
      return false;
    }

    const requestedJobId = requested.pathname.match(/\/jobs\/(\d+)/)?.[1] ?? null;
    const resolvedJobId = resolved.pathname.match(/\/jobs\/(\d+)/)?.[1] ?? null;

    if (resolved.searchParams.get("error") === "true") {
      return true;
    }

    return Boolean(requestedJobId && requestedJobId !== resolvedJobId);
  } catch {
    return false;
  }
}
