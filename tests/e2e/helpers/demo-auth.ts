import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { join } from "node:path";

import { createChunks } from "@supabase/ssr";
import type { BrowserContext, APIRequestContext } from "@playwright/test";

const envFiles = [".env.local", ".env.qa-demo.local", ".env.qa-v1-demo.local"];

export function loadLocalEnv() {
  for (const file of envFiles) {
    try {
      const content = readFileSync(join(process.cwd(), file), "utf8");
      for (const line of content.split(/\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const separatorIndex = trimmed.indexOf("=");
        if (separatorIndex === -1) continue;

        const key = trimmed.slice(0, separatorIndex);
        const value = trimmed.slice(separatorIndex + 1);
        process.env[key] ||= value;
      }
    } catch {
      // Local QA env files are intentionally optional in CI.
    }
  }
}

export function hasDemoAuthEnv() {
  loadLocalEnv();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const hasPlaceholderSupabase =
    !supabaseUrl ||
    supabaseUrl === "http://127.0.0.1:54321" ||
    supabaseUrl === "http://localhost:54321" ||
    anonKey === "local-placeholder-anon-key";

  return Boolean(
    !hasPlaceholderSupabase &&
      supabaseUrl &&
      anonKey &&
      process.env.QA_DEMO_EMAIL &&
      process.env.QA_DEMO_PASSWORD,
  );
}

export async function authenticateDemoUser({
  context,
  request,
}: {
  context: BrowserContext;
  request: APIRequestContext;
}) {
  loadLocalEnv();

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const email = requireEnv("QA_DEMO_EMAIL");
  const password = requireEnv("QA_DEMO_PASSWORD");
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const tokenResponse = await request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    data: { email, password },
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
    },
  });

  if (!tokenResponse.ok()) {
    throw new Error(`Unable to authenticate demo user for QA: ${tokenResponse.status()}`);
  }

  const session = await tokenResponse.json();
  const cookieName = `sb-${projectRef}-auth-token`;
  const cookieValue = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  const chunks = createChunks(cookieName, cookieValue);
  const mfaCookieValue = signMfaCookie({
    email,
    userId: session.user.id,
  });

  await context.addCookies(
    [
      ...chunks.map(({ name, value }) => ({
        domain: "localhost",
        httpOnly: false,
        name,
        path: "/",
        sameSite: "Lax" as const,
        secure: false,
        value,
      })),
      {
        domain: "localhost",
        httpOnly: true,
        name: "pramania_email_mfa",
        path: "/",
        sameSite: "Lax" as const,
        secure: false,
        value: mfaCookieValue,
      },
    ],
  );
}

function signMfaCookie({ email, userId }: { email: string; userId: string }) {
  const payload = {
    email: email.trim().toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60,
    userId,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const secret = process.env.AUTH_MFA_COOKIE_SECRET ?? "local-pramania-auth-cookie-secret";
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");

  return `${encodedPayload}.${signature}`;
}

function requireEnv(key: string) {
  const value = process.env[key];

  if (!value) {
    throw new Error(`Missing ${key}`);
  }

  return value;
}
