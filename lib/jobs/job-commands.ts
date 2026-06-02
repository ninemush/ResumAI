import "server-only";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export const updateJobReviewStatusSchema = z.object({
  jobId: z.string().uuid(),
  reviewStatus: z.enum(["needs_review", "accepted", "rejected"]),
});

export const updateJobArchiveStateSchema = z.object({
  archived: z.boolean(),
  jobId: z.string().uuid(),
});

export async function updateJobReviewStatus(
  input: z.input<typeof updateJobReviewStatusSchema>,
) {
  const parsed = updateJobReviewStatusSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { data, error } = await supabase
    .from("job_ingestions")
    .update({ review_status: parsed.reviewStatus })
    .eq("id", parsed.jobId)
    .eq("user_id", user.id)
    .select("id, review_status")
    .single();

  if (error || !data) {
    throw new Error("JOB_NOT_FOUND");
  }

  return {
    job: {
      id: data.id,
      reviewStatus: data.review_status,
    },
  };
}

export async function updateJobArchiveState(
  input: z.input<typeof updateJobArchiveStateSchema>,
) {
  const parsed = updateJobArchiveStateSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { data, error } = await supabase
    .from("job_ingestions")
    .update({ archived_at: parsed.archived ? new Date().toISOString() : null })
    .eq("id", parsed.jobId)
    .eq("user_id", user.id)
    .select("id, archived_at")
    .single();

  if (error || !data) {
    throw new Error("JOB_NOT_FOUND");
  }

  return {
    job: {
      archivedAt: data.archived_at,
      id: data.id,
    },
  };
}
