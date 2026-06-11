import "server-only";

import {
  canonicalCareerProfileSchema,
  type CanonicalCareerProfile,
} from "@/lib/profile/career-profile-schema";
import { createClient } from "@/lib/supabase/server";

export type CareerProfileOverview = {
  careerProfile: CanonicalCareerProfile | null;
  id: string | null;
  lastSourceAnalysisId: string | null;
  openQuestionCount: number;
  schemaVersion: string | null;
  status: string | null;
  updatedAt: string | null;
  versionNumber: number | null;
};

export async function getCareerProfileOverview(userId: string): Promise<CareerProfileOverview> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("career_profiles")
    .select("id, schema_version, version_number, content_json, status, last_source_analysis_id, updated_at")
    .eq("user_id", userId)
    .eq("is_current", true)
    .neq("status", "deleted")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("CAREER_PROFILE_READ_FAILED");
  }

  if (!data) {
    return {
      careerProfile: null,
      id: null,
      lastSourceAnalysisId: null,
      openQuestionCount: 0,
      schemaVersion: null,
      status: null,
      updatedAt: null,
      versionNumber: null,
    };
  }

  const careerProfile = canonicalCareerProfileSchema.parse(data.content_json);

  return {
    careerProfile,
    id: data.id,
    lastSourceAnalysisId: data.last_source_analysis_id,
    openQuestionCount: careerProfile.openQuestions.length,
    schemaVersion: data.schema_version,
    status: data.status,
    updatedAt: data.updated_at,
    versionNumber: data.version_number,
  };
}
