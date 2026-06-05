import { expect, test } from "@playwright/test";

test("normalizes invalid job ingestion JSON errors", async ({ request }) => {
  const response = await request.post("/api/jobs/ingest", {
    data: Buffer.from("{"),
    headers: {
      "content-type": "application/json",
    },
  });
  const payload = await response.json();

  expect(response.status()).toBe(400);
  expectApiErrorEnvelope(payload, "request.invalid_json");
});

test("normalizes invalid job URL errors", async ({ request }) => {
  const response = await request.post("/api/jobs/ingest", {
    data: {
      jobUrl: "file:///etc/passwd",
    },
  });
  const payload = await response.json();

  expect(response.status()).toBe(400);
  expectApiErrorEnvelope(payload, "job.invalid_url");
});

function expectApiErrorEnvelope(payload: {
  error?: {
    code?: string;
    status?: number;
  };
  ok?: boolean;
  requestId?: string;
}, code: string) {
  expect(payload.ok).toBe(false);
  expect(payload.requestId).toEqual(expect.any(String));
  expect(payload.error?.code).toBe(code);
  expect(payload.error).not.toHaveProperty("status");
}
