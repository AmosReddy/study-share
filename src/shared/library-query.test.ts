import { describe, expect, it } from "vitest";
import { canonicalSubject, cleanSearchText, hasActiveFilters, libraryHref, parseLibraryParams } from "./library-query";

describe("parseLibraryParams", () => {
  it("reads nothing from an empty address", () => {
    expect(parseLibraryParams({})).toEqual({ q: "", type: "", subject: "", cursor: "" });
    expect(hasActiveFilters(parseLibraryParams({}))).toBe(false);
  });

  it("reads each parameter and keeps odd characters as they are", () => {
    expect(parseLibraryParams({ q: "100% a_b \"x\" +", type: "pyq", subject: "Optics & Co", cursor: "abc" })).toEqual({
      q: '100% a_b "x" +',
      type: "pyq",
      subject: "Optics & Co",
      cursor: "abc",
    });
  });

  it("uses the first of a repeated parameter and ignores an empty array", () => {
    expect(parseLibraryParams({ q: ["one", "two"], type: ["notes", "pyq"], subject: ["A", "B"], cursor: ["c1", "c2"] })).toEqual({
      q: "one",
      type: "notes",
      subject: "A",
      cursor: "c1",
    });
    expect(parseLibraryParams({ q: [], type: [], subject: [] })).toEqual({ q: "", type: "", subject: "", cursor: "" });
  });

  it("ignores an unknown type, including a prototype name", () => {
    expect(parseLibraryParams({ type: "videos" }).type).toBe("");
    expect(parseLibraryParams({ type: "toString" }).type).toBe("");
    expect(parseLibraryParams({ type: "NOTES" }).type).toBe("");
  });

  it("cuts a long search at 100 characters and a long subject at one over the limit", () => {
    expect(parseLibraryParams({ q: "a".repeat(500) }).q).toHaveLength(100);
    expect([...parseLibraryParams({ q: "😀".repeat(150) }).q]).toHaveLength(100);
    expect([...parseLibraryParams({ subject: "s".repeat(5000) }).subject]).toHaveLength(61);
  });

  it("trims the subject", () => {
    expect(parseLibraryParams({ subject: "  Maths  " }).subject).toBe("Maths");
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
    expect(libraryHref("/groups/g1", { q: "", type: "", subject: "" })).toBe("/groups/g1");
  });

  it("carries every filter and the cursor, encoded", () => {
    expect(libraryHref("/groups/g1", { q: "unit 1", type: "notes", subject: "Maths" }, "cur sor")).toBe(
      "/groups/g1?q=unit+1&type=notes&subject=Maths&cursor=cur+sor",
    );
  });

  it("round-trips odd characters through the address", () => {
    const filters = { q: `50% & "a"+b/c?d=e#f`, type: "assignment" as const, subject: "Optics & 100%" };
    const href = libraryHref("/groups/g1", filters);
    expect(href).not.toContain("#");
    const params = new URL(href, "http://x.test").searchParams;
    expect(parseLibraryParams({ q: params.get("q") ?? "", type: params.get("type") ?? "", subject: params.get("subject") ?? "" })).toEqual({
      ...filters,
      cursor: "",
    });
  });

  it("never carries a notice", () => {
    expect(libraryHref("/groups/g1", { q: "x" })).not.toContain("notice");
  });
});

describe("canonicalSubject", () => {
  it("uses the group's spelling when only the capitals differ", () => {
    expect(canonicalSubject("maths", ["Biology", "Maths"])).toBe("Maths");
  });
  it("keeps an unknown subject as it is", () => {
    expect(canonicalSubject("Chemistry", ["Maths"])).toBe("Chemistry");
    expect(canonicalSubject("", ["Maths"])).toBe("");
  });
});
