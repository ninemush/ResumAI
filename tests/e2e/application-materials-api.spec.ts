import { expect, test } from "@playwright/test";

const applicationId = "00000000-0000-4000-8000-000000000000";

test("requires authentication before generating application materials", async ({ request }) => {
  const response = await request.post(`/api/applications/${applicationId}/materials`);
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(payload.error.code).toBe("auth.required");
});

test("requires authentication before exporting material files", async ({ request }) => {
  const response = await request.post(`/api/applications/${applicationId}/materials/export`);
  const payload = await response.json();

  expect(response.status()).toBe(401);
  expect(payload.error.code).toBe("auth.required");
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
