import "server-only";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const profileSourceTypeSchema = z.enum([
  "natural_language",
  "pdf",
  "docx",
  "txt",
  "image",
  "link",
  "linkedin",
  "portfolio",
  "other",
]);

const sourceUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => isHttpUrl(value), {
    message: "Only http and https links are supported.",
  });

export const profileSourceRequestSchema = z
  .object({
    sourceType: profileSourceTypeSchema,
    sourceUrl: sourceUrlSchema.optional(),
    storagePath: z.string().trim().min(1).max(700).optional(),
    originalFilename: z.string().trim().min(1).max(255).optional(),
    mimeType: z.string().trim().min(1).max(180).optional(),
    text: z.string().trim().min(3).max(4000).optional(),
  })
  .refine(
    (value) => Boolean(value.sourceUrl || value.storagePath || value.text),
    "A source URL, storage path, or text value is required.",
  );

export type ProfileSourceRequest = z.infer<typeof profileSourceRequestSchema>;

export type ProfileSourceIngestionResult = {
  id: string;
  extractionStatus: "pending" | "processing" | "succeeded" | "failed" | "deleted";
  sourceType: z.infer<typeof profileSourceTypeSchema>;
};

export type RecentProfileSource = {
  id: string;
  source_type: string;
  source_url: string | null;
  storage_path: string | null;
  original_filename: string | null;
  extraction_status: string;
  failure_reason: string | null;
  created_at: string;
};

export async function ingestProfileSource(
  input: ProfileSourceRequest,
): Promise<ProfileSourceIngestionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  if (input.storagePath && !input.storagePath.startsWith(`${user.id}/`)) {
    throw new Error("INVALID_STORAGE_PATH");
  }

  validateSourceShape(input);

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .upsert({ user_id: user.id }, { onConflict: "user_id" })
    .select("id")
    .single();

  if (profileError || !profile) {
    throw new Error("PROFILE_UPSERT_FAILED");
  }

  const extractionStatus = input.text ? "succeeded" : "pending";
  const { data: source, error: sourceError } = await supabase
    .from("profile_sources")
    .insert({
      user_id: user.id,
      profile_id: profile.id,
      source_type: input.sourceType,
      source_url: input.sourceUrl ?? null,
      storage_path: input.storagePath ?? null,
      original_filename: input.originalFilename ?? null,
      mime_type: input.mimeType ?? null,
      extracted_text: input.text ?? null,
      extraction_status: extractionStatus,
    })
    .select("id, extraction_status, source_type")
    .single();

  if (sourceError || !source) {
    throw new Error("PROFILE_SOURCE_INSERT_FAILED");
  }

  return {
    id: source.id,
    extractionStatus: source.extraction_status,
    sourceType: source.source_type,
  };
}

export async function getRecentProfileSources(limit = 12): Promise<RecentProfileSource[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { data, error } = await supabase
    .from("profile_sources")
    .select(
      "id, source_type, source_url, storage_path, original_filename, extraction_status, failure_reason, created_at",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 25));

  if (error) {
    throw new Error("PROFILE_SOURCES_READ_FAILED");
  }

  return data ?? [];
}

function validateSourceShape(input: ProfileSourceRequest) {
  if (input.sourceType === "natural_language" && !input.text) {
    throw new Error("TEXT_REQUIRED");
  }

  if (["link", "linkedin", "portfolio"].includes(input.sourceType) && !input.sourceUrl) {
    throw new Error("URL_REQUIRED");
  }

  if (["pdf", "docx", "txt", "image"].includes(input.sourceType) && !input.storagePath) {
    throw new Error("STORAGE_PATH_REQUIRED");
  }

  if (input.sourceType === "linkedin" && input.sourceUrl) {
    const hostname = new URL(input.sourceUrl).hostname.replace(/^www\./, "");

    if (!hostname.endsWith("linkedin.com")) {
      throw new Error("LINKEDIN_URL_REQUIRED");
    }
  }
}

function isHttpUrl(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
