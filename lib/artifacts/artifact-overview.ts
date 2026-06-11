import "server-only";

import { createClient } from "@/lib/supabase/server";

export type ArtifactOverview = {
  artifacts: {
    applicationId: string | null;
    companyName: string | null;
    createdAt: string;
    docxDownloadUrl: string | null;
    id: string;
    kind: "cover_letter" | "resume";
    label: string;
    pdfDownloadUrl: string | null;
    roleTitle: string | null;
    status: string;
    updatedAt: string;
    version: number;
  }[];
  summary: {
    coverLetters: number;
    exportedDocx: number;
    exportedPdfs: number;
    resumes: number;
    total: number;
  };
};

export async function getArtifactOverview(userId: string): Promise<ArtifactOverview> {
  const supabase = await createClient();
  const [{ data: resumes, error: resumeError }, { data: coverLetters, error: coverError }] =
    await Promise.all([
      supabase
        .from("generated_resumes")
        .select("id, application_id, resume_type, content_json, pdf_storage_path, docx_storage_path, status, version_number, created_at, updated_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("generated_cover_letters")
        .select("id, application_id, content, pdf_storage_path, docx_storage_path, status, version_number, created_at, updated_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

  if (resumeError || coverError) {
    throw new Error("ARTIFACT_OVERVIEW_READ_FAILED");
  }

  const applicationIds = Array.from(
    new Set(
      [...(resumes ?? []), ...(coverLetters ?? [])]
        .map((artifact) => artifact.application_id)
        .filter(Boolean),
    ),
  ) as string[];
  const applications = await readApplications(applicationIds, userId);
  const resumeVersions = buildVersionMap(resumes ?? []);
  const coverLetterVersions = buildVersionMap(coverLetters ?? []);

  const artifacts: ArtifactOverview["artifacts"] = [
    ...(resumes ?? []).map((resume) => {
      const application = resume.application_id
        ? applications.get(resume.application_id)
        : null;
      const version = readArtifactVersion(resume, resumeVersions.get(resume.id));

      return {
        applicationId: resume.application_id,
        companyName: application?.companyName ?? null,
        createdAt: resume.created_at,
        docxDownloadUrl: buildArtifactDownloadUrl({
          format: "docx",
          hasFile: Boolean(resume.docx_storage_path),
          id: resume.id,
          kind: "resume",
        }),
        id: resume.id,
        kind: "resume" as const,
        label: readResumeLabel(resume.content_json, resume.resume_type),
        pdfDownloadUrl: buildArtifactDownloadUrl({
          format: "pdf",
          hasFile: Boolean(resume.pdf_storage_path),
          id: resume.id,
          kind: "resume",
        }),
        roleTitle: application?.jobTitle ?? null,
        status: resume.status,
        updatedAt: resume.updated_at,
        version,
      };
    }),
    ...(coverLetters ?? []).map((coverLetter) => {
      const application = coverLetter.application_id
        ? applications.get(coverLetter.application_id)
        : null;
      const version = readArtifactVersion(coverLetter, coverLetterVersions.get(coverLetter.id));

      return {
        applicationId: coverLetter.application_id,
        companyName: application?.companyName ?? null,
        createdAt: coverLetter.created_at,
        docxDownloadUrl: buildArtifactDownloadUrl({
          format: "docx",
          hasFile: Boolean(coverLetter.docx_storage_path),
          id: coverLetter.id,
          kind: "cover-letter",
        }),
        id: coverLetter.id,
        kind: "cover_letter" as const,
        label: "Cover letter",
        pdfDownloadUrl: buildArtifactDownloadUrl({
          format: "pdf",
          hasFile: Boolean(coverLetter.pdf_storage_path),
          id: coverLetter.id,
          kind: "cover-letter",
        }),
        roleTitle: application?.jobTitle ?? null,
        status: coverLetter.status,
        updatedAt: coverLetter.updated_at,
        version,
      };
    }),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return {
    artifacts,
    summary: {
      coverLetters: artifacts.filter((artifact) => artifact.kind === "cover_letter").length,
      exportedDocx: artifacts.filter((artifact) => artifact.docxDownloadUrl).length,
      exportedPdfs: artifacts.filter((artifact) => artifact.pdfDownloadUrl).length,
      resumes: artifacts.filter((artifact) => artifact.kind === "resume").length,
      total: artifacts.length,
    },
  };
}

async function readApplications(applicationIds: string[], userId: string) {
  if (applicationIds.length === 0) {
    return new Map<string, { companyName: string; jobTitle: string | null }>();
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .select("id, company_name, job_title")
    .eq("user_id", userId)
    .in("id", applicationIds);

  if (error) {
    throw new Error("ARTIFACT_APPLICATIONS_READ_FAILED");
  }

  return (data ?? []).reduce<Map<string, { companyName: string; jobTitle: string | null }>>(
    (applications, application) => {
      applications.set(application.id, {
        companyName: application.company_name,
        jobTitle: application.job_title,
      });
      return applications;
    },
    new Map(),
  );
}

function buildVersionMap(artifacts: { application_id: string | null; created_at: string; id: string }[]) {
  const grouped = artifacts.reduce<Map<string, typeof artifacts>>((groups, artifact) => {
    const key = artifact.application_id ?? "master";
    groups.set(key, [...(groups.get(key) ?? []), artifact]);
    return groups;
  }, new Map());
  const versions = new Map<string, number>();

  for (const group of grouped.values()) {
    [...group]
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      .forEach((artifact, index) => versions.set(artifact.id, index + 1));
  }

  return versions;
}

function buildArtifactDownloadUrl({
  format,
  hasFile,
  id,
  kind,
}: {
  format: "docx" | "pdf";
  hasFile: boolean;
  id: string;
  kind: "cover-letter" | "resume";
}) {
  return hasFile ? `/api/artifacts/${kind}/${id}/download?format=${format}` : null;
}

function readArtifactVersion(artifact: { version_number?: number | null }, fallback?: number) {
  return artifact.version_number && artifact.version_number > 0 ? artifact.version_number : fallback ?? 1;
}

function readResumeLabel(contentJson: unknown, resumeType: string) {
  if (contentJson && typeof contentJson === "object" && "headline" in contentJson) {
    const headline = contentJson.headline;

    if (typeof headline === "string" && headline.trim()) {
      return headline.trim();
    }
  }

  if (resumeType === "master") return "Master resume";
  if (resumeType === "cover_letter") return "Cover letter";

  return "Targeted resume";
}
