import { describe, expect, it } from "vitest";
import { fakeGoogleReturnUrl } from "./redirect-target";

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
