import { expect, test } from "@playwright/test";

test("exposes public release metadata without admin auth", async ({ request }) => {
  const response = await request.get("/api/release");
  const payload = await response.json();

  expect(response.ok()).toBe(true);
  expect(payload.ok).toBe(true);
  expect(payload.release).toMatchObject({
    buildTime: expect.any(String),
    provenanceAvailable: expect.any(Boolean),
    targetEnvironment: expect.any(String),
  });
  expect(Object.keys(payload.release).sort()).toEqual([
    "buildTime",
    "deploymentId",
    "deploymentUrl",
    "gitCommitRef",
    "gitCommitSha",
    "provenanceAvailable",
    "targetEnvironment",
  ]);
  expect(JSON.stringify(payload.release)).not.toMatch(
    /authorization|bearer|cookie|password|secret|service_role/i,
  );
});
