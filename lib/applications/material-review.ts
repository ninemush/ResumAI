import "server-only";

import { z } from "zod";

import {
  buildAtsResumeDocx,
  buildAtsResumePdf,
  buildCoverLetterDocx,
  buildCoverLetterPdf,
} from "@/lib/artifacts/ats-template";
import {
  buildSupportedEvidenceCorpus,
  reviewCoverLetterClaimProvenance,
  type CoverLetterClaimRisk,
} from "@/lib/ai/claim-provenance";
import {
  ClaimReviewRequiredError,
  classifyResumeExportRisks,
  getBlockingExportRisks,
  type ExportRisk,
} from "@/lib/applications/export-gates";
import {
  validateGeneratedDocx,
  validateGeneratedPdf,
} from "@/lib/applications/pdf-validation";
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
    displayName: string | null;
    id: string;
    jobTitle: string | null;
    jobUrl: string;
    status: string;
  };
  coverLetter: {
    claimRisks: CoverLetterClaimRisk[];
    content: string;
    docxDownloadUrl: string | null;
    id: string;
    pdfDownloadUrl: string | null;
    reviewerNotes: string[];
    status: string;
    updatedAt: string;
  } | null;
  exportReadiness: {
    blockingRisks: ExportRisk[];
    canExport: boolean;
    claimReviewAcknowledged: boolean;
    requiresClaimReview: boolean;
    status: "missing_materials" | "ready_to_export" | "export_pending" | "export_failed" | "exported";
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

type ExportStatus = "not_exported" | "export_pending" | "export_validated" | "export_failed";

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
          claimRisks: normalizeCoverLetterClaimRisks(coverLetter.claim_risks),
          docxDownloadUrl: await createSignedUrl(coverLetter.docx_storage_path),
          id: coverLetter.id,
          pdfDownloadUrl: await createSignedUrl(coverLetter.pdf_storage_path),
          reviewerNotes: normalizeTextArray(coverLetter.reviewer_notes),
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

  const coverLetterReview = parsed.coverLetter
    ? reviewCoverLetterClaimProvenance({
        coverLetter: parsed.coverLetter,
        evidenceCorpus: await readApplicationEvidenceCorpus(parsed.applicationId, userId),
      })
    : null;

  await Promise.all([
    parsed.resume && resume
      ? supabase
          .from("generated_resumes")
          .update({
            claim_review_acknowledged_at: null,
            claim_review_acknowledged_by: null,
            claim_review_acknowledgement: {},
            content_json: parsed.resume,
            docx_storage_path: null,
            export_failed_reason: null,
            export_status: "not_exported",
            export_validation: {},
            export_validated_at: null,
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
            claim_risks: coverLetterReview?.claimRisks ?? [],
            claim_review_acknowledged_at: null,
            claim_review_acknowledged_by: null,
            claim_review_acknowledgement: {},
            content: parsed.coverLetter,
            docx_storage_path: null,
            export_failed_reason: null,
            export_status: "not_exported",
            export_validation: {},
            export_validated_at: null,
            pdf_storage_path: null,
            reviewer_notes: coverLetterReview?.reviewerNotes ?? [],
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
  options: { acknowledgeClaimReview?: boolean } = {},
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
  const coverLetterReview = reviewCoverLetterClaimProvenance({
    coverLetter: coverLetter.content,
    evidenceCorpus: await readApplicationEvidenceCorpus(parsed.applicationId, userId),
  });
  const resumeRisks = getBlockingExportRisks(resumeContent);
  const coverLetterRisks = coverLetterReview.claimRisks.map(mapCoverLetterRiskToExportRisk);
  const blockingRisks = [...resumeRisks, ...coverLetterRisks];

  await persistCoverLetterClaimReview({
    coverLetterId: coverLetter.id,
    review: coverLetterReview,
    supabase,
    userId,
  });

  if (blockingRisks.length > 0 && !hasMaterialClaimReviewAcknowledgement({ coverLetter, resume })) {
    if (!options.acknowledgeClaimReview) {
      throw new ClaimReviewRequiredError("MATERIAL_CLAIM_ACK_REQUIRED", blockingRisks);
    }

    await acknowledgeMaterialClaimReview({
      applicationId: parsed.applicationId,
      coverLetterId: coverLetter.id,
      resumeId: resume.id,
      risks: blockingRisks,
      supabase,
      userId,
    });
  }

  await markMaterialExportStatus({
    coverLetterId: coverLetter.id,
    resumeId: resume.id,
    status: "export_pending",
    supabase,
    userId,
  });

  const contextLine = formatApplicationContextLine(application);
  const [resumePdf, resumeDocx, coverLetterPdf, coverLetterDocx] = await Promise.all([
    buildAtsResumePdf({ contextLine, displayName: application.displayName, resume: resumeContent }),
    buildAtsResumeDocx({ contextLine, displayName: application.displayName, resume: resumeContent }),
    buildCoverLetterPdf({ contextLine, coverLetter: coverLetter.content }),
    buildCoverLetterDocx({ contextLine, coverLetter: coverLetter.content }),
  ]);
  const [resumePdfValidation, resumeDocxValidation, coverLetterPdfValidation, coverLetterDocxValidation] = await Promise.all([
    validateGeneratedPdf({
      bytes: resumePdf,
      maxPages: 4,
      requiredPhrases: [resumeContent.headline, resumeContent.summary],
      requiredSections: ["Skills", "Experience"],
    }),
    validateGeneratedDocx({
      bytes: resumeDocx,
      requiredPhrases: [resumeContent.headline, resumeContent.summary],
    }),
    validateGeneratedPdf({
      bytes: coverLetterPdf,
      maxPages: 2,
      requiredPhrases: [application.companyName, coverLetter.content.slice(0, 80)],
    }),
    validateGeneratedDocx({
      bytes: coverLetterDocx,
      requiredPhrases: [application.companyName, coverLetter.content.slice(0, 80)],
    }),
  ]);

  if (
    !resumePdfValidation.valid ||
    !resumeDocxValidation.valid ||
    !coverLetterPdfValidation.valid ||
    !coverLetterDocxValidation.valid
  ) {
    await markMaterialExportStatus({
      coverLetterId: coverLetter.id,
      reason: "ARTIFACT_VALIDATION_FAILED",
      resumeId: resume.id,
      status: "export_failed",
      supabase,
      userId,
      validation: {
        coverLetterDocx: coverLetterDocxValidation,
        coverLetterPdf: coverLetterPdfValidation,
        resumeDocx: resumeDocxValidation,
        resumePdf: resumePdfValidation,
      },
    });
    throw new Error("ARTIFACT_VALIDATION_FAILED");
  }

  const resumePath = `${userId}/${application.id}/${resume.id}-resume.pdf`;
  const resumeDocxPath = `${userId}/${application.id}/${resume.id}-resume.docx`;
  const coverLetterPath = `${userId}/${application.id}/${coverLetter.id}-cover-letter.pdf`;
  const coverLetterDocxPath = `${userId}/${application.id}/${coverLetter.id}-cover-letter.docx`;
  const uploadedPaths: string[] = [];

  try {
    await uploadArtifact(resumePath, resumePdf, "application/pdf");
    await uploadArtifact(
      resumeDocxPath,
      resumeDocx,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    await uploadArtifact(coverLetterPath, coverLetterPdf, "application/pdf");
    await uploadArtifact(
      coverLetterDocxPath,
      coverLetterDocx,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    const now = new Date().toISOString();
    const [{ error: resumeError }, { error: coverLetterError }] = await Promise.all([
      supabase
        .from("generated_resumes")
        .update({
          docx_storage_path: resumeDocxPath,
          export_failed_reason: null,
          export_status: "export_validated",
          export_validation: {
            docx: resumeDocxValidation,
            pdf: resumePdfValidation,
          },
          export_validated_at: now,
          pdf_storage_path: resumePath,
          status: "ready",
        })
        .eq("id", resume.id)
        .eq("user_id", userId),
      supabase
        .from("generated_cover_letters")
        .update({
          docx_storage_path: coverLetterDocxPath,
          export_failed_reason: null,
          export_status: "export_validated",
          export_validation: {
            docx: coverLetterDocxValidation,
            pdf: coverLetterPdfValidation,
          },
          export_validated_at: now,
          pdf_storage_path: coverLetterPath,
          status: "ready",
        })
        .eq("id", coverLetter.id)
        .eq("user_id", userId),
    ]);

    if (resumeError || coverLetterError) {
      throw new Error("ARTIFACT_METADATA_UPDATE_FAILED");
    }
  } catch (error) {
    if (uploadedPaths.length > 0) {
      await supabase.storage.from(GENERATED_ARTIFACT_BUCKET).remove(uploadedPaths).catch(() => undefined);
    }
    await markMaterialExportStatus({
      coverLetterId: coverLetter.id,
      reason: error instanceof Error ? error.message : "ARTIFACT_EXPORT_FAILED",
      resumeId: resume.id,
      status: "export_failed",
      supabase,
      userId,
    }).catch(() => undefined);
    throw error;
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

    uploadedPaths.push(path);
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
      readExportStatus(resume.export_status) === "export_validated" &&
      readExportStatus(coverLetter.export_status) === "export_validated" &&
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
      blockingRisks: [],
      canExport: false,
      claimReviewAcknowledged: false,
      requiresClaimReview: false,
      status: "missing_materials",
      warnings: ["Create both resume and cover-letter drafts before downloading files."],
    };
  }

  const resumeContent = parseResumeContent(resume.content_json);
  const risks = [
    ...classifyResumeExportRisks(resumeContent),
    ...normalizeCoverLetterClaimRisks(coverLetter.claim_risks).map(mapCoverLetterRiskToExportRisk),
  ];
  const blockingRisks = risks.filter((risk) => risk.severity === "high");
  const claimReviewAcknowledged = hasMaterialClaimReviewAcknowledgement({ coverLetter, resume });
  const resumeExportStatus = readExportStatus(resume.export_status);
  const coverLetterExportStatus = readExportStatus(coverLetter.export_status);

  if (resumeContent.keywordGaps.length > 0) {
    warnings.push("Review keyword gaps before submitting these materials.");
  }

  if (resumeContent.reviewerNotes.length > 0) {
    warnings.push("Reviewer notes include fit or evidence items to verify.");
  }

  if (normalizeTextArray(coverLetter.reviewer_notes).length > 0) {
    warnings.push("Cover-letter reviewer notes include evidence items to verify.");
  }

  if (!resume.pdf_storage_path || !coverLetter.pdf_storage_path) {
    warnings.push("PDFs need export after the latest edits.");
  }

  if (!resume.docx_storage_path || !coverLetter.docx_storage_path) {
    warnings.push("DOCX files need export after the latest edits.");
  }

  if (blockingRisks.length > 0 && !claimReviewAcknowledged) {
    warnings.push("High-impact claims or evidence gaps need your export-time acknowledgement.");
  }

  if (resumeExportStatus === "export_failed" || coverLetterExportStatus === "export_failed") {
    warnings.push("The last export attempt failed validation or secure storage. Review edits and prepare the files again.");
  }

  return {
    blockingRisks,
    canExport: blockingRisks.length === 0 || claimReviewAcknowledged,
    claimReviewAcknowledged,
    requiresClaimReview: blockingRisks.length > 0 && !claimReviewAcknowledged,
    status:
      resumeExportStatus === "export_failed" || coverLetterExportStatus === "export_failed"
        ? "export_failed"
        : resumeExportStatus === "export_pending" || coverLetterExportStatus === "export_pending"
          ? "export_pending"
          : resume.pdf_storage_path &&
      coverLetter.pdf_storage_path &&
      resume.docx_storage_path &&
      coverLetter.docx_storage_path &&
      resumeExportStatus === "export_validated" &&
      coverLetterExportStatus === "export_validated"
            ? "exported"
            : "ready_to_export",
    warnings,
  };
}

async function acknowledgeMaterialClaimReview({
  applicationId,
  coverLetterId,
  resumeId,
  risks,
  supabase,
  userId,
}: {
  applicationId: string;
  coverLetterId: string;
  resumeId: string;
  risks: ExportRisk[];
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}) {
  const acknowledgedAt = new Date().toISOString();
  const acknowledgement = {
    applicationId,
    risks,
    riskCount: risks.length,
  };
  const [{ error: resumeError }, { error: coverLetterError }] = await Promise.all([
    supabase
      .from("generated_resumes")
      .update({
        claim_review_acknowledged_at: acknowledgedAt,
        claim_review_acknowledged_by: userId,
        claim_review_acknowledgement: acknowledgement,
      })
      .eq("id", resumeId)
      .eq("user_id", userId),
    supabase
      .from("generated_cover_letters")
      .update({
        claim_review_acknowledged_at: acknowledgedAt,
        claim_review_acknowledged_by: userId,
        claim_review_acknowledgement: {
          ...acknowledgement,
          artifactType: "cover_letter",
          coverLetterId,
        },
      })
      .eq("id", coverLetterId)
      .eq("user_id", userId),
  ]);

  if (resumeError || coverLetterError) {
    throw new Error("MATERIAL_CLAIM_ACK_SAVE_FAILED");
  }
}

async function markMaterialExportStatus({
  coverLetterId,
  reason = null,
  resumeId,
  status,
  supabase,
  userId,
  validation = {},
}: {
  coverLetterId: string;
  reason?: string | null;
  resumeId: string;
  status: ExportStatus;
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  validation?: Record<string, unknown>;
}) {
  const updates = {
    export_failed_reason: status === "export_failed" ? reason : null,
    export_status: status,
    export_validation: validation,
    export_validated_at: status === "export_validated" ? new Date().toISOString() : null,
  };
  const [{ error: resumeError }, { error: coverLetterError }] = await Promise.all([
    supabase.from("generated_resumes").update(updates).eq("id", resumeId).eq("user_id", userId),
    supabase
      .from("generated_cover_letters")
      .update(updates)
      .eq("id", coverLetterId)
      .eq("user_id", userId),
  ]);

  if (resumeError || coverLetterError) {
    throw new Error("ARTIFACT_METADATA_UPDATE_FAILED");
  }
}

function readExportStatus(value: unknown): ExportStatus {
  return value === "export_pending" || value === "export_validated" || value === "export_failed"
    ? value
    : "not_exported";
}

function hasMaterialClaimReviewAcknowledgement({
  coverLetter,
  resume,
}: {
  coverLetter: Awaited<ReturnType<typeof readLatestCoverLetter>>;
  resume: Awaited<ReturnType<typeof readLatestResume>>;
}) {
  return Boolean(resume?.claim_review_acknowledged_at && coverLetter?.claim_review_acknowledged_at);
}

async function persistCoverLetterClaimReview({
  coverLetterId,
  review,
  supabase,
  userId,
}: {
  coverLetterId: string;
  review: ReturnType<typeof reviewCoverLetterClaimProvenance>;
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}) {
  const { error } = await supabase
    .from("generated_cover_letters")
    .update({
      claim_risks: review.claimRisks,
      reviewer_notes: review.reviewerNotes,
    })
    .eq("id", coverLetterId)
    .eq("user_id", userId);

  if (error) {
    throw new Error("COVER_LETTER_CLAIM_REVIEW_SAVE_FAILED");
  }
}

function mapCoverLetterRiskToExportRisk(risk: CoverLetterClaimRisk): ExportRisk {
  return {
    category: "cover_letter_claim",
    severity: "high",
    text: `Cover letter: ${risk.text}`,
  };
}

function normalizeCoverLetterClaimRisks(value: unknown): CoverLetterClaimRisk[] {
  const result = z.array(z.object({
    category: z.enum([
      "credential",
      "education",
      "employer",
      "location",
      "numeric_achievement",
      "salary",
      "seniority",
      "title",
      "work_eligibility",
    ]),
    severity: z.literal("high"),
    text: z.string(),
  })).safeParse(value);

  return result.success ? result.data : [];
}

function normalizeTextArray(value: unknown) {
  return z.array(z.string()).safeParse(value).success ? z.array(z.string()).parse(value) : [];
}

async function readApplicationEvidenceCorpus(applicationId: string, userId: string) {
  const supabase = await createClient();
  const { data: application, error: applicationError } = await supabase
    .from("applications")
    .select(
      "id, company_name, job_title, profile_id, job_ingestions(id, extracted_text, title, company)",
    )
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();

  if (applicationError || !application) {
    throw new Error("APPLICATION_NOT_FOUND");
  }

  const jobIngestion = Array.isArray(application.job_ingestions)
    ? application.job_ingestions[0] ?? null
    : application.job_ingestions;
  const [{ data: facts, error: factsError }, { data: masterResume, error: resumeError }] =
    await Promise.all([
      supabase
        .from("profile_facts")
        .select("fact_type, fact_value, evidence_status, user_confirmed")
        .eq("profile_id", application.profile_id)
        .eq("user_id", userId)
        .limit(100),
      supabase
        .from("generated_resumes")
        .select("content_json")
        .eq("profile_id", application.profile_id)
        .eq("user_id", userId)
        .eq("resume_type", "master")
        .is("application_id", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (factsError) {
    throw new Error("PROFILE_FACTS_READ_FAILED");
  }

  if (resumeError) {
    throw new Error("MASTER_RESUME_READ_FAILED");
  }

  return buildSupportedEvidenceCorpus([
    ...(facts ?? []).map((fact) => ({
      label: fact.fact_type,
      status: fact.evidence_status,
      text: fact.fact_value,
      userConfirmed: fact.user_confirmed,
    })),
    {
      label: "master resume",
      status: "source_excerpt",
      text: masterResume?.content_json ? JSON.stringify(masterResume.content_json) : null,
      userConfirmed: true,
    },
    {
      label: "target job",
      status: "source_excerpt",
      text: [
        application.company_name,
        application.job_title,
        jobIngestion?.company,
        jobIngestion?.title,
        jobIngestion?.extracted_text,
      ]
        .filter(Boolean)
        .join(" "),
      userConfirmed: true,
    },
  ]);
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
    .select("id, company_name, job_title, job_url, profile_id, status")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    throw new Error("APPLICATION_NOT_FOUND");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", data.profile_id)
    .eq("user_id", userId)
    .maybeSingle();

  return {
    companyName: cleanMaterialLabel(data.company_name) || "Unknown company",
    displayName: readApplicationProfileName(profile),
    id: data.id,
    jobTitle: cleanMaterialLabel(data.job_title),
    jobUrl: data.job_url,
    status: data.status,
  };
}

function formatApplicationContextLine(application: {
  companyName: string;
  jobTitle: string | null;
}) {
  return [application.companyName, application.jobTitle].filter(Boolean).join(" | ");
}

function readApplicationProfileName(profile: unknown) {
  const value = (profile as { display_name?: unknown } | null)?.display_name;

  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : null;
}

function cleanMaterialLabel(value: string | null) {
  if (!value) {
    return null;
  }

  const decoded = value
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
  const withoutLinkedInNoise = decoded
    .split(/\s+(?:\||-|–|—)\s+/)
    .map((part) => part.trim())
    .filter((part) => !/^(?:linkedin|linkedin\.com|jobs|job details|careers?)$/i.test(part))
    .join(" | ")
    .trim();

  if (/^(?:linkedin|linkedin\.com)$/i.test(withoutLinkedInNoise)) {
    return null;
  }

  return withoutLinkedInNoise.slice(0, 180) || null;
}

async function readLatestResume(applicationId: string, userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("generated_resumes")
    .select(
      "id, content_json, pdf_storage_path, docx_storage_path, status, export_status, claim_review_acknowledged_at, updated_at",
    )
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
    .select(
      "id, content, pdf_storage_path, docx_storage_path, status, export_status, claim_review_acknowledged_at, claim_risks, reviewer_notes, updated_at",
    )
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
