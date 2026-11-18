import { describe, expect, it } from "vitest";
import { cleanDetails, legacyTypeKey, parseDetails } from "./resource-answers";

describe("legacyTypeKey", () => {
  it("keeps the old keys and turns every other type id into other", () => {
    for (const key of ["notes", "pyq", "study_material", "assignment", "other"]) expect(legacyTypeKey(key)).toBe(key);
    for (const custom of ["k3j9x", "Notes", "", "__proto__", "toString", "notes "]) expect(legacyTypeKey(custom)).toBe("other");
  });
});

describe("cleanDetails", () => {
  it("copies the text entries, keeps __proto__ as plain data and fixes lone surrogates", () => {
    const original = Object.fromEntries([
      ["__proto__", "x"],
      ["a", "bad \ud800 end"],
    ]);
    const cleaned = cleanDetails(original);
    expect(Object.getPrototypeOf(cleaned)).toBe(Object.prototype);
    expect(Object.hasOwn(cleaned, "__proto__")).toBe(true);
    expect(cleaned.a).toBe("bad � end");
    expect(cleaned).not.toBe(original);
  });

  it("drops anything that is not text", () => {
    expect(cleanDetails({ a: "x", b: 5, c: null } as unknown as Record<string, string>)).toEqual({ a: "x" });
  });
});

describe("parseDetails", () => {
  it("reads JSON text or an object, and keeps only text values", () => {
    expect(parseDetails('{"a":"x","b":"y"}')).toEqual({ a: "x", b: "y" });
    expect(parseDetails({ a: "x", b: 1, c: ["z"] })).toEqual({ a: "x" });
    const proto = parseDetails('{"__proto__":"x"}');
    expect(Object.getPrototypeOf(proto)).toBe(Object.prototype);
    expect(Object.hasOwn(proto, "__proto__")).toBe(true);
  });

  it("gives an empty object for anything damaged, and never throws", () => {
    for (const bad of ["", "not json", "[]", '"text"', "5", "null", null, undefined, 7, ["a"]]) expect(parseDetails(bad)).toEqual({});
  });
});
