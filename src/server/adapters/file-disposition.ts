import "server-only";

/*
  Shared by every FileStorage adapter (the real S3 one and the test-mode fake), so both decide
  "inline or download" and build the Content-Disposition header by the same rule.
*/

/**
 * The only types a browser may show inline. Anything that can run script or render
 * attacker-controlled markup (HTML, SVG, XML, JavaScript) is deliberately absent.
 */
export const INLINE_SAFE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]);

/** The type normalised (lower case, no parameters), or undefined when it is not safe to show inline. */
export function safeInlineType(contentType: string | undefined): string | undefined {
  const type = contentType?.split(";")[0]?.trim().toLowerCase();
  return type && INLINE_SAFE_TYPES.has(type) ? type : undefined;
}

/** Builds a Content-Disposition value that stays on one line and keeps non-English file names intact. */
export function contentDisposition(disposition: "attachment" | "inline", name?: string): string {
  // toWellFormed() swaps lone surrogate characters, which encodeURIComponent would throw on.
  const clean = (name ?? "").toWellFormed().replace(/[\r\n]+/g, " ").trim();
  if (!clean) return disposition;
  // Always quoted: an unquoted name with a comma makes some browsers refuse the download.
  const asciiFallback = clean.replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_");
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
