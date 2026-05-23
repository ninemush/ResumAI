import "server-only";

import { createClient } from "@/lib/supabase/server";

export type ApplicationOverview = {
  recentApplications: {
    id: string;
    companyName: string;
    jobTitle: string | null;
    jobUrl: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }[];
  openFollowUpCount: number;
};

const followUpStatuses = new Set(["applied", "interview_in_progress"]);

export async function getApplicationOverview(userId: string): Promise<ApplicationOverview> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .select("id, company_name, job_title, job_url, status, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(5);

  if (error) {
    throw new Error("APPLICATION_OVERVIEW_READ_FAILED");
  }

  const recentApplications = (data ?? []).map((application) => ({
    id: application.id,
    companyName: application.company_name,
    jobTitle: application.job_title,
    jobUrl: application.job_url,
    status: application.status,
    createdAt: application.created_at,
    updatedAt: application.updated_at,
  }));

  return {
    recentApplications,
    openFollowUpCount: recentApplications.filter((application) =>
      followUpStatuses.has(application.status),
    ).length,
  };
}
