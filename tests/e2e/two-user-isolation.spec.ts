import { expect, test } from "@playwright/test";

import {
  buildAuthCookieHeader,
  hasTwoUserIsolationEnv,
  hasLaunchReadinessEnv,
  loadLocalEnv,
} from "./helpers/demo-auth";
import {
  cleanRowsByIds,
  createServiceRoleClient,
  insertRow,
  readUserIdByEmail,
} from "./helpers/launch-fixtures";

test.describe("two-user data isolation", () => {
  test.setTimeout(90_000);

  test.skip(
    !hasTwoUserIsolationEnv(),
    "Two-user QA credentials are required for launch RLS/isolation evidence.",
  );

  test("keeps profile sources, privacy requests, support issues, credits, and admin routes user-scoped", async ({ request }) => {
    loadLocalEnv();

    const userACookies = await buildAuthCookieHeader({
      email: process.env.QA_DEMO_USER_A_EMAIL ?? "",
      password: process.env.QA_DEMO_USER_A_PASSWORD ?? "",
      request,
    });
    const userBCookies = await buildAuthCookieHeader({
      email: process.env.QA_DEMO_USER_B_EMAIL ?? "",
      password: process.env.QA_DEMO_USER_B_PASSWORD ?? "",
      request,
    });

    const sourceResponse = await request.post("/api/profile/sources", {
      data: {
        sourceType: "natural_language",
        text: "Two-user isolation test profile source for User A only.",
      },
      headers: { cookie: userACookies },
    });
    const sourcePayload = await sourceResponse.json();

    expect(sourceResponse.ok()).toBe(true);
    expect(sourcePayload.source.id).toMatch(/[0-9a-f-]{36}/i);

    const userASources = await request.get("/api/profile/sources", {
      headers: { cookie: userACookies },
    });
    const userBSources = await request.get("/api/profile/sources", {
      headers: { cookie: userBCookies },
    });
    const userASourcesPayload = await userASources.json();
    const userBSourcesPayload = await userBSources.json();

    expect(userASourcesPayload.sources.some((source: { id: string }) => source.id === sourcePayload.source.id)).toBe(true);
    expect(userBSourcesPayload.sources.some((source: { id: string }) => source.id === sourcePayload.source.id)).toBe(false);

    const userBDeleteSource = await request.delete(`/api/profile/sources/${sourcePayload.source.id}`, {
      headers: { cookie: userBCookies },
    });
    const userBDeletePayload = await userBDeleteSource.json();

    expect(userBDeleteSource.status()).toBe(404);
    expect(userBDeletePayload.error.code).toBe("source.not_found");

    const privacyResponse = await request.post("/api/privacy/requests", {
      data: {
        requestType: "deletion",
        subject: "Two-user isolation deletion probe",
      },
      headers: { cookie: userACookies },
    });
    const privacyPayload = await privacyResponse.json();

    expect(privacyResponse.ok()).toBe(true);
    expect(privacyPayload.request.id).toMatch(/[0-9a-f-]{36}/i);

    const userBPrivacy = await request.get("/api/privacy/requests", {
      headers: { cookie: userBCookies },
    });
    const userBPrivacyPayload = await userBPrivacy.json();

    expect(userBPrivacyPayload.requests.some((item: { id: string }) => item.id === privacyPayload.request.id)).toBe(false);

    const supportResponse = await request.post("/api/support/issues", {
      data: {
        area: "privacy",
        source: "two-user-isolation-test",
        subject: "Two-user isolation support probe",
        systemResponse: "Support route isolation check.",
        userMessage: "This should only be visible to User A.",
      },
      headers: { cookie: userACookies },
    });
    const supportPayload = await supportResponse.json();

    expect(supportResponse.ok()).toBe(true);
    expect(supportPayload.issue.id).toMatch(/[0-9a-f-]{36}/i);

    const userBSupport = await request.get("/api/support/issues", {
      headers: { cookie: userBCookies },
    });
    const userBSupportPayload = await userBSupport.json();

    expect(userBSupportPayload.issues.some((issue: { id: string }) => issue.id === supportPayload.issue.id)).toBe(false);

    const userBCredits = await request.get("/api/billing/history", {
      headers: { cookie: userBCookies },
    });
    const userBCreditsPayload = await userBCredits.json();

    expect(userBCredits.ok()).toBe(true);
    expect(JSON.stringify(userBCreditsPayload)).not.toContain(sourcePayload.source.id);

    const nonAdminMetrics = await request.get("/api/admin/metrics", {
      headers: { cookie: userBCookies },
    });
    const nonAdminMetricsPayload = await nonAdminMetrics.json();

    expect(nonAdminMetrics.status()).toBe(403);
    expect(nonAdminMetricsPayload.error.code).toBe("admin.required");
  });

  test("blocks cross-user jobs, applications, generated artifacts, downloads, and mutations", async ({ request }) => {
    test.skip(
      !hasLaunchReadinessEnv(),
      "Launch readiness env, service role, admin, and two-user QA credentials are required for seeded isolation evidence.",
    );

    loadLocalEnv();

    const admin = createServiceRoleClient();
    const marker = `launch-isolation-${crypto.randomUUID()}`;
    const userAId = await readUserIdByEmail(process.env.QA_DEMO_USER_A_EMAIL ?? "");
    const cleanup: Record<string, string[]> = {
      generated_cover_letters: [],
      generated_resumes: [],
      applications: [],
      quota_events: [],
      job_ingestions: [],
      profile_sources: [],
      profile_facts: [],
      profiles: [],
    };

    try {
      const userBCookies = await buildAuthCookieHeader({
        email: process.env.QA_DEMO_USER_B_EMAIL ?? "",
        password: process.env.QA_DEMO_USER_B_PASSWORD ?? "",
        request,
      });

      const profileId = await ensureProfile(admin, userAId, marker, cleanup);
      const sourceId = await insertRow(admin, "profile_sources", {
        user_id: userAId,
        profile_id: profileId,
        source_type: "txt",
        storage_path: `${userAId}/${marker}/source.txt`,
        original_filename: `${marker}.txt`,
        mime_type: "text/plain",
        extracted_text: `Two-user launch isolation source ${marker}`,
        extraction_status: "succeeded",
      });
      cleanup.profile_sources.push(sourceId);
      const jobId = await insertRow(admin, "job_ingestions", {
        user_id: userAId,
        job_url: `https://example.com/${marker}`,
        title: "Launch Isolation Role",
        company: "Launch Isolation Company",
        extracted_text: `Role seeded for ${marker}`,
        ingestion_status: "succeeded",
        source_type: "url_fetch",
      });
      cleanup.job_ingestions.push(jobId);
      const quotaEventId = await insertRow(admin, "quota_events", {
        user_id: userAId,
        event_type: "application_logged",
        resource_type: "application",
        amount: 1,
        period_start: new Date(Date.now() - 60_000).toISOString(),
        period_end: new Date(Date.now() + 86_400_000).toISOString(),
        metadata: { marker },
      });
      cleanup.quota_events.push(quotaEventId);
      const applicationId = await insertRow(admin, "applications", {
        user_id: userAId,
        profile_id: profileId,
        company_name: "Launch Isolation Company",
        job_title: "Launch Isolation Role",
        job_url: `https://example.com/${marker}`,
        job_ingestion_id: jobId,
        quota_event_id: quotaEventId,
        status: "draft",
      });
      cleanup.applications.push(applicationId);
      const resumeId = await insertRow(admin, "generated_resumes", {
        user_id: userAId,
        profile_id: profileId,
        application_id: applicationId,
        resume_type: "application",
        prompt_version: "launch-isolation-test",
        model: "test",
        content_json: { marker },
        pdf_storage_path: `${userAId}/${marker}/resume.pdf`,
        docx_storage_path: `${userAId}/${marker}/resume.docx`,
        status: "ready",
      });
      cleanup.generated_resumes.push(resumeId);
      const coverLetterId = await insertRow(admin, "generated_cover_letters", {
        user_id: userAId,
        application_id: applicationId,
        prompt_version: "launch-isolation-test",
        model: "test",
        content: `Cover letter seeded for ${marker}`,
        pdf_storage_path: `${userAId}/${marker}/cover-letter.pdf`,
        docx_storage_path: `${userAId}/${marker}/cover-letter.docx`,
        status: "ready",
      });
      cleanup.generated_cover_letters.push(coverLetterId);

      await expectForeignMutationNotFound(
        request.patch(`/api/jobs/${jobId}/archive`, {
          data: { archived: true },
          headers: { cookie: userBCookies },
        }),
        "job.not_found",
      );
      await expectForeignMutationNotFound(
        request.patch(`/api/jobs/${jobId}/review-status`, {
          data: { reviewStatus: "accepted" },
          headers: { cookie: userBCookies },
        }),
        "job.not_found",
      );
      await expectForeignMutationNotFound(
        request.patch(`/api/applications/${applicationId}/archive`, {
          data: { archived: true },
          headers: { cookie: userBCookies },
        }),
        "application.not_found",
      );
      await expectForeignMutationNotFound(
        request.patch(`/api/applications/${applicationId}/status`, {
          data: { status: "withdrawn" },
          headers: { cookie: userBCookies },
        }),
        "application.not_found",
      );
      await expectForeignMutationNotFound(
        request.post("/api/applications", {
          data: {
            decision: "apply",
            decisionReason: "Foreign job probe",
            jobIngestionId: jobId,
            status: "draft",
          },
          headers: { cookie: userBCookies },
        }),
        "application.job_not_found",
      );
      await expectForeignMutationNotFound(
        request.get(`/api/profile/sources/${sourceId}/download`, {
          headers: { cookie: userBCookies },
        }),
        "source.download_not_available",
      );
      await expectForeignMutationNotFound(
        request.get(`/api/artifacts/resume/${resumeId}/download?format=pdf`, {
          headers: { cookie: userBCookies },
          maxRedirects: 0,
        }),
        "artifact.download_not_available",
      );
      await expectForeignMutationNotFound(
        request.get(`/api/artifacts/cover-letter/${coverLetterId}/download?format=pdf`, {
          headers: { cookie: userBCookies },
          maxRedirects: 0,
        }),
        "artifact.download_not_available",
      );
      await expectForeignMutationNotFound(
        request.post(`/api/applications/${applicationId}/materials/export`, {
          headers: { cookie: userBCookies },
        }),
        "application.not_found",
      );
    } finally {
      await cleanupSeededRows(admin, cleanup);
    }
  });
});

async function ensureProfile(
  admin: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  marker: string,
  cleanup: Record<string, string[]>,
) {
  const { data: existing, error: readError } = await admin
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) {
    throw new Error(`Unable to read seeded profile: ${readError.message}`);
  }

  const existingProfile = existing as { id?: string } | null;

  if (existingProfile?.id) {
    return existingProfile.id;
  }

  const profileId = await insertRow(admin, "profiles", {
    user_id: userId,
    display_name: `Launch QA ${marker}`,
    profile_status: "ready",
  });
  cleanup.profiles.push(profileId);

  return profileId;
}

async function expectForeignMutationNotFound(
  responsePromise: Promise<{
    json: () => Promise<{ error?: { code?: string } }>;
    status: () => number;
  }>,
  expectedCode: string,
) {
  const response = await responsePromise;
  const payload = await response.json();

  expect(response.status()).toBe(404);
  expect(payload.error?.code).toBe(expectedCode);
}

async function cleanupSeededRows(
  admin: ReturnType<typeof createServiceRoleClient>,
  cleanup: Record<string, string[]>,
) {
  await cleanRowsByIds(admin, "generated_cover_letters", cleanup.generated_cover_letters);
  await cleanRowsByIds(admin, "generated_resumes", cleanup.generated_resumes);
  await cleanRowsByIds(admin, "applications", cleanup.applications);
  await cleanRowsByIds(admin, "quota_events", cleanup.quota_events);
  await cleanRowsByIds(admin, "job_ingestions", cleanup.job_ingestions);
  await cleanRowsByIds(admin, "profile_facts", cleanup.profile_facts);
  await cleanRowsByIds(admin, "profile_sources", cleanup.profile_sources);
  await cleanRowsByIds(admin, "profiles", cleanup.profiles);
}
