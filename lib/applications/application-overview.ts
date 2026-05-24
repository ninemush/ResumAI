import "server-only";

import { createClient } from "@/lib/supabase/server";

export type ApplicationOverview = {
  recentApplications: {
    id: string;
    companyName: string;
    jobTitle: string | null;
    jobUrl: string;
    latestCoverLetterExcerpt: string | null;
    latestCoverLetterStatus: string | null;
    latestResumeHeadline: string | null;
    latestResumeStatus: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
  }[];
  openFollowUpCount: number;
  summary: {
    total: number;
    applied: number;
    interviewing: number;
    selected: number;
    rejected: number;
    needsReview: number;
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
  const [resumeArtifacts, coverLetterArtifacts] =
    applicationIds.length > 0
      ? await Promise.all([
          readLatestResumeArtifacts({
            applicationIds,
          }),
          readLatestCoverLetterArtifacts({
            applicationIds,
          }),
        ])
      : [
          new Map<string, { headline: string | null; status: string }>(),
          new Map<string, { excerpt: string | null; status: string }>(),
        ];

  const recentApplications = (data ?? []).map((application) => ({
    id: application.id,
    companyName: application.company_name,
    jobTitle: application.job_title,
    jobUrl: application.job_url,
    latestCoverLetterExcerpt: coverLetterArtifacts.get(application.id)?.excerpt ?? null,
    latestCoverLetterStatus: coverLetterArtifacts.get(application.id)?.status ?? null,
    latestResumeHeadline: resumeArtifacts.get(application.id)?.headline ?? null,
    latestResumeStatus: resumeArtifacts.get(application.id)?.status ?? null,
    status: application.status,
    createdAt: application.created_at,
    updatedAt: application.updated_at,
  }));

  return {
    recentApplications: recentApplications.slice(0, 5),
    openFollowUpCount: recentApplications.filter((application) =>
      followUpStatuses.has(application.status),
    ).length,
    summary: summarizeApplications(recentApplications),
  };
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
  const needsReview = applications.filter((application) => application.status === "draft").length;

  return {
    total,
    applied,
    interviewing,
    selected,
    rejected,
    needsReview,
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
    .select("application_id, status, content_json, created_at")
    .in("application_id", applicationIds)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("APPLICATION_ARTIFACTS_READ_FAILED");
  }

  return (data ?? []).reduce<Map<string, { headline: string | null; status: string }>>((artifacts, artifact) => {
    if (!artifact.application_id || artifacts.has(artifact.application_id)) {
      return artifacts;
    }

    artifacts.set(artifact.application_id, {
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
    .select("application_id, status, content, created_at")
    .in("application_id", applicationIds)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("APPLICATION_ARTIFACTS_READ_FAILED");
  }

  return (data ?? []).reduce<Map<string, { excerpt: string | null; status: string }>>((artifacts, artifact) => {
    if (!artifact.application_id || artifacts.has(artifact.application_id)) {
      return artifacts;
    }

    artifacts.set(artifact.application_id, {
      excerpt: artifact.content ? `${artifact.content.slice(0, 180)}...` : null,
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
