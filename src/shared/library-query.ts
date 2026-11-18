import { FORM_LIMITS } from "./form-config";
import { MAX_SEARCH_LENGTH } from "./resource-schemas";

/*
  The Library's search and filters live in the address:
  ?q=...&type=<type id>&d_<detail id>=<value>...&cursor=...
  A text detail's value is the typed text (matched ignoring capitals); a dropdown detail's value is
  the choice's id, so renaming a choice never breaks a link. The old `subject=` is read as
  `d_subject=` (the migrated default form's Subject detail). These pure helpers read the address
  defensively (a repeated parameter, a very long value, an unknown type or detail) and build the
  addresses of the links and the form, so the page and the form agree. They do not know the
  group's form: what a filter means is decided by listFiles, which ignores details the form does
  not have. Nothing here reads the clock or a cookie.
*/

/** What the search box and the filters hold. An empty string, or a missing detail, means "not set". */
export type LibraryFilters = {
  /** The search text, already cleaned (no control characters, at most MAX_SEARCH_LENGTH characters). */
  q: string;
  /** A type id as written in the address, or "" for all types. Not checked against the group's form. */
  type: string;
  /** Detail id to the value asked for. Only details with a value are here. */
  details: Record<string, string>;
};

export type LibraryParams = LibraryFilters & { cursor: string };

/** One entry of a filter's list: a type, or a dropdown's choice, or a text detail's value. */
export type FilterOption = { id: string; label: string; removed: boolean };

/**
 * What the Library's filters offer, from the group's form and the files that exist. `types` ends
 * with Other. A removed type or choice is listed only while a file uses it (`removed: true`), so
 * old files stay findable. A removed detail is listed (`removed: true`) only while a file has a
 * value for it. A dropdown's `options` have choice ids as `id`; a text detail's `options` are the
 * distinct values used (its `id` and `label` are the text).
 */
export type LibraryFilterOptions = {
  types: FilterOption[];
  fields: { id: string; label: string; kind: "text" | "dropdown"; removed: boolean; options: FilterOption[] }[];
};

type RawParams = Record<string, string | string[] | undefined>;

/** A detail's address parameter is `d_` and the detail's id. */
const DETAIL_PREFIX = "d_";
/** The longest id a type or a detail has (the form's own limit). */
const MAX_ID_LENGTH = 64;
/** A group has at most this many details, removed ones included, so more address parameters cannot be real filters. */
const MAX_DETAIL_FILTERS = FORM_LIMITS.maxDetails + FORM_LIMITS.maxRemoved;

/** The first value of an address parameter (`?a=1&a=2` gives "1"), or "" when it is missing. */
function firstValue(value: string | string[] | undefined): string {
  const one = Array.isArray(value) ? value[0] : value;
  return typeof one === "string" ? one : "";
}

/** True when the address has the parameter at all, even with no value. */
const isPresent = (value: string | string[] | undefined) => (Array.isArray(value) ? value.length > 0 : value !== undefined);

/** The search text the library will look for: control characters become spaces, then trimmed and cut. */
export function cleanSearchText(raw: string): string {
  return [...raw.replace(/\p{Cc}/gu, " ").trim()].slice(0, MAX_SEARCH_LENGTH).join("").trim();
}

/** Whitespace runs (and tabs, line breaks) become one space, then the ends are trimmed: how answers are stored. */
const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

/** Cuts to `max + 1` characters: still too long to match anything, without holding a huge text. */
const cutOneOver = (text: string, max: number) => [...text].slice(0, max + 1).join("");

/**
 * Reads the Library's address parameters. Never throws and never returns anything unsafe to hand to
 * listFiles. A repeated parameter counts once (the first value). The search is cleaned and cut to
 * 100 characters. A type id or a detail value is tidied and cut to ONE character over its limit
 * (64 for an id, FORM_LIMITS.maxAnswer for a detail), so a huge one holds no memory and still
 * matches nothing: cutting it to exactly the limit could make it equal a different, real value.
 * `d_<id>` parameters with an empty value, an empty or overlong id, or beyond the most a form can
 * have are dropped. The legacy `subject` is read as `d_subject` when the address has no `d_subject`.
 */
export function parseLibraryParams(params: RawParams): LibraryParams {
  const entries: [string, string][] = [];
  for (const key of Object.keys(params)) {
    if (entries.length >= MAX_DETAIL_FILTERS) break;
    if (!key.startsWith(DETAIL_PREFIX)) continue;
    const fieldId = key.slice(DETAIL_PREFIX.length);
    if (fieldId === "" || [...fieldId].length > MAX_ID_LENGTH) continue;
    const value = cutOneOver(tidy(firstValue(params[key])), FORM_LIMITS.maxAnswer);
    if (value !== "") entries.push([fieldId, value]);
  }
  const legacySubject = cutOneOver(tidy(firstValue(params.subject)), FORM_LIMITS.maxAnswer);
  const hasSubjectDetail = isPresent(params[`${DETAIL_PREFIX}subject`]);
  if (legacySubject !== "" && !hasSubjectDetail && entries.length < MAX_DETAIL_FILTERS) entries.push(["subject", legacySubject]);

  return {
    q: cleanSearchText(firstValue(params.q)),
    type: cutOneOver(firstValue(params.type).trim(), MAX_ID_LENGTH),
    // fromEntries makes plain own properties, so an id like "__proto__" is just data.
    details: Object.fromEntries(entries),
    cursor: firstValue(params.cursor),
  };
}

/**
 * True when any search or filter is on. Pass `knownFieldIds` (the group's detail ids) to ignore
 * details its form does not have, so a stray `d_zzz=1` in an old link does not count as a filter.
 */
export function hasActiveFilters(filters: LibraryFilters, knownFieldIds?: readonly string[]): boolean {
  const details = Object.keys(filters.details).filter((id) => knownFieldIds === undefined || knownFieldIds.includes(id));
  return filters.q !== "" || filters.type !== "" || details.length > 0;
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
  for (const [fieldId, value] of Object.entries(filters.details ?? {})) {
    if (value !== "") query.set(`${DETAIL_PREFIX}${fieldId}`, value);
  }
  if (cursor) query.set("cursor", cursor);
  const text = query.toString();
  return text ? `${base}?${text}` : base;
}

/** One change to the filters: the search text, the type, or one detail's value ("" clears it). */
export type FilterChange = { q?: string; type?: string; detail?: { fieldId: string; value: string } };

/**
 * The address after changing one filter: every other active filter is kept, the page cursor and
 * the `notice` are dropped (a new filter starts at the first page).
 */
export function filterHref(base: string, filters: LibraryFilters, change: FilterChange): string {
  // Entries, not property writes: an id like "__proto__" must stay plain data.
  const kept = Object.entries(filters.details).filter(([fieldId]) => fieldId !== change.detail?.fieldId);
  const changed = change.detail && change.detail.value !== "" ? [...kept, [change.detail.fieldId, change.detail.value]] : kept;
  return libraryHref(base, {
    q: change.q ?? filters.q,
    type: change.type ?? filters.type,
    details: Object.fromEntries(changed),
  });
}

/**
 * The value to show as chosen in a text detail's dropdown: the group's own spelling when the
 * address spells it with other capitals (the filter ignores case), or the address's text unchanged.
 */
export function canonicalValue(value: string, known: readonly string[]): string {
  const lower = value.toLowerCase();
  return known.find((candidate) => candidate.toLowerCase() === lower) ?? value;
}

/**
 * The values the group already uses for each text detail (detail id to values), taken from the
 * Library's filter options, for the suggestions offered while typing. A dropdown has none.
 */
export function suggestionsFrom(filters: LibraryFilterOptions | undefined): Record<string, string[]> {
  return Object.fromEntries(
    (filters?.fields ?? []).filter((field) => field.kind === "text").map((field) => [field.id, field.options.map((option) => option.label)]),
  );
}
