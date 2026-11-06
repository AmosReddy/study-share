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

  /*
    Real Supabase keeps the FIRST password when an unconfirmed address signs up again (checked
    live with npm run check:auth-behaviour). So a confirmation link may belong to a pending
    account someone else created with their own password. The link therefore confirms the
    address but does not leave the person signed in: they log in with their own password, and
    if it does not work, Forgot password replaces it.
  */
  it("a sign-up link confirms the address, signs out again and asks the person to log in", async () => {
    const { auth } = setup();
    const tokenHash = await signUpLink(auth);
    expect(await verifyEmailLink(async () => auth, { tokenHash, type: "email", next: "/privacy?x=1" })).toBe(
      "/login?confirmed=1&next=%2Fprivacy%3Fx%3D1",
    );
    expect(await auth.getUser()).toBeNull();
    expect(await auth.signInWithPassword({ email: "a@x.com", password: "my password" })).toEqual({ ok: true });
  });

  it("leaves next out of the log-in address when it is the home page", async () => {
    const { auth } = setup();
    const tokenHash = await signUpLink(auth);
    expect(await verifyEmailLink(async () => auth, { tokenHash, type: "email", next: "/" })).toBe("/login?confirmed=1");
  });

  it("still asks the person to log in when signing out fails, and logs one fixed line", async () => {
    const { auth } = setup();
    const tokenHash = await signUpLink(auth);
    vi.spyOn(auth, "signOut").mockRejectedValue(new AuthProviderError("unavailable", "vendor text"));
    expect(await verifyEmailLink(async () => auth, { tokenHash, type: "email", next: "/" })).toBe("/login?confirmed=1");
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain(tokenHash);
  });

  it("a pre-registered address: the person who confirms cannot log in with their own password", async () => {
    const { auth } = setup();
    // Someone else signs up first with their own password and never confirms.
    await auth.signUpWithPassword({ email: "v@x.com", password: "other's password", displayName: "X", termsVersion: TERMS_VERSION, redirectTo: SITE });
    // The real owner signs up later and confirms through the link they receive.
    await auth.signUpWithPassword({ email: "v@x.com", password: "owner's password", displayName: "V", termsVersion: TERMS_VERSION, redirectTo: SITE });
    const tokenHash = tokenOf(auth.outbox.lastFor("v@x.com")!.url);
    expect(await verifyEmailLink(async () => auth, { tokenHash, type: "email", next: "/" })).toBe("/login?confirmed=1");
    // They are not left signed in to an account whose password someone else knows.
    expect(await auth.getUser()).toBeNull();
    expect(await auth.signInWithPassword({ email: "v@x.com", password: "owner's password" })).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
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
