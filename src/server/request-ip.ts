/**
 * The visitor's address, for per-IP rate limits: the first entry of `x-forwarded-for`
 * (Vercel puts the real client first), trimmed. Empty when the header is missing.
 * The length is not capped here; the rate limiter's caller caps it.
 */
export function clientIp(forwardedFor: string | null | undefined): string {
  if (!forwardedFor) return "";
  return forwardedFor.split(",")[0].trim();
}
