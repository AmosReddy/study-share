import { RESOURCE_LIMITS, RESOURCE_TYPE_VALUES, type ResourceType } from "./resources";
import { MAX_SEARCH_LENGTH } from "./resource-schemas";

/*
  The Library's search and filters live in the address: ?q=...&type=...&subject=...&cursor=...
  These pure helpers read them defensively (a repeated parameter, a very long value, an unknown
  type) and build the addresses of the links and the form, so the page and the form agree.
  Nothing here reads the clock or a cookie.
*/

/** What the search box and the two dropdowns hold. An empty string means "not set". */
export type LibraryFilters = {
  /** The search text, already cleaned (no control characters, at most MAX_SEARCH_LENGTH characters). */
  q: string;
  /** A resource type key, or "" for all types. */
  type: ResourceType | "";
  /** A subject as typed in the address, or "" for all subjects. */
  subject: string;
};

export type LibraryParams = LibraryFilters & { cursor: string };

type RawParams = Record<string, string | string[] | undefined>;

/** The first value of an address parameter (`?a=1&a=2` gives "1"), or "" when it is missing. */
function firstValue(value: string | string[] | undefined): string {
  const one = Array.isArray(value) ? value[0] : value;
  return typeof one === "string" ? one : "";
}

/** The search text the library will look for: control characters become spaces, then trimmed and cut. */
export function cleanSearchText(raw: string): string {
  return [...raw.replace(/\p{Cc}/gu, " ").trim()].slice(0, MAX_SEARCH_LENGTH).join("").trim();
}

/**
 * Reads the Library's address parameters. Never throws and never returns anything unsafe to hand to
 * listFiles: a repeated parameter counts once (the first value), the search is cleaned and cut, an
 * unknown type is ignored, and a subject longer than the limit is cut to one character over it, so
 * it still matches nothing (as listFiles decides) without holding a huge text.
 */
export function parseLibraryParams(params: RawParams): LibraryParams {
  const type = RESOURCE_TYPE_VALUES.find((value) => value === firstValue(params.type)) ?? "";
  return {
    q: cleanSearchText(firstValue(params.q)),
    type,
    subject: [...firstValue(params.subject).trim()].slice(0, RESOURCE_LIMITS.maxSubject + 1).join(""),
    cursor: firstValue(params.cursor),
  };
}

export function hasActiveFilters(filters: LibraryFilters): boolean {
  return filters.q !== "" || filters.type !== "" || filters.subject !== "";
}

/**
 * The address of the Library with these filters (and, for a later page, a cursor). Empty filters
 * are left out, so no filters at all gives the plain address. Only the filters and the cursor are
 * carried: nothing else in the current address (the `notice`) ever is.
 */
export function libraryHref(base: string, filters: Partial<LibraryFilters>, cursor?: string): string {
  const query = new URLSearchParams();
  if (filters.q) query.set("q", filters.q);
  if (filters.type) query.set("type", filters.type);
  if (filters.subject) query.set("subject", filters.subject);
  if (cursor) query.set("cursor", cursor);
  const text = query.toString();
  return text ? `${base}?${text}` : base;
}

/**
 * The subject to show as chosen in the dropdown: the group's own spelling when the address spells
 * it with other capitals (the filter ignores case), or the address's text unchanged.
 */
export function canonicalSubject(subject: string, subjects: readonly string[]): string {
  const lower = subject.toLowerCase();
  return subjects.find((known) => known.toLowerCase() === lower) ?? subject;
}
