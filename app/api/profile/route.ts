import { NextResponse } from "next/server";

import { updateProfileDraft, updateProfileDraftSchema } from "@/lib/profile/profile-commands";
import {
  checkRateLimit,
  getClientRateLimitKey,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

export async function PATCH(request: Request) {
  const requestId = crypto.randomUUID();
  const rateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "profile_update"),
    limit: 120,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse({
      message: "Profile updates are being saved too quickly. Pause briefly before trying again.",
      requestId,
      result: rateLimit,
    });
  }
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "request.invalid_json",
          message: "Invalid JSON body.",
        },
      },
      { status: 400 },
    );
  }

  const parsed = updateProfileDraftSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          category: "validation",
          code: "profile.invalid_input",
          message: "Use valid profile text before saving.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const profile = await updateProfileDraft(parsed.data);

    return NextResponse.json({
      ok: true,
      requestId,
      profile,
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
      message: "Please sign in before updating your profile.",
      status: 401,
    };
  }

  if (error instanceof Error && error.message === "INVALID_PHOTO_STORAGE_PATH") {
    return {
      category: "validation",
      code: "profile.invalid_photo_storage_path",
      message: "Profile photos must stay inside your private user folder.",
      status: 400,
    };
  }

  return {
    category: "server",
    code: "profile.update_failed",
    message: "Unable to update your profile right now.",
    status: 500,
  };
}
