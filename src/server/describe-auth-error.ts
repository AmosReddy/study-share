/**
 * Used by the live probe script only: describes a Supabase Auth error by its name, HTTP
 * status and error code, never by its message (messages can contain addresses or tokens).
 */
export function describeAuthError(error: unknown): string {
  if (error === null || error === undefined) return "no error";
  if (!(error instanceof Error)) return "a non-error value";
  const { status, code } = error as { status?: number; code?: string };
  return `${error.name} status ${status ?? "none"} code ${code ?? "none"}`;
}

/** The length and character class of a code, without ever showing the code. */
export function describeCodeShape(code: string | undefined): string {
  if (!code) return "no code";
  const kind = /^\d+$/.test(code) ? "digits only" : /^[A-Za-z0-9]+$/.test(code) ? "letters and digits" : "other characters present";
  return `${code.length} characters, ${kind}`;
}
