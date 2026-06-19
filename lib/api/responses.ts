import { NextResponse } from "next/server";

export type ApiErrorResponse = {
  category: string;
  code: string;
  message: string;
  status?: number;
  [key: string]: unknown;
};

const privateNoStoreCacheControl = "no-store, private";

export function createRequestId() {
  return crypto.randomUUID();
}

export function withPrivateNoStore<T>(response: NextResponse<T>) {
  response.headers.set("Cache-Control", privateNoStoreCacheControl);

  return response;
}

export function apiSuccess<T extends Record<string, unknown>>({
  requestId,
  status = 200,
  ...payload
}: T & {
  requestId: string;
  status?: number;
}) {
  return NextResponse.json(
    {
      ok: true,
      requestId,
      ...payload,
    },
    { status },
  );
}

export function apiError(
  requestId: string,
  error: ApiErrorResponse,
  fallbackStatus = 500,
) {
  const { status, ...errorPayload } = error;

  return NextResponse.json(
    {
      ok: false,
      requestId,
      error: errorPayload,
    },
    { status: status ?? fallbackStatus },
  );
}

export async function readJsonBody(request: Request) {
  return request.json() as Promise<unknown>;
}

export async function readOptionalJsonBody(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return {};
  }

  try {
    return await readJsonBody(request);
  } catch {
    return {};
  }
}
