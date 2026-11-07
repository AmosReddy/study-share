import { describe, expect, it } from "vitest";
import { TERMS_VERSION } from "@/shared/legal";
import type { AuthUser } from "@/server/ports/auth-provider";
import { authRedirectTarget, withDisplayName } from "./session";

const user = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: "u1",
  email: "asha@x.com",
  displayName: "Asha",
  termsVersion: TERMS_VERSION,
  ...over,
});

describe("authRedirectTarget", () => {
  it("sends a signed-out person to login with the path to come back to", () => {
    expect(authRedirectTarget(null, "/groups/1?tab=a")).toBe("/login?next=%2Fgroups%2F1%3Ftab%3Da");
  });

  it("lets a signed-in person through when terms are not required", () => {
    expect(authRedirectTarget(user({ termsVersion: null }), "/account")).toBeNull();
  });

  it("sends someone who has not accepted the terms to /welcome", () => {
    expect(authRedirectTarget(user({ termsVersion: null }), "/join", { requireTerms: true })).toBe("/welcome?next=%2Fjoin");
  });

  it("requires acceptance again when the terms version changed", () => {
    expect(authRedirectTarget(user({ termsVersion: "1999-01-01" }), "/join", { requireTerms: true })).toBe("/welcome?next=%2Fjoin");
  });

  it("lets through someone on the current terms version", () => {
    expect(authRedirectTarget(user(), "/join", { requireTerms: true })).toBeNull();
  });

  it("sends a signed-out person to login first even when terms are required", () => {
    expect(authRedirectTarget(null, "/join", { requireTerms: true })).toBe("/login?next=%2Fjoin");
  });

  it("never puts an unsafe path in next", () => {
    expect(authRedirectTarget(null, "//evil.com")).toBe("/login?next=%2F");
    expect(authRedirectTarget(user({ termsVersion: null }), "https://evil.com", { requireTerms: true })).toBe("/welcome?next=%2F");
  });
});

describe("withDisplayName", () => {
  it("fills an empty display name with the part of the email before @", () => {
    expect(withDisplayName(user({ displayName: "" })).displayName).toBe("asha");
    expect(withDisplayName(user({ displayName: "   " })).displayName).toBe("asha");
  });

  it("keeps a display name that is set", () => {
    expect(withDisplayName(user()).displayName).toBe("Asha");
  });
});
