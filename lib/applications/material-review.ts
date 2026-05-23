import "server-only";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";

import { brand } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";

const GENERATED_ARTIFACT_BUCKET = "generated-artifacts";
const PDF_SIGNED_URL_TTL_SECONDS = 10 * 60;

export const materialReviewSchema = z.object({
  applicationId: z.string().uuid(),
});

const resumeContentSchema = z.object({
  experienceBullets: z.array(z.string().trim().min(1).max(320)).max(14),
  headline: z.string().trim().min(1).max(220),
  keywordGaps: z.array(z.string().trim().min(1).max(140)).max(16),
  reviewerNotes: z.array(z.string().trim().min(1).max(260)).max(8),
  skills: z.array(z.string().trim().min(1).max(90)).max(24),
  summary: z.string().trim().min(1).max(1200),
});

export const updateMaterialReviewSchema = materialReviewSchema.extend({
  coverLetter: z.string().trim().min(20).max(8000).optional(),
  resume: resumeContentSchema.optional(),
});

export type ResumeContent = z.infer<typeof resumeContentSchema>;

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

function parseResumeContent(value: unknown): ResumeContent {
  return resumeContentSchema.parse(value);
}

async function buildResumePdf({
  application,
  resume,
}: {
  application: MaterialReview["application"];
  resume: ResumeContent;
}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const cursor = { y: 740 };

  drawTextBlock(page, resume.headline, { font: bold, size: 17, y: cursor.y });
  cursor.y -= 36;
  drawTextBlock(page, `${application.companyName}${application.jobTitle ? ` | ${application.jobTitle}` : ""}`, {
    color: rgb(0.42, 0.33, 0.24),
    font: regular,
    size: 10,
    y: cursor.y,
  });
  cursor.y -= 30;
  cursor.y = drawSection(page, "Summary", [resume.summary], cursor.y, regular, bold);
  cursor.y = drawSection(page, "Skills", [resume.skills.join(", ")], cursor.y, regular, bold);
  cursor.y = drawSection(
    page,
    "Targeted Experience Bullets",
    resume.experienceBullets.map((bullet) => `- ${bullet}`),
    cursor.y,
    regular,
    bold,
  );
  cursor.y = drawSection(
    page,
    "Keyword Gaps To Verify",
    resume.keywordGaps.map((gap) => `- ${gap}`),
    cursor.y,
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
  const page = pdf.addPage([612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  drawTextBlock(page, `${application.companyName}${application.jobTitle ? ` | ${application.jobTitle}` : ""}`, {
    font: bold,
    size: 16,
    y: 740,
  });
  drawTextBlock(page, `Generated by ${brand.name} for review`, {
    color: rgb(0.42, 0.33, 0.24),
    font: regular,
    size: 10,
    y: 716,
  });
  drawTextBlock(page, coverLetter, {
    font: regular,
    size: 11,
    y: 670,
  });

  return pdf.save();
}

function drawSection(
  page: ReturnType<PDFDocument["addPage"]>,
  title: string,
  lines: string[],
  y: number,
  regular: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  bold: Awaited<ReturnType<PDFDocument["embedFont"]>>,
) {
  drawTextBlock(page, title, { font: bold, size: 12, y });
  let nextY = y - 20;

  for (const line of lines) {
    nextY = drawTextBlock(page, line, { font: regular, size: 10, y: nextY }) - 8;
  }

  return nextY - 10;
}

function drawTextBlock(
  page: ReturnType<PDFDocument["addPage"]>,
  text: string,
  {
    color = rgb(0.05, 0.09, 0.16),
    font,
    size,
    x = 54,
    y,
  }: {
    color?: ReturnType<typeof rgb>;
    font: Awaited<ReturnType<PDFDocument["embedFont"]>>;
    size: number;
    x?: number;
    y: number;
  },
) {
  let cursorY = y;
  const lines = wrapText(text, font, size, 504);

  for (const line of lines) {
    if (cursorY < 54) {
      break;
    }

    page.drawText(line, {
      color,
      font,
      size,
      x,
      y: cursorY,
    });
    cursorY -= size + 5;
  }

  return cursorY;
}

function wrapText(text: string, font: Awaited<ReturnType<PDFDocument["embedFont"]>>, size: number, maxWidth: number) {
  return text
    .split("\n")
    .flatMap((paragraph) => {
      const words = paragraph.trim().split(/\s+/).filter(Boolean);
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
