import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

type UrlSafetyOptions = {
  blockedErrorCode?: string;
  dnsLookupErrorCode?: string;
  unsupportedProtocolErrorCode?: string;
};

const blockedHostnames = new Set(["localhost", "localhost.localdomain"]);
const blockedHostnameSuffixes = [
  ".localhost",
  ".localdomain",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".arpa",
  ".test",
  ".invalid",
  ".example",
];

export function isHttpUrl(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function assertExternalHttpUrl(value: string, options: UrlSafetyOptions = {}) {
  const url = parseExternalHttpUrl(value, options);
  assertPublicHostname(url.hostname, options);

  if (isIP(normalizeHostname(url.hostname))) {
    assertPublicIpAddress(url.hostname, options);
  }

  return url;
}

export async function assertExternalHttpUrlResolves(value: string, options: UrlSafetyOptions = {}) {
  const url = assertExternalHttpUrl(value, options);
  const hostname = normalizeHostname(url.hostname);

  if (isIP(hostname)) {
    assertPublicIpAddress(hostname, options);
    return url;
  }

  let addresses: { address: string }[];

  try {
    addresses = await lookup(hostname, { all: true, verbatim: false });
  } catch {
    throw new Error(options.dnsLookupErrorCode ?? options.blockedErrorCode ?? "URL_DNS_LOOKUP_FAILED");
  }

  if (addresses.length === 0) {
    throw new Error(options.dnsLookupErrorCode ?? options.blockedErrorCode ?? "URL_DNS_LOOKUP_FAILED");
  }

  for (const { address } of addresses) {
    assertPublicIpAddress(address, options);
  }

  return url;
}

function parseExternalHttpUrl(value: string, options: UrlSafetyOptions) {
  const url = new URL(value);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(options.unsupportedProtocolErrorCode ?? "URL_UNSUPPORTED_PROTOCOL");
  }

  if (url.username || url.password) {
    throwBlocked(options);
  }

  return url;
}

function assertPublicHostname(value: string, options: UrlSafetyOptions) {
  const hostname = normalizeHostname(value);

  if (!hostname) {
    throwBlocked(options);
  }

  if (blockedHostnames.has(hostname) || blockedHostnameSuffixes.some((suffix) => hostname.endsWith(suffix))) {
    throwBlocked(options);
  }

  if (!hostname.includes(".") && !isIP(hostname)) {
    throwBlocked(options);
  }
}

function assertPublicIpAddress(value: string, options: UrlSafetyOptions) {
  const hostname = normalizeHostname(value);
  const ipVersion = isIP(hostname);

  if (!ipVersion) {
    return;
  }

  if (ipVersion === 4 && isBlockedIpv4(hostname)) {
    throwBlocked(options);
  }

  if (ipVersion === 6 && isBlockedIpv6(hostname)) {
    throwBlocked(options);
  }
}

function isBlockedIpv4(value: string) {
  const parts = value.split(".").map(Number);

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [first, second, third] = parts;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113)
  );
}

function isBlockedIpv6(value: string) {
  const normalized = normalizeHostname(value).toLowerCase();
  const firstSegment = normalized.split(":")[0] ?? "";

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("::ffff:") ||
    firstSegment.startsWith("fc") ||
    firstSegment.startsWith("fd") ||
    /^fe[89ab]/.test(firstSegment) ||
    firstSegment.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

function normalizeHostname(value: string) {
  return value.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.+$/, "");
}

function throwBlocked(options: UrlSafetyOptions): never {
  throw new Error(options.blockedErrorCode ?? "URL_BLOCKED");
}
