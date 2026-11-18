/*
  What both ResourceStores share about a file's answers (its type and details), so the database
  store and the in-memory one cannot drift apart. No server-only code: unit tests import it.
*/

/** The type keys the app wrote before upload forms were configurable; the old `type` column still holds one. */
const LEGACY_TYPE_KEYS = ["notes", "pyq", "study_material", "assignment", "other"];

/**
 * What the old `type` column is given for a type id: the id itself when it is one of the old keys,
 * else `other`. New code reads `type_id`; this only keeps the column's not-null rule satisfied and
 * lets code from before the change show something sensible.
 */
export function legacyTypeKey(typeId: string): string {
  return LEGACY_TYPE_KEYS.includes(typeId) ? typeId : "other";
}

/** Limits the database checks on a file's answers (see the resources table in schema.ts). */
export const ANSWER_DB_LIMITS = { maxTypeIdLength: 64, maxTypeOtherLength: 40 } as const;

/** Postgres cannot store a NUL character in text (or in JSON text), so no file has one, and comparing with one would throw. */
export const hasNul = (text: string) => text.includes("\u0000");

/** A copy of the details that keeps only own text entries and fixes lone surrogates (the database cannot store them). A key like "__proto__" stays plain data. */
export function cleanDetails(details: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(details)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, value]) => [key.toWellFormed(), value.toWellFormed()]),
  );
}

/**
 * Reads the `details` column (JSON text). Anything that is not an object of text values gives
 * what can be kept of it, never a throw, so one damaged row cannot break a list.
 */
export function parseDetails(json: unknown): Record<string, string> {
  let value: unknown = json;
  if (typeof json === "string") {
    try {
      value = JSON.parse(json);
    } catch {
      return {};
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
