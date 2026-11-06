import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAuthProvider, createFakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { AuthProviderError } from "@/server/ports/auth-provider";
import { TERMS_VERSION } from "@/shared/legal";
import { LINK_EXPIRED_LOGIN, LINK_EXPIRED_RESET, readEmailLink, verifyEmailLink } from "./email-link";

const SITE = "https://app.test";

function setup() {
  const jar = new Map<string, string>();
  const auth = createFakeAuthProvider({
    store: createFakeAuthStore(),
    cookies: {
      get: (name) => jar.get(name),
      set: (name, value) => void jar.set(name, value),
      delete: (name) => void jar.delete(name),
    },
  });
  return { auth };
}

const tokenOf = (url: string) => new URL(url, SITE).searchParams.get("token_hash")!;
const params = (query: Record<string, string>) => new URLSearchParams(query);

async function signUpLink(auth: ReturnType<typeof setup>["auth"], email = "a@x.com") {
  await auth.signUpWithPassword({ email, password: "my password", displayName: "A", termsVersion: TERMS_VERSION, redirectTo: `${SITE}/privacy?x=1` });
  return tokenOf(auth.outbox.lastFor(email)!.url);
}

describe("readEmailLink", () => {
  it("keeps the token and type and reduces redirect_to to a path on this site", () => {
    expect(readEmailLink(params({ token_hash: "t1", type: "email", redirect_to: "https://app.test/groups/1?tab=a" }))).toEqual({
      link: { tokenHash: "t1", type: "email", next: "/groups/1?tab=a" },
    });
    expect(readEmailLink(params({ token_hash: "t1", type: "recovery", redirect_to: "https://evil.com/x" }))).toEqual({
      link: { tokenHash: "t1", type: "recovery", next: "/x" },
    });
    expect(readEmailLink(params({ token_hash: "t1", type: "email", redirect_to: "//evil.com" }))).toMatchObject({
      link: { next: "/" },
    });
    expect(readEmailLink(params({ token_hash: "t1", type: "email" }))).toMatchObject({ link: { next: "/" } });
  });

  it.each([
    ["an unknown type", { token_hash: "t1", type: "magiclink" }, LINK_EXPIRED_LOGIN],
    ["no type", { token_hash: "t1" }, LINK_EXPIRED_LOGIN],
    ["a missing sign-up token", { type: "email" }, LINK_EXPIRED_LOGIN],
    ["a missing reset token", { type: "recovery" }, LINK_EXPIRED_RESET],
    ["an empty reset token", { token_hash: "", type: "recovery" }, LINK_EXPIRED_RESET],
  ])("sends %s to the expired-link screen", (_label, query, failure) => {
    expect(readEmailLink(params(query))).toEqual({ failure });
  });
});

describe("verifyEmailLink", () => {
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => error.mockRestore());

  it("a sign-up link confirms the address and goes on to next", async () => {
    const { auth } = setup();
    const tokenHash = await signUpLink(auth);
    expect(await verifyEmailLink(async () => auth, { tokenHash, type: "email", next: "/privacy?x=1" })).toBe("/privacy?x=1");
    expect(await auth.signInWithPassword({ email: "a@x.com", password: "my password" })).toEqual({ ok: true });
  });

  it("a reset link goes to /reset-password, signed in", async () => {
    const { auth } = setup();
    await signUpLink(auth);
    await auth.sendPasswordReset({ email: "a@x.com", redirectTo: `${SITE}/reset-password` });
    const tokenHash = tokenOf(auth.outbox.lastFor("a@x.com")!.url);
    expect(await verifyEmailLink(async () => auth, { tokenHash, type: "recovery", next: "/" })).toBe("/reset-password");
    expect(await auth.getUser()).not.toBeNull();
  });

  it("a failed sign-up link goes to the log-in expired screen, a failed reset link to the reset one", async () => {
    const { auth } = setup();
    expect(await verifyEmailLink(async () => auth, { tokenHash: "nope", type: "email", next: "/" })).toBe(LINK_EXPIRED_LOGIN);
    expect(await verifyEmailLink(async () => auth, { tokenHash: "nope", type: "recovery", next: "/" })).toBe(LINK_EXPIRED_RESET);
  });

  it("a used reset link goes to the reset expired screen", async () => {
    const { auth } = setup();
    await signUpLink(auth);
    await auth.sendPasswordReset({ email: "a@x.com", redirectTo: SITE });
    const tokenHash = tokenOf(auth.outbox.lastFor("a@x.com")!.url);
    await verifyEmailLink(async () => auth, { tokenHash, type: "recovery", next: "/" });
    expect(await verifyEmailLink(async () => auth, { tokenHash, type: "recovery", next: "/" })).toBe(LINK_EXPIRED_RESET);
  });

  it("an outage or a settings problem is the expired screen too, logged without the token", async () => {
    const { auth } = setup();
    vi.spyOn(auth, "confirmEmailToken").mockRejectedValue(new AuthProviderError("unavailable", "down"));
    expect(await verifyEmailLink(async () => auth, { tokenHash: "secret-token", type: "recovery", next: "/" })).toBe(LINK_EXPIRED_RESET);
    const broken = async () => Promise.reject(new Error("Missing or invalid environment variables: X"));
    expect(await verifyEmailLink(broken, { tokenHash: "secret-token", type: "email", next: "/" })).toBe(LINK_EXPIRED_LOGIN);
    expect(error).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret-token");
  });
});
