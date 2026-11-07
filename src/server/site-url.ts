const LOCAL_SITE_URL = "http://localhost:3000";

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    new URL(trimmed);
  } catch {
    return undefined;
  }
  return trimmed.replace(/\/+$/, "");
}

/**
 * The address this deployment is reachable at, without a trailing slash.
 * NEXT_PUBLIC_SITE_URL wins; otherwise the Vercel branch address, then the
 * deployment address, then localhost. A value that is not a URL is skipped.
 */
export function getSiteUrl(source: Record<string, string | undefined> = process.env): string {
  return (
    clean(source.NEXT_PUBLIC_SITE_URL) ??
    clean(source.VERCEL_BRANCH_URL && `https://${source.VERCEL_BRANCH_URL}`) ??
    clean(source.VERCEL_URL && `https://${source.VERCEL_URL}`) ??
    LOCAL_SITE_URL
  );
}
