import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const PROFILE_SOURCE_BUCKET = "profile-sources";

export async function GET(_request: Request, context: RouteContext) {
  const params = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "auth.required",
          message: "Please sign in before downloading profile sources.",
        },
      },
      { status: 401 },
    );
  }

  const { data: source, error: sourceError } = await supabase
    .from("profile_sources")
    .select("id, storage_path, original_filename")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (sourceError || !source?.storage_path) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "source.download_not_available",
          message: "That original source file is not available for download.",
        },
      },
      { status: 404 },
    );
  }

  if (!source.storage_path.startsWith(`${user.id}/`)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "source.invalid_storage_path",
          message: "That source file is outside your private source folder.",
        },
      },
      { status: 403 },
    );
  }

  const { data, error } = await supabase.storage
    .from(PROFILE_SOURCE_BUCKET)
    .createSignedUrl(source.storage_path, 60 * 5, {
      download: source.original_filename ?? true,
    });

  if (error || !data?.signedUrl) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "source.signed_url_failed",
          message: "Unable to create a download link for that source.",
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.redirect(data.signedUrl, 302);
}
