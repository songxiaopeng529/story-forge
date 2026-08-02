import { isIP } from "node:net";

export function assertPublicWebUrl(value: string): URL {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("web.fetch requires a non-empty URL");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("web.fetch blocked URL: malformed URL");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`web.fetch blocked URL: protocol ${url.protocol} is not allowed`);
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("web.fetch blocked URL: localhost is not accessible from web tools");
  }
  if (hostname === "::1" || hostname === "[::1]") {
    throw new Error("web.fetch blocked URL: loopback addresses are not accessible from web tools");
  }
  if (isIP(hostname) === 4 && isBlockedIPv4(hostname)) {
    throw new Error("web.fetch blocked URL: private addresses are not accessible from web tools");
  }

  return url;
}

export function canonicalizeUrl(value: string): string {
  const url = assertPublicWebUrl(value);
  url.hash = "";
  return url.toString();
}

function isBlockedIPv4(hostname: string): boolean {
  const [first = 0, second = 0] = hostname.split(".").map((part) => Number(part));
  return (
    first === 0
    || first === 10
    || first === 127
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 169 && second === 254)
  );
}
