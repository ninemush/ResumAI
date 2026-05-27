import "server-only";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont, PDFPage, RGB } from "pdf-lib";
import { z } from "zod";

import { brand } from "@/lib/brand";
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
    id: string;
    pdfDownloadUrl: string | null;
    status: string;
    updatedAt: string;
  } | null;
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

export async function exportMaterialPdfs(input: z.input<typeof materialReviewSchema>) {
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

  const resumeContent = parseResumeContent(resume.content_json);
  const [resumePdf, coverLetterPdf] = await Promise.all([
    buildResumePdf({ application, resume: resumeContent }),
    buildCoverLetterPdf({ application, coverLetter: coverLetter.content }),
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
  const coverLetterPath = `${userId}/${application.id}/${coverLetter.id}-cover-letter.pdf`;

  await Promise.all([
    uploadPdf(resumePath, resumePdf),
    uploadPdf(coverLetterPath, coverLetterPdf),
  ]);

  const [{ error: resumeError }, { error: coverLetterError }] = await Promise.all([
    supabase
      .from("generated_resumes")
      .update({ pdf_storage_path: resumePath, status: "ready" })
      .eq("id", resume.id)
      .eq("user_id", userId),
    supabase
      .from("generated_cover_letters")
      .update({ pdf_storage_path: coverLetterPath, status: "ready" })
      .eq("id", coverLetter.id)
      .eq("user_id", userId),
  ]);

  if (resumeError || coverLetterError) {
    throw new Error("PDF_METADATA_UPDATE_FAILED");
  }

  return getMaterialReview({ applicationId: parsed.applicationId });

  async function uploadPdf(path: string, bytes: Uint8Array) {
    const { error } = await supabase.storage.from(GENERATED_ARTIFACT_BUCKET).upload(path, bytes, {
      contentType: "application/pdf",
      upsert: true,
    });

    if (error) {
      throw new Error("PDF_UPLOAD_FAILED");
    }
  }
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
      warnings: ["Generate both resume and cover-letter materials before exporting PDFs."],
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

  return {
    canExport: true,
    status: resume.pdf_storage_path && coverLetter.pdf_storage_path ? "exported" : "ready_to_export",
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
    .select("id, content_json, pdf_storage_path, status, updated_at")
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
    .select("id, content, pdf_storage_path, status, updated_at")
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

async function buildResumePdf({
  application,
  resume,
}: {
  application: MaterialReview["application"];
  resume: ResumeContent;
}) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const document = createPdfLayout({ bold, pdf, regular });

  drawTextBlock(document, resume.headline, { font: bold, size: 17 });
  drawTextBlock(document, `${application.companyName}${application.jobTitle ? ` | ${application.jobTitle}` : ""}`, {
    color: rgb(0.42, 0.33, 0.24),
    font: regular,
    size: 10,
  });
  addVerticalSpace(document, 12);
  drawSection(document, "Summary", [resume.summary], regular, bold);
  drawSection(document, "Skills", [resume.skills.join(", ")], regular, bold);
  drawSection(
    document,
    "Targeted Experience Bullets",
    resume.experienceBullets.map((bullet) => `- ${bullet}`),
    regular,
    bold,
  );
  drawSection(
    document,
    "Keyword Gaps To Verify",
    resume.keywordGaps.map((gap) => `- ${gap}`),
    regular,
    bold,
  );
  drawSection(
    document,
    "Reviewer Notes",
    resume.reviewerNotes.map((note) => `- ${note}`),
    regular,
    bold,
  );

  return pdf.save();
}

async function buildCoverLetterPdf({
  application,
  coverLetter,
}: {
  application: MaterialReview["application"];
  coverLetter: string;
}) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const document = createPdfLayout({ bold, pdf, regular });

  drawTextBlock(document, `${application.companyName}${application.jobTitle ? ` | ${application.jobTitle}` : ""}`, {
    font: bold,
    size: 16,
  });
  drawTextBlock(document, `Generated by ${brand.name} for review`, {
    color: rgb(0.42, 0.33, 0.24),
    font: regular,
    size: 10,
  });
  addVerticalSpace(document, 28);
  drawTextBlock(document, coverLetter, {
    font: regular,
    size: 11,
  });

  return pdf.save();
}

function drawSection(
  document: PdfLayout,
  title: string,
  lines: string[],
  regular: PDFFont,
  bold: PDFFont,
) {
  drawTextBlock(document, title, { font: bold, size: 12 });
  addVerticalSpace(document, 4);

  for (const line of lines) {
    drawTextBlock(document, line, { font: regular, size: 10 });
    addVerticalSpace(document, 4);
  }

  addVerticalSpace(document, 10);
}

function drawTextBlock(
  document: PdfLayout,
  text: string,
  {
    color = rgb(0.05, 0.09, 0.16),
    font,
    size,
    x = 54,
  }: {
    color?: RGB;
    font: PDFFont;
    size: number;
    x?: number;
  },
) {
  const lines = wrapText(text, font, size, 504);

  for (const line of lines) {
    ensureSpace(document, size + 5);

    document.page.drawText(line, {
      color,
      font,
      size,
      x,
      y: document.cursorY,
    });
    document.cursorY -= size + 5;
  }
}

type PdfLayout = {
  bold: PDFFont;
  cursorY: number;
  page: PDFPage;
  pdf: PDFDocument;
  regular: PDFFont;
};

function createPdfLayout({
  bold,
  pdf,
  regular,
}: {
  bold: PDFFont;
  pdf: PDFDocument;
  regular: PDFFont;
}): PdfLayout {
  return {
    bold,
    cursorY: 740,
    page: pdf.addPage([612, 792]),
    pdf,
    regular,
  };
}

function addVerticalSpace(document: PdfLayout, space: number) {
  ensureSpace(document, space);
  document.cursorY -= space;
}

function ensureSpace(document: PdfLayout, requiredHeight: number) {
  if (document.cursorY - requiredHeight >= 54) {
    return;
  }

  document.page = document.pdf.addPage([612, 792]);
  document.cursorY = 740;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  return text
    .split("\n")
    .flatMap((paragraph) => {
      const words = paragraph
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .flatMap((word) => splitLongWord(word, font, size, maxWidth));
      const lines: string[] = [];
      let currentLine = "";

      for (const word of words) {
        const candidate = currentLine ? `${currentLine} ${word}` : word;

        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
          currentLine = candidate;
          continue;
        }

        if (currentLine) {
          lines.push(currentLine);
        }
        currentLine = word;
      }

      if (currentLine) {
        lines.push(currentLine);
      }

      return lines.length > 0 ? lines : [""];
    });
}

function splitLongWord(word: string, font: PDFFont, size: number, maxWidth: number) {
  if (font.widthOfTextAtSize(word, size) <= maxWidth) {
    return [word];
  }

  const segments: string[] = [];
  let segment = "";

  for (const character of word) {
    const candidate = `${segment}${character}`;

    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      segment = candidate;
      continue;
    }

    if (segment) {
      segments.push(segment);
    }
    segment = character;
  }

  if (segment) {
    segments.push(segment);
  }

  return segments;
}
