import { expect, test } from "@playwright/test";

test("requires authentication before generating a master resume", async ({ request }) => {
  const response = await request.post("/api/resume/master");
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(payload.error.code).toBe("auth.required");
});

test("requires authentication before exporting a master resume PDF", async ({ request }) => {
  const response = await request.post("/api/resume/master/export");
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(payload.error.code).toBe("auth.required");
});
