/*
  The cursor of a file list is the position of the last file on the page: its creation time in
  microseconds (the database's precision, so two files made within one millisecond keep their
  place) and its id. Opaque to callers. Both stores use it.
*/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type ResourceCursor = { micros: number; id: string };

export function encodeResourceCursor(cursor: ResourceCursor): string {
  return Buffer.from(`${cursor.micros}:${cursor.id.toLowerCase()}`, "utf8").toString("base64url");
}

/** Null for anything that is not a cursor made by encodeResourceCursor. */
export function decodeResourceCursor(text: string | undefined): ResourceCursor | null {
  if (!text || text.length > 100 || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const decoded = Buffer.from(text, "base64url").toString("utf8");
  const match = /^(\d{1,16}):([0-9a-f-]{36})$/.exec(decoded);
  if (!match || !UUID.test(match[2])) return null;
  const micros = Number(match[1]);
  return Number.isSafeInteger(micros) ? { micros, id: match[2] } : null;
}

/** 1 to 50 whole results; anything that is not a number gets the largest page. */
export function clampResourceLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.min(50, Math.max(1, Math.floor(limit))) : 50;
}
