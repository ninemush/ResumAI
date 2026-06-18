import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

const MFA_COOKIE_NAME = "pramania_email_mfa";
const MFA_PENDING_COOKIE_NAME = "pramania_email_mfa_pending";
const MFA_COOKIE_MAX_AGE_SECONDS = 8 * 60 * 60;
const MFA_PENDING_MAX_AGE_SECONDS = 10 * 60;

type MfaCookiePayload = {
  aud?: string;
  email: string;
  exp: number;
  userId: string;
};

export async function setEmailMfaPendingCookie({
  email,
  userId,
}: {
  email: string;
  userId: string;
}) {
  const cookieStore = await cookies();

  cookieStore.set(
    MFA_PENDING_COOKIE_NAME,
    signPayload({
      email: normalizeEmail(email),
      exp: unixNow() + MFA_PENDING_MAX_AGE_SECONDS,
      userId,
    }),
    {
      httpOnly: true,
      maxAge: MFA_PENDING_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  );
}

export async function setEmailMfaVerifiedCookie({
  email,
  userId,
}: {
  email: string;
  userId: string;
}) {
  const cookieStore = await cookies();

  cookieStore.set(
    MFA_COOKIE_NAME,
    signPayload({
      email: normalizeEmail(email),
      exp: unixNow() + MFA_COOKIE_MAX_AGE_SECONDS,
      userId,
    }),
    {
      httpOnly: true,
      maxAge: MFA_COOKIE_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  );

  cookieStore.delete(MFA_PENDING_COOKIE_NAME);
}

export async function clearEmailMfaCookies() {
  const cookieStore = await cookies();

  cookieStore.delete(MFA_COOKIE_NAME);
  cookieStore.delete(MFA_PENDING_COOKIE_NAME);
}

export async function isEmailMfaVerified({
  email,
  userId,
}: {
  email: string | null;
  userId: string;
}) {
  if (!email) {
    return false;
  }

  const cookieStore = await cookies();
  const signedValue = cookieStore.get(MFA_COOKIE_NAME)?.value;
  const payload = signedValue ? verifySignedPayload(signedValue) : null;

  return Boolean(
    payload &&
      payload.userId === userId &&
      payload.email === normalizeEmail(email) &&
      payload.exp > unixNow(),
  );
}

export async function readPendingEmailMfa() {
  const cookieStore = await cookies();
  const signedValue = cookieStore.get(MFA_PENDING_COOKIE_NAME)?.value;

  return signedValue ? verifySignedPayload(signedValue) : null;
}

export function isEmailPasswordProvider(provider: string | null | undefined) {
  return !provider || provider === "email";
}

function signPayload(payload: MfaCookiePayload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", getCookieSecret())
    .update(encodedPayload)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
}

function verifySignedPayload(signedValue: string): MfaCookiePayload | null {
  const [encodedPayload, signature] = signedValue.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));

    if (
      typeof parsed.email !== "string" ||
      typeof parsed.exp !== "number" ||
      typeof parsed.userId !== "string"
    ) {
      return null;
    }

    const payload = parsed as MfaCookiePayload;

    return getCookieSecretCandidates().some(({ allowPayload, secret }) => {
      if (!allowPayload(payload)) {
        return false;
      }

      const expectedSignature = createHmac("sha256", secret)
        .update(encodedPayload)
        .digest("base64url");
      const signatureBuffer = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expectedSignature);

      return (
        signatureBuffer.length === expectedBuffer.length &&
        timingSafeEqual(signatureBuffer, expectedBuffer)
      );
    })
      ? payload
      : null;
  } catch {
    return null;
  }
}

function getCookieSecretCandidates() {
  const primarySecret = getCookieSecret();
  const qaSecret = process.env.AUTH_MFA_QA_COOKIE_SECRET;

  return [
    {
      allowPayload: () => true,
      secret: primarySecret,
    },
    ...(qaSecret && qaSecret.length >= 32
      ? [
          {
            allowPayload: (payload: MfaCookiePayload) => payload.aud === "launch-readiness",
            secret: qaSecret,
          },
        ]
      : []),
  ];
}

function getCookieSecret() {
  const secret = process.env.AUTH_MFA_COOKIE_SECRET;

  if (secret && secret.length >= 32) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_MFA_COOKIE_SECRET_REQUIRED");
  }

  return "local-pramania-auth-cookie-secret";
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}
