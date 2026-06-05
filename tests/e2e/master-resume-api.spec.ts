import { expect, test } from "@playwright/test";

test("requires authentication before generating a master resume", async ({ request }) => {
  const response = await request.post("/api/resume/master");
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expectApiErrorEnvelope(payload, "auth.required");
});

test("requires authentication before exporting master resume files", async ({ request }) => {
  const response = await request.post("/api/resume/master/export");
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expectApiErrorEnvelope(payload, "auth.required");
});

test("normalizes invalid master resume edit errors", async ({ request }) => {
  const response = await request.patch("/api/resume/master", {
    data: Buffer.from("{"),
    headers: {
      "content-type": "application/json",
    },
  });
  const payload = await response.json();

  expect(response.status()).toBe(400);
  expectApiErrorEnvelope(payload, "request.invalid_json");
});

test("requires owner access before reading platform status", async ({ request }) => {
  const response = await request.get("/api/admin/platform-status");
  const payload = await response.json();

  expect(response.status()).toBe(403);
  expectApiErrorEnvelope(payload, "admin.required");
});

test("requires owner access before repairing master resumes", async ({ request }) => {
  const response = await request.post("/api/admin/resume-repair", {
    data: { dryRun: true },
  });
  const payload = await response.json();

  expect(response.status()).toBe(403);
  expectApiErrorEnvelope(payload, "admin.required");
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
