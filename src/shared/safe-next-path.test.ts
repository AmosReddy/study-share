import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next-path";

describe("safeNextPath", () => {
  it("returns a same-site path with its query unchanged", () => {
    expect(safeNextPath("/invite/abc?x=1")).toBe("/invite/abc?x=1");
  });

  it.each([
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "/%2f%2fevil.com",
  ])("sends %s to /", (value) => {
    expect(safeNextPath(value)).toBe("/");
  });

  it.each(["/.//evil.com", "/..//evil.com", "/a/..//evil.com", "/%2e%2e//evil.com", "/%2E/%2e//evil.com"])(
    "refuses %s, which the URL parser would normalise into //evil.com",
    (value) => {
      expect(safeNextPath(value)).toBe("/");
    },
  );

  it("keeps a double-encoded slash as an inert path", () => {
    expect(safeNextPath("/%252f%252fevil.com")).toBe("/%252f%252fevil.com");
  });

  it("never returns a value that starts with // or /\\ for hostile inputs", () => {
    const hostile = [
      "//evil.com", "/\\evil.com", "/.//evil.com", "/..//evil.com", "/a/..//evil.com",
      "/%2e%2e//evil.com", "/./\\evil.com", "/a/../\\evil.com", "/%2e/%2f/evil.com",
      "/a/%2e%2e/%2fevil.com", "/. //evil.com", "/;//evil.com", "/a/./.././/evil.com",
    ];
    for (const value of hostile) {
      const result = safeNextPath(value, "/fb");
      expect(result.startsWith("//"), value).toBe(false);
      expect(result.startsWith("/\\"), value).toBe(false);
    }
  });

  it("drops the #fragment on purpose", () => {
    expect(safeNextPath("/a?b=1#frag")).toBe("/a?b=1");
  });

  it.each(["/\tevil.com", "/\nfoo", "/a\\b", "/\u0000x"])(
    "rejects control characters and backslashes in %j",
    (value) => {
      expect(safeNextPath(value)).toBe("/");
    },
  );

  it.each<[unknown, string]>([
    ["", "empty"],
    [undefined, "undefined"],
    [42, "a number"],
    ["invite", "no leading slash"],
  ])("returns the fallback for %j (%s)", (value) => {
    expect(safeNextPath(value)).toBe("/");
    expect(safeNextPath(value, "/home")).toBe("/home");
  });

  it("honours a custom fallback for unsafe values", () => {
    expect(safeNextPath("//evil.com", "/groups")).toBe("/groups");
  });

  it("returns the fallback for a value over 500 characters", () => {
    expect(safeNextPath("/" + "a".repeat(500), "/home")).toBe("/home");
    expect(safeNextPath("/" + "a".repeat(499))).toBe("/" + "a".repeat(499));
  });
});
