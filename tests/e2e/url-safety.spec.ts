import { expect, test } from "@playwright/test";

import {
  assertExternalHttpUrl,
  assertExternalHttpUrlResolves,
  isHttpUrl,
} from "@/lib/security/url-safety";

test("allows ordinary public http and https URLs", () => {
  expect(isHttpUrl("https://example.com/jobs/123")).toBe(true);
  expect(() => assertExternalHttpUrl("https://example.com/jobs/123")).not.toThrow();
});

test("blocks unsupported protocols and credential-bearing URLs", () => {
  expect(isHttpUrl("file:///etc/passwd")).toBe(false);
  expect(() =>
    assertExternalHttpUrl("file:///etc/passwd", {
      blockedErrorCode: "BLOCKED",
      unsupportedProtocolErrorCode: "UNSUPPORTED",
    }),
  ).toThrow("UNSUPPORTED");
  expect(() =>
    assertExternalHttpUrl("https://user:pass@example.com/profile", {
      blockedErrorCode: "BLOCKED",
    }),
  ).toThrow("BLOCKED");
});

test("blocks local, single-label, and private-network hostnames", async () => {
  for (const url of [
    "http://localhost:3000",
    "http://localhost.",
    "http://printer",
    "http://service.local",
    "http://127.0.0.1",
    "http://2130706433",
    "http://0177.0.0.1",
    "http://0x7f.0.0.1",
    "http://127.1",
    "http://10.0.0.5",
    "http://172.20.1.10",
    "http://192.168.1.20",
    "http://169.254.169.254",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
    "http://[fc00::1]",
    "http://[fe80::1]",
  ]) {
    expect(() =>
      assertExternalHttpUrl(url, {
        blockedErrorCode: "BLOCKED",
      }),
    ).toThrow("BLOCKED");
    await expect(
      assertExternalHttpUrlResolves(url, {
        blockedErrorCode: "BLOCKED",
      }),
    ).rejects.toThrow("BLOCKED");
  }
});
