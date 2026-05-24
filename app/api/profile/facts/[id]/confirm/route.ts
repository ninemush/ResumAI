import { NextResponse } from "next/server";

import { confirmProfileFact, confirmProfileFactSchema } from "@/lib/profile/profile-commands";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const params = await context.params;
  const parsed = confirmProfileFactSchema.safeParse({ factId: params.id });

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "profile_fact.invalid_id",
          message: "Choose a valid profile detail.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const fact = await confirmProfileFact(parsed.data);

    return NextResponse.json({
      ok: true,
      requestId,
      fact,
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
  if (error instanceof Error && error.message === "AUTH_REQUIRED") {
    return {
      category: "auth",
      code: "auth.required",
      message: "Please sign in before confirming profile details.",
      status: 401,
    };
  }

  if (error instanceof Error && error.message === "PROFILE_FACT_NOT_FOUND") {
    return {
      category: "not_found",
      code: "profile_fact.not_found",
      message: "That profile detail could not be found.",
      status: 404,
    };
  }

  return {
    category: "server",
    code: "profile_fact.confirm_failed",
    message: "Unable to confirm that detail right now.",
    status: 500,
  };
}
