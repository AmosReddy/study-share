import { describe, expect, it } from "vitest";
import { FORM_LIMITS } from "./form-config";
import {
  canonicalValue,
  cleanSearchText,
  filterHref,
  hasActiveFilters,
  libraryHref,
  parseLibraryParams,
  type LibraryFilters,
} from "./library-query";

const none: LibraryFilters = { q: "", type: "", details: {} };

describe("parseLibraryParams", () => {
  it("reads nothing from an empty address", () => {
    expect(parseLibraryParams({})).toEqual({ q: "", type: "", details: {}, cursor: "" });
    expect(hasActiveFilters(parseLibraryParams({}))).toBe(false);
  });

  it("reads each parameter and keeps odd characters as they are", () => {
    expect(
      parseLibraryParams({ q: "100% a_b \"x\" +", type: "pyq", d_subject: "Optics & Co", d_sem: "abc123", cursor: "abc" }),
    ).toEqual({
      q: '100% a_b "x" +',
      type: "pyq",
      details: { subject: "Optics & Co", sem: "abc123" },
      cursor: "abc",
    });
  });

  it("uses the first of a repeated parameter and ignores an empty array", () => {
    expect(
      parseLibraryParams({ q: ["one", "two"], type: ["notes", "pyq"], d_subject: ["A", "B"], d_sem: ["s1", "s2"], cursor: ["c1", "c2"] }),
    ).toEqual({ q: "one", type: "notes", details: { subject: "A", sem: "s1" }, cursor: "c1" });
    expect(parseLibraryParams({ q: [], type: [], d_subject: [], subject: [] })).toEqual({ q: "", type: "", details: {}, cursor: "" });
  });

  it("keeps an unknown type as written (listFiles decides it matches nothing) and does not trust prototype names", () => {
    expect(parseLibraryParams({ type: "videos" }).type).toBe("videos");
    expect(parseLibraryParams({ type: "toString" }).type).toBe("toString");
    expect(parseLibraryParams({ type: "  pyq  " }).type).toBe("pyq");
  });

  it("cuts a search at 100 characters and a type id or a detail value at one over their limits", () => {
    expect(parseLibraryParams({ q: "a".repeat(500) }).q).toHaveLength(100);
    expect([...parseLibraryParams({ q: "😀".repeat(150) }).q]).toHaveLength(100);
    expect([...parseLibraryParams({ type: "t".repeat(5000) }).type]).toHaveLength(65);
    const tooLong = parseLibraryParams({ d_subject: "s".repeat(5000), d_emoji: "😀".repeat(500) }).details;
    expect([...tooLong.subject]).toHaveLength(FORM_LIMITS.maxAnswer + 1);
    expect([...tooLong.emoji]).toHaveLength(FORM_LIMITS.maxAnswer + 1);
  });

  it("tidies a detail value: trimmed, and runs of spaces, tabs and line breaks become one space", () => {
    expect(parseLibraryParams({ d_subject: "  Maths  " }).details).toEqual({ subject: "Maths" });
    expect(parseLibraryParams({ d_subject: "Applied \t\n  Maths" }).details).toEqual({ subject: "Applied Maths" });
  });

  it("drops a detail with no value, no id or an overlong id", () => {
    expect(parseLibraryParams({ d_a: "", d_b: "   ", d_: "x", [`d_${"i".repeat(65)}`]: "x", d_ok: "1" }).details).toEqual({ ok: "1" });
  });

  it("reads the old subject= as d_subject, but only when the address has no d_subject", () => {
    expect(parseLibraryParams({ subject: "Maths" }).details).toEqual({ subject: "Maths" });
    expect(parseLibraryParams({ subject: ["Maths", "Physics"] }).details).toEqual({ subject: "Maths" });
    expect(parseLibraryParams({ subject: "Maths", d_subject: "Physics" }).details).toEqual({ subject: "Physics" });
    // d_subject is present, even if empty: it wins, so a cleared filter is not brought back.
    expect(parseLibraryParams({ subject: "Maths", d_subject: "" }).details).toEqual({});
    expect(parseLibraryParams({ subject: "  " }).details).toEqual({});
    expect([...parseLibraryParams({ subject: "s".repeat(500) }).details.subject]).toHaveLength(FORM_LIMITS.maxAnswer + 1);
  });

  it("keeps parameters that are not details out of the details", () => {
    expect(parseLibraryParams({ notice: "uploaded", x: "1", dd: "2", D_subject: "3" }).details).toEqual({});
  });

  it("reads at most as many detail filters as a form can have", () => {
    const many = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`d_f${i}`, "v"]));
    expect(Object.keys(parseLibraryParams(many).details)).toHaveLength(FORM_LIMITS.maxDetails + FORM_LIMITS.maxRemoved);
  });

  it("treats a detail id like __proto__ as plain data", () => {
    const parsed = parseLibraryParams({ d___proto__: "x", d_constructor: "y", d_toString: "z" });
    expect(Object.getPrototypeOf(parsed.details)).toBe(Object.prototype);
    expect(Object.keys(parsed.details).sort()).toEqual(["__proto__", "constructor", "toString"]);
    expect(Object.hasOwn(parsed.details, "__proto__")).toBe(true);
    expect(({} as Record<string, string>).polluted).toBeUndefined();
  });
});

describe("hasActiveFilters", () => {
  it("is on for a search, a type or a detail", () => {
    expect(hasActiveFilters(none)).toBe(false);
    expect(hasActiveFilters({ ...none, q: "x" })).toBe(true);
    expect(hasActiveFilters({ ...none, type: "notes" })).toBe(true);
    expect(hasActiveFilters({ ...none, details: { subject: "Maths" } })).toBe(true);
  });

  it("with the group's detail ids, ignores details its form does not have", () => {
    const stray = { ...none, details: { zzz: "1" } };
    expect(hasActiveFilters(stray)).toBe(true);
    expect(hasActiveFilters(stray, ["subject"])).toBe(false);
    expect(hasActiveFilters({ ...none, details: { subject: "Maths" } }, ["subject"])).toBe(true);
  });
});

describe("cleanSearchText", () => {
  it("turns control characters into spaces and trims", () => {
    expect(cleanSearchText("  a\u0000b\tc\n ")).toBe("a b c");
    expect(cleanSearchText("\u0000\u0001")).toBe("");
  });
});

describe("libraryHref", () => {
  it("is the plain address without filters", () => {
    expect(libraryHref("/groups/g1", {})).toBe("/groups/g1");
    expect(libraryHref("/groups/g1", { q: "", type: "", details: {} })).toBe("/groups/g1");
    expect(libraryHref("/groups/g1", { details: { subject: "" } })).toBe("/groups/g1");
  });

  it("carries every filter and the cursor, encoded", () => {
    expect(
      libraryHref("/groups/g1", { q: "unit 1", type: "notes", details: { subject: "Maths", sem: "c9" } }, "cur sor"),
    ).toBe("/groups/g1?q=unit+1&type=notes&d_subject=Maths&d_sem=c9&cursor=cur+sor");
  });

  it("round-trips odd characters through the address", () => {
    const filters = { q: `50% & "a"+b/c?d=e#f`, type: "assignment", details: { subject: "Optics & 100%", "we ird&id": "a=b" } };
    const href = libraryHref("/groups/g1", filters);
    expect(href).not.toContain("#");
    const params = Object.fromEntries(new URL(href, "http://x.test").searchParams);
    expect(parseLibraryParams(params)).toEqual({ ...filters, cursor: "" });
  });

  it("never carries a notice", () => {
    expect(libraryHref("/groups/g1", { q: "x" })).not.toContain("notice");
  });
});

describe("filterHref", () => {
  const current: LibraryFilters = { q: "unit", type: "pyq", details: { subject: "Maths", sem: "c1" } };

  it("changes one filter and keeps all the others", () => {
    expect(filterHref("/g", current, { type: "notes" })).toBe("/g?q=unit&type=notes&d_subject=Maths&d_sem=c1");
    expect(filterHref("/g", current, { q: "other" })).toBe("/g?q=other&type=pyq&d_subject=Maths&d_sem=c1");
    expect(filterHref("/g", current, { detail: { fieldId: "sem", value: "c2" } })).toBe("/g?q=unit&type=pyq&d_subject=Maths&d_sem=c2");
    expect(filterHref("/g", current, { detail: { fieldId: "year", value: "2024" } })).toBe(
      "/g?q=unit&type=pyq&d_subject=Maths&d_sem=c1&d_year=2024",
    );
  });

  it("clears a filter with an empty value", () => {
    expect(filterHref("/g", current, { type: "" })).toBe("/g?q=unit&d_subject=Maths&d_sem=c1");
    expect(filterHref("/g", current, { detail: { fieldId: "subject", value: "" } })).toBe("/g?q=unit&type=pyq&d_sem=c1");
    expect(filterHref("/g", none, { detail: { fieldId: "subject", value: "" } })).toBe("/g");
  });

  it("drops the page cursor and the notice", () => {
    const href = filterHref("/g", { ...current, cursor: "abc", notice: "uploaded" } as LibraryFilters, { type: "notes" });
    expect(href).not.toContain("cursor");
    expect(href).not.toContain("notice");
  });

  it("does not turn an id like __proto__ into a prototype", () => {
    const href = filterHref("/g", none, { detail: { fieldId: "__proto__", value: "x" } });
    expect(href).toBe("/g?d___proto__=x");
  });
});

describe("canonicalValue", () => {
  it("uses the group's spelling when only the capitals differ", () => {
    expect(canonicalValue("maths", ["Biology", "Maths"])).toBe("Maths");
  });
  it("keeps an unknown value as it is", () => {
    expect(canonicalValue("Chemistry", ["Maths"])).toBe("Chemistry");
    expect(canonicalValue("", ["Maths"])).toBe("");
  });
});
