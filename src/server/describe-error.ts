/**
 * One safe line about an error for the server log: its name and message, with any
 * address (which can carry a password or token) removed. Anything that is not an
 * Error is reported as "unknown error", since its contents are not known to be safe.
 */
export function describeForLog(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  return `${error.name}: ${error.message}`.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url removed>");
}
