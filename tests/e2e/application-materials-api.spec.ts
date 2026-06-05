import { expect, test } from "@playwright/test";

const applicationId = "00000000-0000-4000-8000-000000000000";

test("requires authentication before generating application materials", async ({ request }) => {
  const response = await request.post(`/api/applications/${applicationId}/materials`);
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expectApiErrorEnvelope(payload, "auth.required");
});

test("requires authentication before exporting material files", async ({ request }) => {
  const response = await request.post(`/api/applications/${applicationId}/materials/export`);
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expectApiErrorEnvelope(payload, "auth.required");
});

test("normalizes invalid application material route ids", async ({ request }) => {
  const generateResponse = await request.post("/api/applications/not-a-uuid/materials");
  const generatePayload = await generateResponse.json();
  const exportResponse = await request.post("/api/applications/not-a-uuid/materials/export");
  const exportPayload = await exportResponse.json();

  expect(generateResponse.status()).toBe(400);
  expectApiErrorEnvelope(generatePayload, "application.invalid_id");
  expect(exportResponse.status()).toBe(400);
  expectApiErrorEnvelope(exportPayload, "application.invalid_id");
});

test("requires authentication before archiving an application", async ({ request }) => {
  const response = await request.patch(`/api/applications/${applicationId}/archive`, {
    data: {
      archived: true,
    },
  });
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(payload.error.code).toBe("auth.required");
});

test("requires authentication before updating an application plan", async ({ request }) => {
  const response = await request.patch(`/api/applications/${applicationId}/plan`, {
    data: {
      nextAction: "Follow up with recruiter",
      priority: "normal",
    },
  });
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(payload.error.code).toBe("auth.required");
});

test("validates application plan payload shape", async ({ request }) => {
  const response = await request.patch(`/api/applications/${applicationId}/plan`, {
    data: {
      followUpAt: "not-a-date",
      priority: "urgent",
    },
  });
  const payload = await response.json();

  expect(response.status()).toBe(400);
  expect(payload.error.code).toBe("application.invalid_plan");
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
