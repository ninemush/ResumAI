import { expect, test } from "@playwright/test";

import { getClientRateLimitKey } from "@/lib/security/rate-limit";
import { redactOperationalMetadata, redactOperationalText } from "@/lib/security/redaction";

test("builds stable rate-limit keys without raw subjects or host-header bypasses", () => {
  const firstRequest = new Request("https://app.example/api/auth/password-sign-in", {
    headers: {
      "x-forwarded-for": "203.0.113.10",
      "x-forwarded-host": "app.example",
    },
  });
  const secondRequest = new Request("https://app.example/api/auth/password-sign-in", {
    headers: {
      "x-forwarded-for": "203.0.113.10",
      "x-forwarded-host": "attacker-controlled.example",
    },
  });

  const firstKey = getClientRateLimitKey(firstRequest, "Password Sign In", "User@Example.com");
  const secondKey = getClientRateLimitKey(secondRequest, "Password Sign In", "user@example.com");

  expect(firstKey).toBe(secondKey);
  expect(firstKey).toMatch(/^password_sign_in:subject:[a-f0-9]{64}$/);
  expect(firstKey).not.toContain("user@example.com");
  expect(firstKey).not.toContain("app.example");
  expect(firstKey).not.toContain("attacker-controlled.example");
});

test("falls back safely when client IP headers are unusable", () => {
  const spoofedRequest = new Request("https://app.example/api/profile", {
    headers: {
      "x-forwarded-for": "not-an-ip",
      "x-real-ip": "also-not-an-ip",
    },
  });
  const plainRequest = new Request("https://app.example/api/profile");

  expect(getClientRateLimitKey(spoofedRequest, "profile_update")).toBe(
    getClientRateLimitKey(plainRequest, "profile_update"),
  );
});

test("redacts operational text and nested sensitive metadata", () => {
  expect(
    redactOperationalText(
      "Contact jane@example.com with Bearer abcdefghijklmnopqrstuvwxyz123456 and sk_live_abcdefghijklmnopqrstuvwxyz",
    ),
  ).toBe("Contact [redacted_email] with Bearer [redacted_token] and [redacted_key]");

  expect(
    redactOperationalMetadata({
      authorization: "Bearer abcdefghijklmnopqrstuvwxyz123456",
      nested: {
        phone: "+1 555 123 4567",
        session_cookie: "private-cookie",
      },
    }),
  ).toEqual({
    authorization: "[redacted]",
    nested: {
      phone: "[redacted_phone]",
      session_cookie: "[redacted]",
    },
  });
});
