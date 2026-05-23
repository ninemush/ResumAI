import "server-only";

import { z } from "zod";

import { recordQuotaEvent } from "@/lib/quota/quota-events";
import { createClient } from "@/lib/supabase/server";

export const applicationStatusSchema = z.enum([
  "draft",
  "applied",
  "no_reply",
  "rejected",
  "interview_in_progress",
  "interviewed_not_selected",
  "interviewed_selected",
  "withdrawn",
]);

export const createApplicationFromJobSchema = z.object({
  jobIngestionId: z.string().uuid(),
  status: applicationStatusSchema.default("draft"),
});

export const updateApplicationStatusSchema = z.object({
  applicationId: z.string().uuid(),
  status: applicationStatusSchema,
  source: z.enum(["chat", "ui", "system"]).default("ui"),
});

export type ApplicationCommandResult = {
  application: {
    id: string;
    companyName: string;
    jobTitle: string | null;
    jobUrl: string;
    status: z.infer<typeof applicationStatusSchema>;
  };
  created: boolean;
};

export async function createApplicationFromJob(
  input: z.input<typeof createApplicationFromJobSchema>,
): Promise<ApplicationCommandResult> {
  const parsed = createApplicationFromJobSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { data: job, error: jobError } = await supabase
    .from("job_ingestions")
    .select("id, job_url, resolved_url, title, company, ingestion_status")
    .eq("id", parsed.jobIngestionId)
    .eq("user_id", user.id)
    .single();

  if (jobError || !job) {
    throw new Error("JOB_NOT_FOUND");
  }

  if (job.ingestion_status !== "succeeded") {
    throw new Error("JOB_NOT_READY");
  }

  const { data: existingApplication, error: existingError } = await supabase
    .from("applications")
    .select("id, company_name, job_title, job_url, status")
    .eq("user_id", user.id)
    .eq("job_ingestion_id", job.id)
    .maybeSingle();

  if (existingError) {
    throw new Error("APPLICATION_LOOKUP_FAILED");
  }

  if (existingApplication) {
    return {
      application: mapApplication(existingApplication),
      created: false,
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .upsert({ user_id: user.id }, { onConflict: "user_id" })
    .select("id")
    .single();

  if (profileError || !profile) {
    throw new Error("PROFILE_UPSERT_FAILED");
  }

  const jobUrl = job.resolved_url ?? job.job_url;
  const { data: application, error: applicationError } = await supabase
    .from("applications")
    .insert({
      user_id: user.id,
      profile_id: profile.id,
      company_name: normalizeRequiredText(job.company) ?? inferCompanyName(jobUrl),
      job_title: normalizeOptionalText(job.title),
      job_url: jobUrl,
      job_ingestion_id: job.id,
      status: parsed.status,
    })
    .select("id, company_name, job_title, job_url, status")
    .single();

  if (applicationError || !application) {
    throw new Error("APPLICATION_CREATE_FAILED");
  }

  const quotaEventId = await recordQuotaEvent({
    eventType: "application_logged",
    metadata: {
      company_name: application.company_name,
      job_ingestion_id: job.id,
      job_title: application.job_title,
    },
    resourceId: application.id,
    resourceType: "application",
  });

  const { error: quotaLinkError } = await supabase
    .from("applications")
    .update({ quota_event_id: quotaEventId })
    .eq("id", application.id)
    .eq("user_id", user.id);

  if (quotaLinkError) {
    throw new Error("APPLICATION_QUOTA_LINK_FAILED");
  }

  return {
    application: mapApplication(application),
    created: true,
  };
}

export async function updateApplicationStatus(
  input: z.input<typeof updateApplicationStatusSchema>,
): Promise<ApplicationCommandResult> {
  const parsed = updateApplicationStatusSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { data: application, error } = await supabase.rpc("update_application_status", {
    p_application_id: parsed.applicationId,
    p_metadata: {},
    p_new_status: parsed.status,
    p_source: parsed.source,
  });

  if (error || !application) {
    throw new Error(mapStatusUpdateError(error?.message));
  }

  const updatedApplication = Array.isArray(application) ? application[0] : application;

  if (!updatedApplication) {
    throw new Error("APPLICATION_NOT_FOUND");
  }

  return {
    application: mapApplication(updatedApplication),
    created: false,
  };
}

function mapApplication(application: {
  id: string;
  company_name: string;
  job_title: string | null;
  job_url: string;
  status: z.infer<typeof applicationStatusSchema>;
}) {
  return {
    id: application.id,
    companyName: application.company_name,
    jobTitle: application.job_title,
    jobUrl: application.job_url,
    status: application.status,
  };
}

function mapStatusUpdateError(message: string | undefined) {
  if (message?.includes("AUTH_REQUIRED")) return "AUTH_REQUIRED";
  if (message?.includes("APPLICATION_NOT_FOUND")) return "APPLICATION_NOT_FOUND";
  if (message?.includes("FINAL_MATERIALS_REQUIRED")) return "FINAL_MATERIALS_REQUIRED";
  return "APPLICATION_STATUS_EVENT_FAILED";
}

function inferCompanyName(jobUrl: string) {
  try {
    return new URL(jobUrl).hostname.replace(/^www\./, "");
  } catch {
    return "Unknown company";
  }
}

function normalizeOptionalText(value: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 240) : null;
}

function normalizeRequiredText(value: string | null) {
  return normalizeOptionalText(value);
}
