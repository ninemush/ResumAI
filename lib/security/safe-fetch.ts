import "server-only";

import { assertExternalHttpUrlResolves } from "@/lib/security/url-safety";

type SafeFetchOptions = {
  blockedErrorCode?: string;
  dnsLookupErrorCode?: string;
  fetchErrorCode?: string;
  headers?: HeadersInit;
  maxRedirects?: number;
  signal?: AbortSignal;
  unsupportedProtocolErrorCode?: string;
};

export type SafeFetchResponse = {
  finalUrl: string;
  response: Response;
};

export async function safeFetchExternalHtml(
  url: string,
  {
    blockedErrorCode,
    dnsLookupErrorCode,
    fetchErrorCode,
    headers,
    maxRedirects = 3,
    signal,
    unsupportedProtocolErrorCode,
  }: SafeFetchOptions = {},
): Promise<SafeFetchResponse> {
  let currentUrl = (
    await assertExternalHttpUrlResolves(url, {
      blockedErrorCode,
      dnsLookupErrorCode,
      unsupportedProtocolErrorCode,
    })
  ).toString();

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    let response: Response;

    try {
      response = await fetch(currentUrl, {
        headers,
        redirect: "manual",
        signal,
      });
    } catch {
      throw new Error(fetchErrorCode ?? "URL_FETCH_FAILED");
    }

    if (!isRedirect(response.status)) {
      currentUrl = (
        await assertExternalHttpUrlResolves(response.url || currentUrl, {
          blockedErrorCode,
          dnsLookupErrorCode,
          unsupportedProtocolErrorCode,
        })
      ).toString();

      return {
        finalUrl: currentUrl,
        response,
      };
    }

    if (redirectCount === maxRedirects) {
      throw new Error(blockedErrorCode ?? "URL_REDIRECT_LIMIT_EXCEEDED");
    }

    const location = response.headers.get("location");

    if (!location) {
      throw new Error(fetchErrorCode ?? "URL_FETCH_FAILED");
    }

    currentUrl = (
      await assertExternalHttpUrlResolves(new URL(location, currentUrl).toString(), {
        blockedErrorCode,
        dnsLookupErrorCode,
        unsupportedProtocolErrorCode,
      })
    ).toString();
  }

  throw new Error(blockedErrorCode ?? "URL_REDIRECT_LIMIT_EXCEEDED");
}

function isRedirect(status: number) {
  return [301, 302, 303, 307, 308].includes(status);
}
