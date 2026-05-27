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
