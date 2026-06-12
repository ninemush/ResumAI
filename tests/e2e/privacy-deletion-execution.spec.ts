import { expect, test } from "@playwright/test";

import {
  buildAdminAuthCookieHeader,
  buildAuthCookieHeader,
  hasLaunchReadinessEnv,
  loadLocalEnv,
} from "./helpers/demo-auth";
import {
  cleanRowsByIds,
  createServiceRoleClient,
  insertRow,
  readUserIdByEmail,
} from "./helpers/launch-fixtures";

type CleanupMap = Record<string, string[]>;

test.describe("privacy deletion execution maturity", () => {
  test.skip(
    !hasLaunchReadinessEnv(),
    "Launch readiness env, service role, admin, and two-user QA credentials are required for deletion execution evidence.",
  );

  test("proves owner deletion review deletes, minimizes, retains, and audits expected records", async ({ request }) => {
    loadLocalEnv();

    const admin = createServiceRoleClient();
    const marker = `launch-deletion-${crypto.randomUUID()}`;
    const subjectUserId = await readUserIdByEmail(process.env.QA_DEMO_USER_A_EMAIL ?? "");
    const sourceStoragePath = `${subjectUserId}/${marker}/source.txt`;
    const masterPdfPath = `${subjectUserId}/${marker}/master.pdf`;
    const masterDocxPath = `${subjectUserId}/${marker}/master.docx`;
    const applicationPdfPath = `${subjectUserId}/${marker}/application.pdf`;
    const applicationDocxPath = `${subjectUserId}/${marker}/application.docx`;
    const coverPdfPath = `${subjectUserId}/${marker}/cover.pdf`;
    const coverDocxPath = `${subjectUserId}/${marker}/cover.docx`;
    const cleanup: CleanupMap = {
      admin_access_audit_events: [],
      audit_events: [],
      credit_ledger: [],
      credit_reservations: [],
      generated_cover_letters: [],
      generated_resumes: [],
      applications: [],
      quota_events: [],
      career_profiles: [],
      profile_source_analyses: [],
      profile_facts: [],
      profile_sources: [],
      profiles: [],
      privacy_requests: [],
    };

    try {
      await uploadStorageObject(admin, "profile-sources", sourceStoragePath, `source ${marker}`);
      await uploadStorageObject(admin, "generated-artifacts", masterPdfPath, `master pdf ${marker}`);
      await uploadStorageObject(admin, "generated-artifacts", masterDocxPath, `master docx ${marker}`);
      await uploadStorageObject(admin, "generated-artifacts", applicationPdfPath, `application pdf ${marker}`);
      await uploadStorageObject(admin, "generated-artifacts", applicationDocxPath, `application docx ${marker}`);
      await uploadStorageObject(admin, "generated-artifacts", coverPdfPath, `cover pdf ${marker}`);
      await uploadStorageObject(admin, "generated-artifacts", coverDocxPath, `cover docx ${marker}`);

      const userCookies = await buildAuthCookieHeader({
        email: process.env.QA_DEMO_USER_A_EMAIL ?? "",
        password: process.env.QA_DEMO_USER_A_PASSWORD ?? "",
        request,
      });
      const adminCookies = await buildAdminAuthCookieHeader({ request });
      const profileId = await ensureProfile(admin, subjectUserId, marker, cleanup);
      const sourceId = await insertRow(admin, "profile_sources", {
        user_id: subjectUserId,
        profile_id: profileId,
        source_type: "txt",
        storage_path: sourceStoragePath,
        original_filename: `${marker}.txt`,
        mime_type: "text/plain",
        extracted_text: `Deletion execution source ${marker}`,
        extraction_status: "succeeded",
      });
      cleanup.profile_sources.push(sourceId);
      cleanup.profile_facts.push(
        await insertRow(admin, "profile_facts", {
          user_id: subjectUserId,
          profile_id: profileId,
          fact_type: "experience",
          fact_value: `Deletion execution fact ${marker}`,
          origin: "user_provided",
          source_ids: [sourceId],
          confidence: 0.99,
          user_confirmed: true,
        }),
      );
      cleanup.profile_source_analyses.push(
        await insertRow(admin, "profile_source_analyses", {
          user_id: subjectUserId,
          profile_id: profileId,
          source_id: sourceId,
          schema_version: "launch-maturity-test",
          prompt_version: "launch-maturity-test",
          model: "test",
          status: "analyzed",
          content_json: { marker },
          confidence: 0.99,
        }),
      );
      cleanup.career_profiles.push(
        await insertRow(admin, "career_profiles", {
          user_id: subjectUserId,
          profile_id: profileId,
          schema_version: "launch-maturity-test",
          version_number: 99,
          content_json: { marker },
          merge_metadata: { marker },
          status: "ready",
          is_current: false,
        }),
      );
      cleanup.generated_resumes.push(
        await insertRow(admin, "generated_resumes", {
          user_id: subjectUserId,
          profile_id: profileId,
          resume_type: "master",
          prompt_version: "launch-maturity-test",
          model: "test",
          content_json: { marker, kind: "master" },
          storage_path: `${subjectUserId}/${marker}/master.json`,
          pdf_storage_path: masterPdfPath,
          docx_storage_path: masterDocxPath,
          status: "ready",
          is_current: false,
        }),
      );
      const draftApplicationId = await insertRow(admin, "applications", {
        user_id: subjectUserId,
        profile_id: profileId,
        company_name: `Draft ${marker}`,
        job_title: "Draft Role",
        job_url: `https://example.com/${marker}/draft`,
        status: "draft",
      });
      cleanup.applications.push(draftApplicationId);
      const quotaEventId = await insertRow(admin, "quota_events", {
        user_id: subjectUserId,
        event_type: "application_logged",
        resource_type: "application",
        amount: 1,
        period_start: new Date(Date.now() - 60_000).toISOString(),
        period_end: new Date(Date.now() + 86_400_000).toISOString(),
        metadata: { marker },
      });
      cleanup.quota_events.push(quotaEventId);
      const submittedApplicationId = await insertRow(admin, "applications", {
        user_id: subjectUserId,
        profile_id: profileId,
        company_name: `Submitted ${marker}`,
        job_title: "Submitted Role",
        job_url: `https://example.com/${marker}/submitted`,
        quota_event_id: quotaEventId,
        status: "applied",
      });
      cleanup.applications.push(submittedApplicationId);
      cleanup.generated_resumes.push(
        await insertRow(admin, "generated_resumes", {
          user_id: subjectUserId,
          profile_id: profileId,
          application_id: submittedApplicationId,
          resume_type: "application",
          prompt_version: "launch-maturity-test",
          model: "test",
          content_json: { marker, kind: "application" },
          pdf_storage_path: applicationPdfPath,
          docx_storage_path: applicationDocxPath,
          status: "ready",
          is_current: false,
        }),
      );
      cleanup.generated_cover_letters.push(
        await insertRow(admin, "generated_cover_letters", {
          user_id: subjectUserId,
          application_id: submittedApplicationId,
          prompt_version: "launch-maturity-test",
          model: "test",
          content: `Deletion execution cover letter ${marker}`,
          pdf_storage_path: coverPdfPath,
          docx_storage_path: coverDocxPath,
          status: "ready",
          is_current: false,
        }),
      );
      cleanup.credit_ledger.push(
        await insertRow(admin, "credit_ledger", {
          user_id: subjectUserId,
          event_type: "launch_maturity_credit_probe",
          credit_delta: 1,
          resource_type: "launch_maturity",
          metadata: { marker },
        }),
      );
      cleanup.credit_reservations.push(
        await insertRow(admin, "credit_reservations", {
          user_id: subjectUserId,
          feature: "applicationMaterialsGenerate",
          amount: 1,
          resource_type: "application_materials",
          resource_id: submittedApplicationId,
          idempotency_key: `${marker}:reservation`,
          status: "released",
          metadata: { marker },
        }),
      );
      cleanup.audit_events.push(
        await insertRow(admin, "audit_events", {
          user_id: subjectUserId,
          event_type: "launch_maturity.audit_seeded",
          resource_type: "launch_maturity",
          resource_id: submittedApplicationId,
          metadata: { marker },
        }),
      );
      cleanup.admin_access_audit_events.push(
        await insertRow(admin, "admin_access_audit_events", {
          actor_user_id: subjectUserId,
          target_user_id: subjectUserId,
          visibility_level: "launch_maturity",
          access_reason: "privacy_deletion_test",
          resource_type: "launch_maturity",
          resource_id: submittedApplicationId,
          metadata: { marker, sensitiveProbe: true },
        }),
      );

      const privacyResponse = await request.post("/api/privacy/requests", {
        data: {
          requestType: "deletion",
          subject: `Launch deletion execution ${marker}`,
        },
        headers: { cookie: userCookies },
      });
      const privacyPayload = await privacyResponse.json();

      expect(privacyResponse.ok()).toBe(true);
      const privacyRequestId = privacyPayload.request.id as string;
      cleanup.privacy_requests.push(privacyRequestId);

      const planResponse = await request.patch(`/api/admin/privacy/requests/${privacyRequestId}`, {
        data: { action: "build_deletion_plan" },
        headers: { cookie: adminCookies },
      });
      const planPayload = await planResponse.json();

      expect(planResponse.ok()).toBe(true);
      expect(planPayload.deletionPlan.delete).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ table: "profile_sources", count: expect.any(Number) }),
          expect.objectContaining({ table: "profile_facts", count: expect.any(Number) }),
          expect.objectContaining({ table: "generated_resumes(master)", count: expect.any(Number) }),
        ]),
      );

      const completeResponse = await request.patch(`/api/admin/privacy/requests/${privacyRequestId}`, {
        data: {
          action: "complete_deletion_review",
          resolutionSummary: "Launch maturity test confirmed deletion, minimization, retention, and audit evidence.",
        },
        headers: { cookie: adminCookies },
      });
      const completePayload = await completeResponse.json();

      expect(completeResponse.ok()).toBe(true);
      expect(completePayload.completed.status).toBe("completed");
      expect(completePayload.completed.deletionExecution.storage.buckets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ bucket: "profile-sources", failedPathCount: 0 }),
          expect.objectContaining({ bucket: "generated-artifacts", failedPathCount: 0 }),
        ]),
      );
      expect(completePayload.completed.deletionExecution.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: "deleted", table: "profile_sources" }),
          expect.objectContaining({ action: "deleted", table: "profile_facts" }),
          expect.objectContaining({ action: "minimized", table: "applications(non_draft)" }),
          expect.objectContaining({ action: "retained_with_reason", table: "credit_ledger" }),
          expect.objectContaining({ action: "retained_with_reason", table: "quota_events" }),
        ]),
      );

      await expectMissing(admin, "profile_sources", sourceId);
      await expectMissing(admin, "profile_facts", cleanup.profile_facts[0]);
      await expectMissing(admin, "generated_resumes", cleanup.generated_resumes[0]);
      await expectMissing(admin, "applications", draftApplicationId);

      const submittedApplication = await readRow(admin, "applications", submittedApplicationId);
      expect(submittedApplication.company_name).toBe("Deleted per privacy request");
      expect(submittedApplication.job_title).toBeNull();
      expect(submittedApplication.job_url).toBe("https://deleted.invalid/privacy-request");

      const generatedResume = await readRow(admin, "generated_resumes", cleanup.generated_resumes[1]);
      expect(generatedResume.status).toBe("deleted");
      expect(generatedResume.content_json).toEqual({});
      expect(generatedResume.pdf_storage_path).toBeNull();

      const coverLetter = await readRow(admin, "generated_cover_letters", cleanup.generated_cover_letters[0]);
      expect(coverLetter.status).toBe("deleted");
      expect(coverLetter.content).toBe("");
      expect(coverLetter.pdf_storage_path).toBeNull();

      const creditLedger = await readRow(admin, "credit_ledger", cleanup.credit_ledger[0]);
      expect(creditLedger.metadata.marker).toBe(marker);

      const auditEvents = await readAuditEvents(admin, subjectUserId, privacyRequestId);
      expect(auditEvents.some((event) => event.event_type === "privacy.deletion_execution.completed")).toBe(true);

      await expectStorageMissing(admin, "profile-sources", sourceStoragePath);
      await expectStorageMissing(admin, "generated-artifacts", masterPdfPath);
      await expectStorageMissing(admin, "generated-artifacts", masterDocxPath);
      await expectStorageMissing(admin, "generated-artifacts", applicationPdfPath);
      await expectStorageMissing(admin, "generated-artifacts", applicationDocxPath);
      await expectStorageMissing(admin, "generated-artifacts", coverPdfPath);
      await expectStorageMissing(admin, "generated-artifacts", coverDocxPath);
    } finally {
      await admin.storage.from("profile-sources").remove([sourceStoragePath]);
      await admin.storage
        .from("generated-artifacts")
        .remove([
          masterPdfPath,
          masterDocxPath,
          applicationPdfPath,
          applicationDocxPath,
          coverPdfPath,
          coverDocxPath,
        ]);
      await cleanupSeededRows(admin, cleanup);
    }
  });
});

async function ensureProfile(
  admin: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  marker: string,
  cleanup: CleanupMap,
) {
  const { data: existing, error: readError } = await admin
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) {
    throw new Error(`Unable to read seeded profile: ${readError.message}`);
  }

  if (existing?.id) {
    return existing.id as string;
  }

  const profileId = await insertRow(admin, "profiles", {
    user_id: userId,
    display_name: `Launch QA ${marker}`,
    profile_status: "ready",
  });
  cleanup.profiles.push(profileId);

  return profileId;
}

async function readRow(
  admin: ReturnType<typeof createServiceRoleClient>,
  table: string,
  id: string,
) {
  const { data, error } = await admin.from(table).select("*").eq("id", id).single();

  if (error || !data) {
    throw new Error(`Unable to read ${table}.${id}: ${error?.message ?? "missing row"}`);
  }

  return data as Record<string, unknown>;
}

async function expectMissing(
  admin: ReturnType<typeof createServiceRoleClient>,
  table: string,
  id: string,
) {
  const { data, error } = await admin.from(table).select("id").eq("id", id).maybeSingle();

  expect(error).toBeNull();
  expect(data).toBeNull();
}

async function uploadStorageObject(
  admin: ReturnType<typeof createServiceRoleClient>,
  bucket: string,
  path: string,
  body: string,
) {
  const { error } = await admin.storage.from(bucket).upload(path, new Blob([body]), {
    contentType: "text/plain",
    upsert: true,
  });

  if (error) {
    throw new Error(`Unable to upload ${bucket}/${path}: ${error.message}`);
  }
}

async function expectStorageMissing(
  admin: ReturnType<typeof createServiceRoleClient>,
  bucket: string,
  path: string,
) {
  const { data, error } = await admin.storage.from(bucket).download(path);

  expect(data).toBeNull();
  expect(error?.message ?? "").toMatch(/not found|object/i);
}

async function readAuditEvents(
  admin: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  requestId: string,
) {
  const { data, error } = await admin
    .from("audit_events")
    .select("id, event_type")
    .eq("user_id", userId)
    .eq("request_id", requestId);

  if (error) {
    throw new Error(`Unable to read audit events: ${error.message}`);
  }

  return data ?? [];
}

async function cleanupSeededRows(
  admin: ReturnType<typeof createServiceRoleClient>,
  cleanup: CleanupMap,
) {
  await cleanRowsByIds(admin, "admin_access_audit_events", cleanup.admin_access_audit_events);
  await cleanRowsByIds(admin, "generated_cover_letters", cleanup.generated_cover_letters);
  await cleanRowsByIds(admin, "generated_resumes", cleanup.generated_resumes);
  await cleanRowsByIds(admin, "applications", cleanup.applications);
  await cleanRowsByIds(admin, "quota_events", cleanup.quota_events);
  await cleanRowsByIds(admin, "credit_reservations", cleanup.credit_reservations);
  await cleanRowsByIds(admin, "credit_ledger", cleanup.credit_ledger);
  await cleanRowsByIds(admin, "career_profiles", cleanup.career_profiles);
  await cleanRowsByIds(admin, "profile_source_analyses", cleanup.profile_source_analyses);
  await cleanRowsByIds(admin, "profile_facts", cleanup.profile_facts);
  await cleanRowsByIds(admin, "profile_sources", cleanup.profile_sources);
  await cleanRowsByIds(admin, "privacy_requests", cleanup.privacy_requests);
  await cleanRowsByIds(admin, "audit_events", cleanup.audit_events);
  await cleanRowsByIds(admin, "profiles", cleanup.profiles);
}
