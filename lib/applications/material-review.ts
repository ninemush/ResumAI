import "server-only";

import { z } from "zod";

import {
  buildAtsResumeDocx,
  buildAtsResumePdf,
  buildCoverLetterDocx,
  buildCoverLetterPdf,
} from "@/lib/artifacts/ats-template";
import { validateGeneratedPdf } from "@/lib/applications/pdf-validation";
import {
  parseResumeContent,
  resumeContentSchema,
  type ResumeContent,
} from "@/lib/resumes/resume-content";
import { createClient } from "@/lib/supabase/server";

const GENERATED_ARTIFACT_BUCKET = "generated-artifacts";
const PDF_SIGNED_URL_TTL_SECONDS = 10 * 60;

export const materialReviewSchema = z.object({
  applicationId: z.string().uuid(),
});

export const updateMaterialReviewSchema = materialReviewSchema.extend({
  coverLetter: z.string().trim().min(20).max(8000).optional(),
  resume: resumeContentSchema.optional(),
});

export type MaterialReview = {
  application: {
    companyName: string;
    id: string;
    jobTitle: string | null;
    jobUrl: string;
    status: string;
  };
  coverLetter: {
    content: string;
    docxDownloadUrl: string | null;
    id: string;
    pdfDownloadUrl: string | null;
    status: string;
    updatedAt: string;
  } | null;
  exportReadiness: {
    canExport: boolean;
    status: "missing_materials" | "ready_to_export" | "exported";
    warnings: string[];
  };
  resume: {
    content: ResumeContent;
    docxDownloadUrl: string | null;
    id: string;
    pdfDownloadUrl: string | null;
    status: string;
    updatedAt: string;
  } | null;
};

export type MaterialArtifactExportResult = {
  didExport: boolean;
  review: MaterialReview;
};

export async function getMaterialReview(
  input: z.input<typeof materialReviewSchema>,
): Promise<MaterialReview> {
  const parsed = materialReviewSchema.parse(input);
  const { supabase, userId } = await getAuthenticatedContext();
  const application = await readApplication(parsed.applicationId, userId);
  const [resume, coverLetter] = await Promise.all([
    readLatestResume(parsed.applicationId, userId),
    readLatestCoverLetter(parsed.applicationId, userId),
  ]);

  return {
    application,
    coverLetter: coverLetter
      ? {
          content: coverLetter.content,
          docxDownloadUrl: await createSignedUrl(coverLetter.docx_storage_path),
          id: coverLetter.id,
          pdfDownloadUrl: await createSignedUrl(coverLetter.pdf_storage_path),
          status: coverLetter.status,
          updatedAt: coverLetter.updated_at,
        }
      : null,
    exportReadiness: buildExportReadiness({
      coverLetter,
      resume,
    }),
    resume: resume
      ? {
          content: parseResumeContent(resume.content_json),
          docxDownloadUrl: await createSignedUrl(resume.docx_storage_path),
          id: resume.id,
          pdfDownloadUrl: await createSignedUrl(resume.pdf_storage_path),
          status: resume.status,
          updatedAt: resume.updated_at,
        }
      : null,
  };

  async function createSignedUrl(path: string | null) {
    if (!path) {
      return null;
    }

    const { data, error } = await supabase.storage
      .from(GENERATED_ARTIFACT_BUCKET)
      .createSignedUrl(path, PDF_SIGNED_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
      return null;
    }

    return data.signedUrl;
  }
}

export async function updateMaterialReview(input: z.input<typeof updateMaterialReviewSchema>) {
  const parsed = updateMaterialReviewSchema.parse(input);
  const { supabase, userId } = await getAuthenticatedContext();
  await readApplication(parsed.applicationId, userId);

  if (!parsed.resume && !parsed.coverLetter) {
    throw new Error("MATERIAL_UPDATE_REQUIRED");
  }

  const [resume, coverLetter] = await Promise.all([
    parsed.resume ? readLatestResume(parsed.applicationId, userId) : Promise.resolve(null),
    parsed.coverLetter ? readLatestCoverLetter(parsed.applicationId, userId) : Promise.resolve(null),
  ]);

  if (parsed.resume && !resume) {
    throw new Error("RESUME_NOT_FOUND");
  }

  if (parsed.coverLetter && !coverLetter) {
    throw new Error("COVER_LETTER_NOT_FOUND");
  }

  await Promise.all([
    parsed.resume && resume
      ? supabase
          .from("generated_resumes")
          .update({
            content_json: parsed.resume,
            docx_storage_path: null,
            pdf_storage_path: null,
            status: "ready",
          })
          .eq("id", resume.id)
          .eq("user_id", userId)
      : Promise.resolve({ error: null }),
    parsed.coverLetter && coverLetter
      ? supabase
          .from("generated_cover_letters")
          .update({
            content: parsed.coverLetter,
            docx_storage_path: null,
            pdf_storage_path: null,
            status: "ready",
          })
          .eq("id", coverLetter.id)
          .eq("user_id", userId)
      : Promise.resolve({ error: null }),
  ]).then((results) => {
    if (results.some((result) => result.error)) {
      throw new Error("MATERIAL_UPDATE_FAILED");
    }
  });

  return getMaterialReview({ applicationId: parsed.applicationId });
}

export async function getReusableMaterialExport(
  input: z.input<typeof materialReviewSchema>,
): Promise<MaterialReview | null> {
  const review = await getMaterialReview(input);

  return review.exportReadiness.status === "exported" ? review : null;
}

export async function exportMaterialArtifacts(
  input: z.input<typeof materialReviewSchema>,
): Promise<MaterialArtifactExportResult> {
  const parsed = materialReviewSchema.parse(input);
  const { supabase, userId } = await getAuthenticatedContext();
  const application = await readApplication(parsed.applicationId, userId);
  const [resume, coverLetter] = await Promise.all([
    readLatestResume(parsed.applicationId, userId),
    readLatestCoverLetter(parsed.applicationId, userId),
  ]);

  if (!resume || !coverLetter) {
    throw new Error("MATERIALS_NOT_FOUND");
  }

  if (isMaterialExportReady({ coverLetter, resume })) {
    return {
      didExport: false,
      review: await getMaterialReview({ applicationId: parsed.applicationId }),
    };
  }

  const resumeContent = parseResumeContent(resume.content_json);
  const contextLine = `${application.companyName}${application.jobTitle ? ` | ${application.jobTitle}` : ""}`;
  const [resumePdf, resumeDocx, coverLetterPdf, coverLetterDocx] = await Promise.all([
    buildAtsResumePdf({ contextLine, resume: resumeContent }),
    buildAtsResumeDocx({ contextLine, resume: resumeContent }),
    buildCoverLetterPdf({ contextLine, coverLetter: coverLetter.content }),
    buildCoverLetterDocx({ contextLine, coverLetter: coverLetter.content }),
  ]);
  const [resumeValidation, coverLetterValidation] = await Promise.all([
    validateGeneratedPdf({
      bytes: resumePdf,
      requiredPhrases: [resumeContent.headline, resumeContent.summary],
    }),
    validateGeneratedPdf({
      bytes: coverLetterPdf,
      requiredPhrases: [application.companyName, coverLetter.content.slice(0, 80)],
    }),
  ]);

  if (!resumeValidation.valid || !coverLetterValidation.valid) {
    throw new Error("PDF_VALIDATION_FAILED");
  }

  const resumePath = `${userId}/${application.id}/${resume.id}-resume.pdf`;
  const resumeDocxPath = `${userId}/${application.id}/${resume.id}-resume.docx`;
  const coverLetterPath = `${userId}/${application.id}/${coverLetter.id}-cover-letter.pdf`;
  const coverLetterDocxPath = `${userId}/${application.id}/${coverLetter.id}-cover-letter.docx`;

  await Promise.all([
    uploadArtifact(resumePath, resumePdf, "application/pdf"),
    uploadArtifact(
      resumeDocxPath,
      resumeDocx,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    uploadArtifact(coverLetterPath, coverLetterPdf, "application/pdf"),
    uploadArtifact(
      coverLetterDocxPath,
      coverLetterDocx,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
  ]);

  const [{ error: resumeError }, { error: coverLetterError }] = await Promise.all([
    supabase
      .from("generated_resumes")
      .update({ docx_storage_path: resumeDocxPath, pdf_storage_path: resumePath, status: "ready" })
      .eq("id", resume.id)
      .eq("user_id", userId),
    supabase
      .from("generated_cover_letters")
      .update({
        docx_storage_path: coverLetterDocxPath,
        pdf_storage_path: coverLetterPath,
        status: "ready",
      })
      .eq("id", coverLetter.id)
      .eq("user_id", userId),
  ]);

  if (resumeError || coverLetterError) {
    throw new Error("ARTIFACT_METADATA_UPDATE_FAILED");
  }

  return {
    didExport: true,
    review: await getMaterialReview({ applicationId: parsed.applicationId }),
  };

  async function uploadArtifact(path: string, bytes: Uint8Array, contentType: string) {
    const { error } = await supabase.storage.from(GENERATED_ARTIFACT_BUCKET).upload(path, bytes, {
      contentType,
      upsert: true,
    });

    if (error) {
      throw new Error("ARTIFACT_UPLOAD_FAILED");
    }
  }
}

function isMaterialExportReady({
  coverLetter,
  resume,
}: {
  coverLetter: Awaited<ReturnType<typeof readLatestCoverLetter>>;
  resume: Awaited<ReturnType<typeof readLatestResume>>;
}) {
  return Boolean(
    resume?.status === "ready" &&
      coverLetter?.status === "ready" &&
      resume.pdf_storage_path &&
      resume.docx_storage_path &&
      coverLetter.pdf_storage_path &&
      coverLetter.docx_storage_path,
  );
}

function buildExportReadiness({
  coverLetter,
  resume,
}: {
  coverLetter: Awaited<ReturnType<typeof readLatestCoverLetter>>;
  resume: Awaited<ReturnType<typeof readLatestResume>>;
}): MaterialReview["exportReadiness"] {
  const warnings: string[] = [];

  if (!resume || !coverLetter) {
    return {
      canExport: false,
      status: "missing_materials",
      warnings: ["Create both resume and cover-letter drafts before downloading files."],
    };
  }

  const resumeContent = parseResumeContent(resume.content_json);

  if (resumeContent.keywordGaps.length > 0) {
    warnings.push("Review keyword gaps before submitting these materials.");
  }

  if (resumeContent.reviewerNotes.length > 0) {
    warnings.push("Reviewer notes include fit or evidence items to verify.");
  }

  if (!resume.pdf_storage_path || !coverLetter.pdf_storage_path) {
    warnings.push("PDFs need export after the latest edits.");
  }

  if (!resume.docx_storage_path || !coverLetter.docx_storage_path) {
    warnings.push("DOCX files need export after the latest edits.");
  }

  return {
    canExport: true,
    status:
      resume.pdf_storage_path &&
      coverLetter.pdf_storage_path &&
      resume.docx_storage_path &&
      coverLetter.docx_storage_path
        ? "exported"
        : "ready_to_export",
    warnings,
  };
}

async function getAuthenticatedContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  return {
    supabase,
    userId: user.id,
  };
}

async function readApplication(applicationId: string, userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .select("id, company_name, job_title, job_url, status")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    throw new Error("APPLICATION_NOT_FOUND");
  }

  return {
    companyName: data.company_name,
    id: data.id,
    jobTitle: data.job_title,
    jobUrl: data.job_url,
    status: data.status,
  };
}

async function readLatestResume(applicationId: string, userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("generated_resumes")
    .select("id, content_json, pdf_storage_path, docx_storage_path, status, updated_at")
    .eq("application_id", applicationId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("RESUME_READ_FAILED");
  }

  return data;
}

async function readLatestCoverLetter(applicationId: string, userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("generated_cover_letters")
    .select("id, content, pdf_storage_path, docx_storage_path, status, updated_at")
    .eq("application_id", applicationId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("COVER_LETTER_READ_FAILED");
  }

  return data;
}
