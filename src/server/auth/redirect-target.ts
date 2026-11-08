/** Parses an absolute address, or returns null for anything else (including `//host` and plain paths). */
function absoluteUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Test mode only: where the fake Google screen returns to, like Google would, with the
 * code added. Null unless `redirectTo` is an address on this site (same origin as `siteUrl`).
 */
export function fakeGoogleReturnUrl(redirectTo: unknown, code: unknown, siteUrl: string): string | null {
  if (typeof redirectTo !== "string" || typeof code !== "string" || code === "") return null;
  const url = absoluteUrl(redirectTo);
  const site = absoluteUrl(siteUrl);
  if (!url || !site || url.origin !== site.origin) return null;
  url.searchParams.append("code", code);
  return url.toString();
}
