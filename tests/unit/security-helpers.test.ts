import { describe, expect, test } from "vitest";

import { getClientRateLimitKey } from "@/lib/security/rate-limit";
import { redactOperationalMetadata, redactOperationalText } from "@/lib/security/redaction";
import { assertExternalHttpUrl, isHttpUrl } from "@/lib/security/url-safety";

describe("security helpers", () => {
  test("accepts only http and https URL strings before external safety checks", () => {
    expect(isHttpUrl("https://company.example/careers")).toBe(true);
    expect(isHttpUrl("http://company.example/jobs")).toBe(true);
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
  });

  test("blocks local, credentialed, and private-network job URLs", () => {
    const blockedInputs = [
      "file:///etc/passwd",
      "https://localhost/jobs",
      "https://user:pass@example.com/jobs",
      "http://127.0.0.1:54321/internal",
      "http://10.0.0.5/jobs",
      "http://172.16.1.10/jobs",
      "http://192.168.1.20/jobs",
      "http://[::1]/jobs",
    ];

    for (const input of blockedInputs) {
      expect(() =>
        assertExternalHttpUrl(input, {
          blockedErrorCode: "job.invalid_url",
          unsupportedProtocolErrorCode: "job.invalid_url",
        }),
      ).toThrow("job.invalid_url");
    }
  });

  test("allows public external http URLs", () => {
    expect(() =>
      assertExternalHttpUrl("https://careers.openai.com/jobs/example", {
        blockedErrorCode: "job.invalid_url",
      }),
    ).not.toThrow();
  });

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
});
