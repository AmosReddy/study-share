import { describe, expect, it, vi } from "vitest";
import { TERMS_VERSION } from "@/shared/legal";
import type { AuthUser } from "@/server/ports/auth-provider";
import { authRedirectTarget, getCurrentUser, withDisplayName } from "./session";

const { calls, getUser } = vi.hoisted(() => ({ calls: [] as string[], getUser: vi.fn() }));
vi.mock("next/server", () => ({ connection: async () => void calls.push("connection") }));
vi.mock("@/server/services", () => ({
  getAuthProvider: async () => {
    calls.push("getAuthProvider");
    return { getUser };
  },
}));

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

describe("getCurrentUser", () => {
  it("waits for a real request (connection) before the provider reads the person, because that reads the clock", async () => {
    // Next.js refuses Date.now() while prerendering a page, and a link's prefetch prerenders it with
    // the session cookies: "unstable value Date.now() while prerendering". Cookies still come first.
    getUser.mockImplementation(async () => {
      calls.push("getUser");
      return { id: "u1", email: "asha@x.com", displayName: "", termsVersion: null };
    });
    const found = await getCurrentUser();
    expect(calls).toEqual(["getAuthProvider", "connection", "getUser"]);
    expect(found?.displayName).toBe("asha");
  });
});
