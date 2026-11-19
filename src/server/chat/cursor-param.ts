/*
  Reading a chat cursor from an address (?after= and ?before=), for the group chat's and the
  private chats' polling routes alike. No Next.js here: plain text rules.
*/

/** Cursors are base64url text of under 100 characters (see src/server/resource-cursor.ts). */
const MAX_CURSOR_LENGTH = 100;
const CURSOR_SHAPE = /^[A-Za-z0-9_-]+$/;

/** One cursor-shaped value, nothing when the parameter is absent, or null when it does not fit (repeated, empty, too long, odd characters). */
export function oneCursor(params: URLSearchParams, name: string): string | undefined | null {
  const values = params.getAll(name);
  if (values.length === 0) return undefined;
  if (values.length > 1) return null;
  const [value] = values;
  return value.length >= 1 && value.length <= MAX_CURSOR_LENGTH && CURSOR_SHAPE.test(value) ? value : null;
}
