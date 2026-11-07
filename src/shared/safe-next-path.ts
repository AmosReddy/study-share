const MAX_LENGTH = 500;
const PLACEHOLDER_ORIGIN = "https://placeholder.invalid";
const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/;

/** True when the text is a single-slash path: not `//host`, not `/\host`, no control characters. */
function looksLikeLocalPath(text: string): boolean {
  return (
    text.startsWith("/") &&
    !text.startsWith("//") &&
    !text.startsWith("/\\") &&
    !CONTROL_OR_BACKSLASH.test(text)
  );
}

/**
 * Where to send someone after they sign in: a path on this site (plus query), or the fallback.
 * Anything that could leave the site, however it is disguised, gets the fallback.
 * The `#fragment` is dropped on purpose: the server never sees it, and it is not needed to return.
 */
export function safeNextPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_LENGTH) {
    return fallback;
  }
  if (!looksLikeLocalPath(value)) return fallback;

  // Check the decoded form too, so `/%2f%2fevil.com` and `/%5cevil.com` are refused.
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (!looksLikeLocalPath(decoded)) return fallback;

  let url: URL;
  try {
    url = new URL(value, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;

  // The parser removes `.` and `..` segments, which can turn `/.//evil.com` into `//evil.com`.
  // So the result must pass the same check as the input.
  const result = url.pathname + url.search;
  return looksLikeLocalPath(result) ? result : fallback;
}
