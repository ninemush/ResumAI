import { NextResponse } from "next/server";
import { z } from "zod";

import { apiAuthErrorResponse, requireProtectedApiSession } from "@/lib/api/auth";
import { checkRateLimit, getClientRateLimitKey, rateLimitResponse } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    id: string;
    kind: string;
  }>;
};

const GENERATED_ARTIFACT_BUCKET = "generated-artifacts";
const SIGNED_URL_TTL_SECONDS = 5 * 60;

const routeParamsSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["resume", "cover-letter"]),
});

const formatSchema = z.enum(["pdf", "docx"]);

export async function GET(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const ipRateLimit = await checkRateLimit({
    key: getClientRateLimitKey(request, "artifact_download"),
    limit: 60,
    windowMs: 60_000,
  });

  if (!ipRateLimit.allowed) {
    return rateLimitResponse({
      message: "Downloads are being requested too quickly. Pause briefly before trying again.",
      requestId,
      result: ipRateLimit,
    });
  }

  const params = routeParamsSchema.safeParse(await context.params);
  const url = new URL(request.url);
  const format = formatSchema.safeParse(url.searchParams.get("format"));

  if (!params.success || !format.success) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          code: "artifact.invalid_download",
          message: "Choose a valid generated file to download.",
        },
      },
      { status: 400 },
    );
  }

  try {
    await requireProtectedApiSession();
  } catch (error) {
    const authResponse = apiAuthErrorResponse({
      error,
      fallbackMessage: "Please sign in before downloading generated files.",
      requestId,
    });
    if (authResponse) return authResponse;
    throw error;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          code: "auth.required",
          message: "Please sign in before downloading generated files.",
        },
      },
      { status: 401 },
    );
  }

  const userRateLimit = await checkRateLimit({
    key: `user:${user.id}:artifact_download`,
    limit: 60,
    windowMs: 60_000,
  });

  if (!userRateLimit.allowed) {
    return rateLimitResponse({
      message: "Downloads are being requested too quickly. Pause briefly before trying again.",
      requestId,
      result: userRateLimit,
    });
  }

  const artifact = await readArtifact({
    format: format.data,
    id: params.data.id,
    kind: params.data.kind,
    supabase,
    userId: user.id,
  });

  if (!artifact?.storagePath) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          code: "artifact.download_not_available",
          message: "That generated file is not ready to download.",
        },
      },
      { status: 404 },
    );
  }

  if (!artifact.storagePath.startsWith(`${user.id}/`)) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          code: "artifact.invalid_storage_path",
          message: "That generated file is outside your private artifact folder.",
        },
      },
      { status: 403 },
    );
  }

  const { data, error } = await supabase.storage
    .from(GENERATED_ARTIFACT_BUCKET)
    .createSignedUrl(artifact.storagePath, SIGNED_URL_TTL_SECONDS, {
      download: artifact.filename,
    });

  if (error || !data?.signedUrl) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: {
          code: "artifact.signed_url_failed",
          message: "Unable to create a download link for that generated file.",
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.redirect(data.signedUrl, 302);
}

async function readArtifact({
  format,
  id,
  kind,
  supabase,
  userId,
}: {
  format: "docx" | "pdf";
  id: string;
  kind: "cover-letter" | "resume";
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}) {
  if (kind === "resume") {
    const { data, error } = await supabase
      .from("generated_resumes")
      .select("id, pdf_storage_path, docx_storage_path, resume_type")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    const storagePath = format === "pdf" ? data.pdf_storage_path : data.docx_storage_path;
    const label = data.resume_type === "master" ? "master-resume" : "resume";

    return {
      filename: `${label}-${data.id}.${format}`,
      storagePath,
    };
  }

  const { data, error } = await supabase
    .from("generated_cover_letters")
    .select("id, pdf_storage_path, docx_storage_path")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    filename: `cover-letter-${data.id}.${format}`,
    storagePath: format === "pdf" ? data.pdf_storage_path : data.docx_storage_path,
  };
}
