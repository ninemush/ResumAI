import "server-only";

import { createClient } from "@/lib/supabase/server";

export type ApplicationOverview = {
  recentApplications: {
    id: string;
    companyName: string;
    jobTitle: string | null;
    jobUrl: string;
    latestCoverLetterExcerpt: string | null;
    latestCoverLetterHasDocx: boolean;
    latestCoverLetterHasPdf: boolean;
    latestCoverLetterStatus: string | null;
    latestResumeHasDocx: boolean;
    latestResumeHasPdf: boolean;
    latestResumeHeadline: string | null;
    latestResumeStatus: string | null;
    statusEvents: {
      createdAt: string;
      newStatus: string;
      previousStatus: string | null;
      source: string;
    }[];
    status: string;
    createdAt: string;
    updatedAt: string;
  }[];
  openFollowUpCount: number;
  summary: {
    total: number;
    applied: number;
    interviewing: number;
    noReply: number;
    selected: number;
    rejected: number;
    withdrawn: number;
    needsReview: number;
    byStatus: {
      label: string;
      status: string;
      value: number;
    }[];
    byStage: {
      label: string;
      value: number;
    }[];
  };
};

const followUpStatuses = new Set(["applied", "interview_in_progress"]);
const appliedStatuses = new Set(["applied", "no_reply"]);
const interviewingStatuses = new Set([
  "interview_in_progress",
  "interviewed_not_selected",
  "interviewed_selected",
]);
const rejectedStatuses = new Set(["rejected", "interviewed_not_selected", "withdrawn"]);

export async function getApplicationOverview(userId: string): Promise<ApplicationOverview> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .select("id, company_name, job_title, job_url, status, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error("APPLICATION_OVERVIEW_READ_FAILED");
  }

  const applicationIds = (data ?? []).map((application) => application.id);
  const [resumeArtifacts, coverLetterArtifacts, statusEvents] =
    applicationIds.length > 0
      ? await Promise.all([
          readLatestResumeArtifacts({
            applicationIds,
          }),
          readLatestCoverLetterArtifacts({
            applicationIds,
          }),
          readApplicationStatusEvents({
            applicationIds,
          }),
        ])
      : [
          new Map<
            string,
            { hasDocx: boolean; hasPdf: boolean; headline: string | null; status: string }
          >(),
          new Map<
            string,
            { excerpt: string | null; hasDocx: boolean; hasPdf: boolean; status: string }
          >(),
          new Map<string, ApplicationOverview["recentApplications"][number]["statusEvents"]>(),
        ];

  const recentApplications = (data ?? []).map((application) => ({
    id: application.id,
    companyName: application.company_name,
    jobTitle: application.job_title,
    jobUrl: application.job_url,
    latestCoverLetterExcerpt: coverLetterArtifacts.get(application.id)?.excerpt ?? null,
    latestCoverLetterHasDocx: coverLetterArtifacts.get(application.id)?.hasDocx ?? false,
    latestCoverLetterHasPdf: coverLetterArtifacts.get(application.id)?.hasPdf ?? false,
    latestCoverLetterStatus: coverLetterArtifacts.get(application.id)?.status ?? null,
    latestResumeHasDocx: resumeArtifacts.get(application.id)?.hasDocx ?? false,
    latestResumeHasPdf: resumeArtifacts.get(application.id)?.hasPdf ?? false,
    latestResumeHeadline: resumeArtifacts.get(application.id)?.headline ?? null,
    latestResumeStatus: resumeArtifacts.get(application.id)?.status ?? null,
    statusEvents: statusEvents.get(application.id) ?? [],
    status: application.status,
    createdAt: application.created_at,
    updatedAt: application.updated_at,
  }));

  return {
    recentApplications: recentApplications.slice(0, 50),
    openFollowUpCount: recentApplications.filter((application) =>
      followUpStatuses.has(application.status),
    ).length,
    summary: summarizeApplications(recentApplications),
  };
}

async function readApplicationStatusEvents({ applicationIds }: { applicationIds: string[] }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("application_status_events")
    .select("application_id, previous_status, new_status, source, created_at")
    .in("application_id", applicationIds)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("APPLICATION_STATUS_EVENTS_READ_FAILED");
  }

  return (data ?? []).reduce<
    Map<string, ApplicationOverview["recentApplications"][number]["statusEvents"]>
  >((events, event) => {
    const applicationEvents = events.get(event.application_id) ?? [];
    if (applicationEvents.length < 4) {
      applicationEvents.push({
        createdAt: event.created_at,
        newStatus: event.new_status,
        previousStatus: event.previous_status,
        source: event.source,
      });
      events.set(event.application_id, applicationEvents);
    }

    return events;
  }, new Map());
}

function summarizeApplications(applications: { status: string }[]) {
  const total = applications.length;
  const applied = applications.filter((application) =>
    appliedStatuses.has(application.status),
  ).length;
  const interviewing = applications.filter((application) =>
    interviewingStatuses.has(application.status),
  ).length;
  const selected = applications.filter(
    (application) => application.status === "interviewed_selected",
  ).length;
  const rejected = applications.filter((application) =>
    rejectedStatuses.has(application.status),
  ).length;
  const noReply = applications.filter((application) => application.status === "no_reply").length;
  const withdrawn = applications.filter((application) => application.status === "withdrawn").length;
  const needsReview = applications.filter((application) => application.status === "draft").length;

  return {
    total,
    applied,
    interviewing,
    noReply,
    selected,
    rejected,
    withdrawn,
    needsReview,
    byStatus: [
      { label: "Draft", status: "draft", value: needsReview },
      { label: "Applied", status: "applied", value: applications.filter((item) => item.status === "applied").length },
      { label: "No reply", status: "no_reply", value: noReply },
      {
        label: "Interviewing",
        status: "interview_in_progress",
        value: applications.filter((item) => item.status === "interview_in_progress").length,
      },
      { label: "Rejected", status: "rejected", value: applications.filter((item) => item.status === "rejected").length },
      { label: "Selected", status: "interviewed_selected", value: selected },
      { label: "Withdrawn", status: "withdrawn", value: withdrawn },
    ],
    byStage: [
      { label: "Review", value: needsReview },
      { label: "Applied", value: applied },
      { label: "Interview", value: interviewing },
      { label: "Selected", value: selected },
      { label: "Closed", value: rejected },
    ],
  };
}

async function readLatestResumeArtifacts({ applicationIds }: { applicationIds: string[] }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("generated_resumes")
    .select("application_id, status, content_json, pdf_storage_path, docx_storage_path, created_at")
    .in("application_id", applicationIds)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("APPLICATION_ARTIFACTS_READ_FAILED");
  }

  return (data ?? []).reduce<
    Map<string, { hasDocx: boolean; hasPdf: boolean; headline: string | null; status: string }>
  >((artifacts, artifact) => {
    if (!artifact.application_id || artifacts.has(artifact.application_id)) {
      return artifacts;
    }

    artifacts.set(artifact.application_id, {
      hasDocx: Boolean(artifact.docx_storage_path),
      hasPdf: Boolean(artifact.pdf_storage_path),
      headline: readResumeHeadline(artifact.content_json),
      status: artifact.status,
    });
    return artifacts;
  }, new Map());
}

async function readLatestCoverLetterArtifacts({ applicationIds }: { applicationIds: string[] }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("generated_cover_letters")
    .select("application_id, status, content, pdf_storage_path, docx_storage_path, created_at")
    .in("application_id", applicationIds)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("APPLICATION_ARTIFACTS_READ_FAILED");
  }

  return (data ?? []).reduce<
    Map<string, { excerpt: string | null; hasDocx: boolean; hasPdf: boolean; status: string }>
  >((artifacts, artifact) => {
    if (!artifact.application_id || artifacts.has(artifact.application_id)) {
      return artifacts;
    }

    artifacts.set(artifact.application_id, {
      excerpt: artifact.content ? `${artifact.content.slice(0, 180)}...` : null,
      hasDocx: Boolean(artifact.docx_storage_path),
      hasPdf: Boolean(artifact.pdf_storage_path),
      status: artifact.status,
    });
    return artifacts;
  }, new Map());
}

function readResumeHeadline(contentJson: unknown) {
  if (!contentJson || typeof contentJson !== "object" || !("headline" in contentJson)) {
    return null;
  }

  const headline = contentJson.headline;
  return typeof headline === "string" ? headline : null;
}
