import "server-only";

import { z } from "zod";

import { assertExternalHttpUrl } from "@/lib/security/url-safety";
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

const uploadMimeTypes = {
  "application/pdf": "pdf",
  "application/csv": "linkedin",
  "application/zip": "linkedin",
  "application/x-zip-compressed": "linkedin",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "text/csv": "linkedin",
  "text/plain": "txt",
} as const;

export const profileSourceUploadIntentSchema = z.object({
  fileSize: z.number().int().min(1).max(25_000_000),
  mimeType: z.string().trim().min(1).max(180),
  originalFilename: z.string().trim().min(1).max(255),
});

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

export type RemovedProfileSource = {
  id: string;
  originalFilename: string | null;
  removedStorageObject: boolean;
};

export async function createProfileSourceUploadIntent(
  input: z.input<typeof profileSourceUploadIntentSchema>,
) {
  const parsed = profileSourceUploadIntentSchema.parse(input);
  const sourceType = uploadMimeTypes[parsed.mimeType as keyof typeof uploadMimeTypes];

  if (
    !sourceType ||
    /\.(heic|heif)$/i.test(parsed.originalFilename) ||
    !filenameMatchesMimeType(parsed.originalFilename, parsed.mimeType)
  ) {
    throw new Error("UNSUPPORTED_UPLOAD_TYPE");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .upsert({ user_id: user.id }, { onConflict: "user_id" })
    .select("id")
    .single();

  if (profileError || !profile) {
    throw new Error("PROFILE_UPSERT_FAILED");
  }

  const sourceId = crypto.randomUUID();
  const extension = readSafeFileExtension(parsed.originalFilename, parsed.mimeType);
  const storagePath = `${user.id}/${sourceId}/${Date.now()}-${slugifyFilename(parsed.originalFilename)}${extension}`;
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();

  const { data: source, error: sourceError } = await supabase
    .from("profile_sources")
    .insert({
      id: sourceId,
      user_id: user.id,
      profile_id: profile.id,
      source_type: sourceType,
      storage_path: storagePath,
      original_filename: parsed.originalFilename,
      mime_type: parsed.mimeType,
      extraction_status: "saved",
      upload_expires_at: expiresAt,
    })
    .select("id, extraction_status, source_type, storage_path")
    .single();

  if (sourceError || !source) {
    throw new Error("PROFILE_SOURCE_INSERT_FAILED");
  }

  const { data: signedUpload, error: uploadError } = await supabase.storage
    .from("profile-sources")
    .createSignedUploadUrl(storagePath);

  if (uploadError || !signedUpload) {
    throw new Error("SOURCE_UPLOAD_URL_FAILED");
  }

  return {
    expiresAt,
    source: {
      id: source.id,
      extractionStatus: source.extraction_status,
      sourceType: source.source_type,
    },
    storagePath,
    token: signedUpload.token,
    uploadUrl: signedUpload.signedUrl,
  };
}

export async function completeProfileSourceUpload({ sourceId }: { sourceId: string }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { data: source, error: sourceError } = await supabase
    .from("profile_sources")
    .select("id, storage_path, extraction_status, source_type")
    .eq("id", sourceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (sourceError || !source?.storage_path) {
    throw new Error("SOURCE_NOT_FOUND");
  }

  if (!source.storage_path.startsWith(`${user.id}/`)) {
    throw new Error("INVALID_STORAGE_PATH");
  }

  const { data: files, error: listError } = await supabase.storage
    .from("profile-sources")
    .list(source.storage_path.split("/").slice(0, -1).join("/"), {
      search: source.storage_path.split("/").at(-1),
    });

  if (listError || !files || files.length === 0) {
    throw new Error("SOURCE_UPLOAD_NOT_FOUND");
  }

  const { data: updated, error: updateError } = await supabase
    .from("profile_sources")
    .update({
      extraction_status: "uploaded",
      failure_reason: null,
      upload_expires_at: null,
    })
    .eq("id", source.id)
    .eq("user_id", user.id)
    .select("id, extraction_status, source_type")
    .single();

  if (updateError || !updated) {
    throw new Error("SOURCE_UPDATE_FAILED");
  }

  return {
    id: updated.id,
    extractionStatus: updated.extraction_status,
    sourceType: updated.source_type,
  };
}

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

export async function removeProfileSource(sourceId: string): Promise<RemovedProfileSource> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }

  const { data: source, error: sourceError } = await supabase
    .from("profile_sources")
    .select("id, storage_path, original_filename")
    .eq("id", sourceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (sourceError || !source) {
    throw new Error("SOURCE_NOT_FOUND");
  }

  let removedStorageObject = false;

  if (source.storage_path) {
    if (!source.storage_path.startsWith(`${user.id}/`)) {
      throw new Error("INVALID_STORAGE_PATH");
    }

    const { error: storageError } = await supabase.storage
      .from("profile-sources")
      .remove([source.storage_path]);

    removedStorageObject = !storageError;
  }

  await detachSourceFromProfileFacts({
    sourceId,
    userId: user.id,
  });

  const { error: deleteError } = await supabase
    .from("profile_sources")
    .delete()
    .eq("id", sourceId)
    .eq("user_id", user.id);

  if (deleteError) {
    throw new Error("SOURCE_DELETE_FAILED");
  }

  return {
    id: source.id,
    originalFilename: source.original_filename,
    removedStorageObject,
  };
}

async function detachSourceFromProfileFacts({
  sourceId,
  userId,
}: {
  sourceId: string;
  userId: string;
}) {
  const supabase = await createClient();
  const { data: facts, error } = await supabase
    .from("profile_facts")
    .select("id, source_ids")
    .eq("user_id", userId)
    .contains("source_ids", [sourceId]);

  if (error || !facts) {
    return;
  }

  await Promise.all(
    facts.map((fact) =>
      supabase
        .from("profile_facts")
        .update({
          source_ids: (fact.source_ids ?? []).filter((id: string) => id !== sourceId),
        })
        .eq("id", fact.id)
        .eq("user_id", userId),
    ),
  );
}

function validateSourceShape(input: ProfileSourceRequest) {
  if (input.sourceType === "natural_language" && !input.text) {
    throw new Error("TEXT_REQUIRED");
  }

  if (["link", "portfolio"].includes(input.sourceType) && !input.sourceUrl) {
    throw new Error("URL_REQUIRED");
  }

  if (["link", "portfolio"].includes(input.sourceType) && input.sourceUrl) {
    assertExternalHttpUrl(input.sourceUrl, {
      blockedErrorCode: "PROFILE_LINK_BLOCKED",
      unsupportedProtocolErrorCode: "PROFILE_LINK_UNSUPPORTED_PROTOCOL",
    });
  }

  if (input.sourceType === "linkedin" && !input.sourceUrl && !input.storagePath) {
    throw new Error("LINKEDIN_SOURCE_REQUIRED");
  }

  if (["pdf", "docx", "txt", "image"].includes(input.sourceType) && !input.storagePath) {
    throw new Error("STORAGE_PATH_REQUIRED");
  }

  if (input.sourceType === "docx" && input.originalFilename?.toLowerCase().endsWith(".doc")) {
    throw new Error("DOC_UNSUPPORTED");
  }

  if (input.sourceType === "linkedin" && input.sourceUrl) {
    assertExternalHttpUrl(input.sourceUrl, {
      blockedErrorCode: "PROFILE_LINK_BLOCKED",
      unsupportedProtocolErrorCode: "PROFILE_LINK_UNSUPPORTED_PROTOCOL",
    });

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

function readSafeFileExtension(filename: string, mimeType: string) {
  const ext = filename.match(/\.[A-Za-z0-9]{1,12}$/)?.[0]?.toLowerCase();

  if (ext && ![".heic", ".heif"].includes(ext)) {
    return ext;
  }

  const fallbackByMime: Record<string, string> = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "text/plain": ".txt",
  };

  return fallbackByMime[mimeType] ?? "";
}

function filenameMatchesMimeType(filename: string, mimeType: string) {
  const ext = filename.match(/\.[A-Za-z0-9]{1,12}$/)?.[0]?.toLowerCase();

  if (!ext) {
    return true;
  }

  const allowedExtensionsByMime: Record<string, string[]> = {
    "application/csv": [".csv"],
    "application/pdf": [".pdf"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
    "application/x-zip-compressed": [".zip"],
    "application/zip": [".zip"],
    "image/jpeg": [".jpg", ".jpeg"],
    "image/png": [".png"],
    "image/webp": [".webp"],
    "text/csv": [".csv"],
    "text/plain": [".txt"],
  };

  return allowedExtensionsByMime[mimeType]?.includes(ext) ?? false;
}

function slugifyFilename(filename: string) {
  const withoutExtension = filename.replace(/\.[A-Za-z0-9]{1,12}$/, "");
  const normalized = withoutExtension
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return normalized || "profile-source";
}
