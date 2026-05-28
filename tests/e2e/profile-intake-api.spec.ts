import { expect, test } from "@playwright/test";

test("requires authentication before career profile intake", async ({ request }) => {
  const response = await request.post("/api/profile/intake", {
    data: {
      message: "I led customer success teams for enterprise SaaS renewals.",
    },
  });
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(payload.error).toBe("Sign in is required.");
});

test("requires authentication before saving conversation messages", async ({ request }) => {
  const response = await request.post("/api/conversation/messages", {
    data: {
      speaker: "user",
      text: "I want to build my career profile.",
    },
  });
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(payload.error).toBe("Sign in is required.");
});

test("requires authentication before using the contextual advisor", async ({ request }) => {
  const response = await request.post("/api/conversation/advisor", {
    data: {
      message: "Based on what you know about me, what career advice would you give?",
      surface: "profile",
    },
  });
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(payload.error.message).toBe("Please sign in before asking Pramania to review your profile.");
});

test("requires authentication before creating profile sources", async ({ request }) => {
  const response = await request.post("/api/profile/sources", {
    data: {
      sourceType: "natural_language",
      text: "I managed enterprise renewals and customer escalations.",
    },
  });
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(payload.error.code).toBe("auth.required");
});

test("requires authentication before reading profile sources", async ({ request }) => {
  const response = await request.get("/api/profile/sources");
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(payload.error.code).toBe("auth.required");
});

test("requires authentication before updating profile fields", async ({ request }) => {
  const response = await request.patch("/api/profile", {
    data: {
      targetDirection: "Product leadership",
    },
  });
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(payload.error.code).toBe("auth.required");
});

test("requires authentication before accepting terms", async ({ request }) => {
  const response = await request.post("/api/legal/terms", {
    data: {
      version: "2026-05-28",
    },
  });
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(payload.error.code).toBe("auth.required");
});

test("requires authentication before extracting profile sources", async ({ request }) => {
  const response = await request.post(
    "/api/profile/sources/00000000-0000-4000-8000-000000000000/extract",
  );
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(payload.error.code).toBe("auth.required");
});

test("requires authentication before editing profile facts", async ({ request }) => {
  const response = await request.patch(
    "/api/profile/facts/00000000-0000-4000-8000-000000000000/confirm",
    {
      data: {
        value: "Led enterprise customer success teams.",
      },
    },
  );
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(payload.error.code).toBe("auth.required");
});

test("requires authentication before deleting profile facts", async ({ request }) => {
  const response = await request.delete(
    "/api/profile/facts/00000000-0000-4000-8000-000000000000/confirm",
  );
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(payload.error.code).toBe("auth.required");
});
