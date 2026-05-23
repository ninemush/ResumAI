import { NextResponse } from "next/server";

import { getOwnerMetrics } from "@/lib/admin/owner-metrics";

export async function GET() {
  const requestId = crypto.randomUUID();

  try {
    const metrics = await getOwnerMetrics();

    return NextResponse.json({
      ok: true,
      requestId,
      metrics,
    });
  } catch (error) {
    const { category, code, message, status } = toApiError(error);

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: { category, code, message },
      },
      { status },
    );
  }
}

function toApiError(error: unknown) {
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
    code: "admin.metrics_failed",
    message: "Unable to load owner metrics right now.",
    status: 500,
  };
}
