import { expect, test } from "@playwright/test";

test("requires authentication before reviewing job fit", async ({ request }) => {
  const response = await request.get("/api/jobs/00000000-0000-4000-8000-000000000000/fit");
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(payload.error.code).toBe("auth.required");
});
