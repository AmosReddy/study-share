import { describe, expect, it } from "vitest";
import { confirmLinkTarget, fakeGoogleReturnUrl } from "./redirect-target";

describe("confirmLinkTarget", () => {
  it("keeps the path and query of an address on this site", () => {
    expect(confirmLinkTarget("http://localhost:3000/invite/abc?x=1")).toBe("/invite/abc?x=1");
    expect(confirmLinkTarget("https://study-share.example/")).toBe("/");
  });

  it("accepts a plain same-site path", () => {
    expect(confirmLinkTarget("/invite/abc?x=1")).toBe("/invite/abc?x=1");
  });

  it("drops the fragment", () => {
    expect(confirmLinkTarget("http://localhost:3000/privacy#top")).toBe("/privacy");
  });

  it("never leaves the site, whatever the host in an absolute address", () => {
    expect(confirmLinkTarget("https://evil.com/x")).toBe("/x");
    expect(confirmLinkTarget("https://evil.com")).toBe("/");
  });

  it.each([
    "//evil.com",
    "/\\evil.com",
    "javascript:alert(1)",
    "/.//evil.com",
    "/%2f%2fevil.com",
    "%2F%2Fevil.com",
    "https://evil.com//evil.com",
    "https://evil.com/%2f%2fevil.com",
    "https://evil.com/.//evil.com",
    "data:text/html,hi",
    "invite",
    "",
    "http://",
  ])("turns %s into /", (value) => {
    expect(confirmLinkTarget(value)).toBe("/");
  });

  it("turns anything that is not text into /", () => {
    expect(confirmLinkTarget(null)).toBe("/");
    expect(confirmLinkTarget(undefined)).toBe("/");
    expect(confirmLinkTarget(["/a", "/b"])).toBe("/");
  });
});

describe("fakeGoogleReturnUrl", () => {
  const site = "http://localhost:3000";

  it("appends the code to an address on this site", () => {
    expect(fakeGoogleReturnUrl("http://localhost:3000/auth/callback?next=%2Fprivacy", "abc", site)).toBe(
      "http://localhost:3000/auth/callback?next=%2Fprivacy&code=abc",
    );
  });

  it.each([
    "https://evil.com/auth/callback",
    "http://localhost:3001/auth/callback",
    "https://localhost:3000/auth/callback",
    "//evil.com/auth/callback",
    "/auth/callback",
    "javascript:alert(1)",
    "",
  ])("refuses %s", (value) => {
    expect(fakeGoogleReturnUrl(value, "abc", site)).toBeNull();
  });

  it("refuses a missing value or code", () => {
    expect(fakeGoogleReturnUrl(null, "abc", site)).toBeNull();
    expect(fakeGoogleReturnUrl("http://localhost:3000/auth/callback", "", site)).toBeNull();
    expect(fakeGoogleReturnUrl("http://localhost:3000/auth/callback", null, site)).toBeNull();
  });
});
