import { expect, test } from "@playwright/test";

const requestId = "00000000-0000-4000-8000-000000000000";

test("requires authentication before reading privacy requests", async ({ request }) => {
  const response = await request.get("/api/privacy/requests");
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("no-store, private");
  expect(payload.error.code).toBe("auth.required");
});

test("requires authentication before creating privacy requests", async ({ request }) => {
  const response = await request.post("/api/privacy/requests", {
    data: {
      requestType: "deletion",
      subject: "Deletion review",
    },
  });
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("no-store, private");
  expect(payload.error.code).toBe("auth.required");
});

test("requires authentication before validating privacy request payloads", async ({ request }) => {
  const response = await request.post("/api/privacy/requests", {
    data: {
      requestType: "account_delete",
    },
  });
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("no-store, private");
  expect(payload.error.code).toBe("auth.required");
});

test("requires authentication before generating a privacy export", async ({ request }) => {
  const response = await request.post("/api/privacy/export");
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("no-store, private");
  expect(payload.error.code).toBe("auth.required");
});

test("requires owner or admin access before reading admin privacy requests", async ({ request }) => {
  const response = await request.get("/api/admin/privacy/requests");
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("no-store, private");
  expect(payload.error.code).toBe("auth.required");
});

test("requires owner or admin access before updating privacy requests", async ({ request }) => {
  const response = await request.patch(`/api/admin/privacy/requests/${requestId}`, {
    data: {
      status: "in_review",
    },
  });
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("no-store, private");
  expect(payload.error.code).toBe("auth.required");
});

test("requires authentication before validating admin privacy request updates", async ({ request }) => {
  const response = await request.patch(`/api/admin/privacy/requests/${requestId}`, {
    data: {
      status: "erased",
    },
  });
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("no-store, private");
  expect(payload.error.code).toBe("auth.required");
});

test("requires authentication before validating deletion review completion", async ({ request }) => {
  const response = await request.patch(`/api/admin/privacy/requests/${requestId}`, {
    data: {
      action: "complete_deletion_review",
    },
  });
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("no-store, private");
  expect(payload.error.code).toBe("auth.required");
});

test("requires owner or admin access before completing deletion review", async ({ request }) => {
  const response = await request.patch(`/api/admin/privacy/requests/${requestId}`, {
    data: {
      action: "complete_deletion_review",
      resolutionSummary: "Deletion and minimization plan applied for eligible records.",
    },
  });
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(payload.error.code).toBe("auth.required");
});

test("requires owner or admin access before reading compliance dashboard", async ({ request }) => {
  const response = await request.get("/api/admin/compliance");
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(payload.error.code).toBe("auth.required");
});

test("requires owner or admin access before reading security incidents", async ({ request }) => {
  const response = await request.get("/api/admin/security/incidents");
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(payload.error.code).toBe("auth.required");
});

test("requires owner or admin access before creating security incidents", async ({ request }) => {
  const response = await request.post("/api/admin/security/incidents", {
    data: {
      severity: "medium",
      title: "Review test incident",
    },
  });
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(payload.error.code).toBe("auth.required");
});

test("requires auth before validating security incident payloads", async ({ request }) => {
  const response = await request.post("/api/admin/security/incidents", {
    data: {
      severity: "urgent",
      title: "Bad",
    },
  });
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(payload.error.code).toBe("auth.required");
});

test("requires owner or admin access before updating security incidents", async ({ request }) => {
  const response = await request.patch(`/api/admin/security/incidents/${requestId}`, {
    data: {
      status: "contained",
    },
  });
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(payload.error.code).toBe("auth.required");
});
