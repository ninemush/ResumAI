import "server-only";

import { NextResponse } from "next/server";

import { isEmailMfaVerified, isEmailPasswordProvider } from "@/lib/auth/session-security";
import { getWorkspaceSession, type WorkspaceSession } from "@/lib/commands/session";

type ProtectedApiSessionOptions = {
  requireAdmin?: boolean;
  requireTerms?: boolean;
};

type ApiAuthErrorCode = "AUTH_REQUIRED" | "TERMS_REQUIRED" | "EMAIL_MFA_REQUIRED" | "ADMIN_REQUIRED";

export class ApiAuthError extends Error {
  readonly status: number;

  constructor(code: ApiAuthErrorCode, status: number) {
    super(code);
    this.status = status;
  }
}

export async function requireProtectedApiSession({
  requireAdmin = false,
  requireTerms = true,
}: ProtectedApiSessionOptions = {}): Promise<WorkspaceSession> {
  const session = await getWorkspaceSession();

  if (!session) {
    throw new ApiAuthError("AUTH_REQUIRED", 401);
  }

  if (requireTerms && session.legal.requiresTermsAcceptance) {
    throw new ApiAuthError("TERMS_REQUIRED", 403);
  }

  if (
    shouldRequireEmailCodeMfa(session) &&
    !(await isEmailMfaVerified({ email: session.user.email, userId: session.user.id }))
  ) {
    throw new ApiAuthError("EMAIL_MFA_REQUIRED", 403);
  }

  if (requireAdmin && !session.admin.roles.some((role) => role === "owner" || role === "admin")) {
    throw new ApiAuthError("ADMIN_REQUIRED", 403);
  }

  return session;
}

export function shouldRequireEmailCodeMfa(session: WorkspaceSession) {
  return (
    process.env.AUTH_REQUIRE_EMAIL_CODE === "true" &&
    isEmailPasswordProvider(session.user.authProvider)
  );
}

export function apiAuthErrorDetails(error: unknown, fallbackMessage: string) {
  if (error instanceof ApiAuthError || isKnownAuthError(error)) {
    const code = error instanceof Error ? error.message : "AUTH_REQUIRED";

    if (code === "TERMS_REQUIRED") {
      return {
        category: "auth",
        code: "terms.required",
        message: "Accept the current Terms and Privacy Policy before using workspace APIs.",
        status: 403,
      };
    }

    if (code === "EMAIL_MFA_REQUIRED") {
      return {
        category: "auth",
        code: "auth.email_code_required",
        message: "Verify your email code before using workspace APIs.",
        status: 403,
      };
    }

    if (code === "ADMIN_REQUIRED") {
      return {
        category: "auth",
        code: "admin.required",
        message: "Owner or admin access is required.",
        status: 403,
      };
    }

    return {
      category: "auth",
      code: "auth.required",
      message: fallbackMessage,
      status: 401,
    };
  }

  return null;
}

export function apiAuthErrorResponse({
  error,
  fallbackMessage,
  requestId,
}: {
  error: unknown;
  fallbackMessage: string;
  requestId: string;
}) {
  const details = apiAuthErrorDetails(error, fallbackMessage);

  if (!details) {
    return null;
  }

  return NextResponse.json(
    {
      ok: false,
      requestId,
      error: {
        category: details.category,
        code: details.code,
        message: details.message,
      },
    },
    { status: details.status },
  );
}

function isKnownAuthError(error: unknown) {
  return (
    error instanceof Error &&
    ["AUTH_REQUIRED", "TERMS_REQUIRED", "EMAIL_MFA_REQUIRED", "ADMIN_REQUIRED"].includes(
      error.message,
    )
  );
}
