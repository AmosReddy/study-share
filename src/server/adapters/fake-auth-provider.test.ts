import { describe, expect, test, vi } from "vitest";
import { CODE_LENGTH } from "@/shared/auth-schemas";
import { createFakeAccountDirectory } from "./fake-account-directory";
import {
  EMAIL_INTERVAL_MS,
  FAKE_SESSION_MS,
  createFakeAuthProvider,
  createFakeAuthStore,
  expireAllCodes,
  getFakeAuthStore,
  resetFakeAuthStore,
} from "./fake-auth-provider";

function jar() {
  const m = new Map<string, string>();
  return {
    get: (name: string) => m.get(name),
    set: (name: string, value: string) => void m.set(name, value),
    delete: (name: string) => void m.delete(name),
  };
}

const input = {
  email: "Ada@Example.com",
  password: "correct horse",
  displayName: "Ada",
  termsVersion: "2026-11",
};

/** Signs up and confirms through the emailed code, which also signs this provider's browser in. */
async function confirmByCode(p: ReturnType<typeof createFakeAuthProvider>, email: string) {
  await p.verifyCode({ email, code: p.outbox.lastCodeFor(email)!.code, kind: "signup" });
}

describe("getFakeAuthStore", () => {
  test("returns one shared store, so separately built providers see the same users and outbox", async () => {
    const a = createFakeAuthProvider({ store: getFakeAuthStore(), cookies: jar() });
    const b = createFakeAuthProvider({ store: getFakeAuthStore(), cookies: jar() });
    expect(getFakeAuthStore()).toBe(getFakeAuthStore());
    await a.signUpWithPassword({ ...input, email: "shared@example.com" });
    expect(b.outbox).toBe(a.outbox);
    expect(b.outbox.lastCodeFor("shared@example.com")?.purpose).toBe("signup");
  });

  test("keeps the store on globalThis rather than in module state", () => {
    const store = getFakeAuthStore();
    const holders = Object.values(globalThis as unknown as Record<string, unknown>);
    expect(holders).toContain(store);
  });
});

describe("resetFakeAuthStore", () => {
  test("empties the shared store in place: users, codes, Google codes and the outbox", async () => {
    const store = getFakeAuthStore();
    const cookies = jar();
    const p = createFakeAuthProvider({ store, cookies });
    await p.signUpWithPassword({ ...input, email: "reset@example.com" });
    await p.startGoogleSignIn({ redirectTo: "http://localhost:3000/auth/callback" });
    await p.completeOAuth([...store.oauthCodes][0]);
    await p.acceptTerms({ termsVersion: "2026-11" });
    await p.startGoogleSignIn({ redirectTo: "http://localhost:3000/auth/callback" });

    resetFakeAuthStore();

    expect(getFakeAuthStore()).toBe(store);
    expect(store.users.size).toBe(0);
    expect(store.codes.size).toBe(0);
    expect(store.oauthCodes.size).toBe(0);
    expect(store.outbox.entries).toHaveLength(0);
    expect(p.outbox).toBe(store.outbox);
    // The Google account starts over, so it has not accepted the terms.
    await p.startGoogleSignIn({ redirectTo: "http://localhost:3000/auth/callback" });
    await p.completeOAuth([...store.oauthCodes][0]);
    expect((await p.getUser())?.termsVersion).toBeNull();
  });
});

describe("createFakeAuthStore", () => {
  test("makes isolated stores", async () => {
    const a = createFakeAuthProvider({ store: createFakeAuthStore(), cookies: jar() });
    const b = createFakeAuthProvider({ store: createFakeAuthStore(), cookies: jar() });
    await a.signUpWithPassword(input);
    expect(a.outbox.entries).toHaveLength(1);
    expect(b.outbox.entries).toHaveLength(0);
  });
});

describe("fake provider safety", () => {
  test("the session lives in the cookie jar, so a fresh provider on the same jar is signed in", async () => {
    const store = createFakeAuthStore();
    const cookies = jar();
    const a = createFakeAuthProvider({ store, cookies });
    await a.signUpWithPassword(input);
    await confirmByCode(a, input.email);
    const b = createFakeAuthProvider({ store, cookies });
    expect((await b.getUser())?.email).toBe("ada@example.com");
    expect(await createFakeAuthProvider({ store, cookies: jar() }).getUser()).toBeNull();
  });

  test("errors never contain a password or a code", async () => {
    const p = createFakeAuthProvider({ store: createFakeAuthStore(), cookies: jar() });
    await p.signUpWithPassword(input);
    const token = p.outbox.lastCodeFor(input.email)!.code;
    await confirmByCode(p, input.email);
    const errors: string[] = [];
    for (const attempt of [
      () => p.updatePassword("short"),
      () => createFakeAuthProvider({ store: createFakeAuthStore(), cookies: jar() }).acceptTerms({ termsVersion: "x" }),
      () => p.signUpWithPassword({ ...input, email: "weak@example.com", password: "short" }),
    ]) {
      await attempt().catch((e: Error) => errors.push(e.message));
    }
    expect(errors).toHaveLength(3);
    for (const message of errors) {
      expect(message).not.toContain(token);
      expect(message).not.toContain(input.password);
    }
  });

  test("a weak password at sign-up is rejected with weak_password and creates nothing", async () => {
    const p = createFakeAuthProvider({ store: createFakeAuthStore(), cookies: jar() });
    await expect(p.signUpWithPassword({ ...input, password: "1234567" })).rejects.toMatchObject({
      code: "weak_password",
    });
    expect(p.outbox.entries).toHaveLength(0);
  });
});

const codeInput = { email: "Ada@Example.com", password: "correct horse", displayName: "Ada", termsVersion: "2026-11" };

describe("fake codes", () => {
  test("a code sign-up records a code email { to, kind: code, purpose, code } with CODE_LENGTH random digits", async () => {
    const p = createFakeAuthProvider({ store: createFakeAuthStore(), cookies: jar() });
    await p.signUpWithPassword(codeInput);
    const sent = p.outbox.latestFor("ada@example.com");
    expect(sent).toEqual({ to: "ada@example.com", kind: "code", purpose: "signup", code: expect.any(String) });
    expect(sent?.kind === "code" && sent.code).toMatch(new RegExp(`^\\d{${CODE_LENGTH}}$`));
    expect(p.outbox.lastCodeFor("ADA@example.com")).toBe(sent);
  });

  test("codes are random, not a fixed or counting value", async () => {
    const store = createFakeAuthStore();
    const p = createFakeAuthProvider({ store, cookies: jar() });
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      await p.signUpWithPassword({ ...codeInput, email: `r${i}@example.com` });
      codes.add(p.outbox.lastCodeFor(`r${i}@example.com`)!.code);
    }
    expect(codes.size).toBeGreaterThan(15);
  });

  test("a password reset code is recorded with purpose recovery", async () => {
    const p = createFakeAuthProvider({ store: createFakeAuthStore(), cookies: jar() });
    await p.signUpWithPassword(codeInput);
    await p.sendPasswordResetCode({ email: "ada@example.com" });
    expect(p.outbox.latestFor("ada@example.com")).toMatchObject({ kind: "code", purpose: "recovery" });
  });

  test("expireAllCodes defaults to the shared store, and a reset clears the expiry and every code", async () => {
    const store = getFakeAuthStore();
    resetFakeAuthStore();
    const p = createFakeAuthProvider({ store, cookies: jar() });
    await p.signUpWithPassword({ ...codeInput, email: "expire@example.com" });
    const first = p.outbox.lastCodeFor("expire@example.com")!.code;
    expireAllCodes();
    expect(await p.verifyCode({ email: "expire@example.com", code: first, kind: "signup" })).toEqual({
      ok: false,
      reason: "invalid_or_expired",
    });
    resetFakeAuthStore();
    expect(store.codes.size).toBe(0);
    expect(store.sessions.size).toBe(0);
    await p.signUpWithPassword({ ...codeInput, email: "expire@example.com" });
    const fresh = p.outbox.lastCodeFor("expire@example.com")!.code;
    expect((await p.verifyCode({ email: "expire@example.com", code: fresh, kind: "signup" })).ok).toBe(true);
    resetFakeAuthStore();
  });

  test("errors never contain a code or a password", async () => {
    const store = createFakeAuthStore();
    const p = createFakeAuthProvider({ store, cookies: jar() });
    const { userId } = await p.signUpWithPassword(codeInput);
    const code = p.outbox.lastCodeFor(codeInput.email)!.code;
    const errors: string[] = [];
    for (const attempt of [
      () => p.updatePassword("short"),
      () => p.scramblePassword("no-such-user"),
      () => p.signUpWithPassword({ ...codeInput, email: "weak@example.com", password: "short" }),
    ]) {
      await attempt().catch((e: Error) => errors.push(`${e.message} ${e.stack}`));
    }
    expect(errors).toHaveLength(3);
    for (const message of errors) {
      expect(message).not.toContain(code);
      expect(message).not.toContain(codeInput.password);
      expect(message).not.toContain(userId);
    }
  });
});

describe("fake email interval (test switch)", () => {
  test("is off by default, so repeat emails work as the existing browser tests expect", async () => {
    const p = createFakeAuthProvider({ store: createFakeAuthStore(), cookies: jar() });
    await p.signUpWithPassword(codeInput);
    await p.signUpWithPassword(codeInput);
    await p.resendSignUpCode({ email: codeInput.email });
    expect(p.outbox.entries).toHaveLength(3);
  });

  test("when on, refuses a second email of the same kind to one address until EMAIL_INTERVAL_MS has passed", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-07T10:00:00Z") });
    try {
      const store = createFakeAuthStore();
      store.enforceEmailInterval = true;
      const p = createFakeAuthProvider({ store, cookies: jar() });
      await p.signUpWithPassword(codeInput);
      await expect(p.resendSignUpCode({ email: codeInput.email })).rejects.toMatchObject({ code: "rate_limited" });
      // A different kind of email is tracked on its own (GoTrue keeps a time per kind).
      await expect(p.sendPasswordResetCode({ email: codeInput.email })).resolves.toBeUndefined();
      vi.advanceTimersByTime(EMAIL_INTERVAL_MS);
      await expect(p.resendSignUpCode({ email: codeInput.email })).resolves.toBeUndefined();
      // Nothing is sent (and nothing limited) for an unknown address.
      await expect(p.resendSignUpCode({ email: "nobody@example.com" })).resolves.toBeUndefined();
      await expect(p.resendSignUpCode({ email: "nobody@example.com" })).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test("follows the account, not the address: delete the pending account, then a new sign-up of the address within the interval works (fact r)", async () => {
    const store = createFakeAuthStore();
    store.enforceEmailInterval = true;
    const p = createFakeAuthProvider({ store, cookies: jar() });
    const first = await p.signUpWithPassword(codeInput);
    expect(await createFakeAccountDirectory(store).removePendingSignup(codeInput.email)).toBe(true);
    const second = await p.signUpWithPassword({ ...codeInput, password: "a newer password" });
    expect(second.userId).not.toBe(first.userId);
    expect(p.outbox.entries).toHaveLength(2);
  });

  test("is switched off and forgotten by a reset", () => {
    const store = getFakeAuthStore();
    store.enforceEmailInterval = true;
    store.lastEmailAt.set("x@example.com:signup", Date.now());
    resetFakeAuthStore();
    expect(store.enforceEmailInterval).toBe(false);
    expect(store.lastEmailAt.size).toBe(0);
  });
});

describe("fake sessions", () => {
  test("each sign-in is its own session; signing out ends only this one", async () => {
    const store = createFakeAuthStore();
    const a = createFakeAuthProvider({ store, cookies: jar() });
    const b = createFakeAuthProvider({ store, cookies: jar() });
    await a.signUpWithPassword(codeInput);
    await a.verifyCode({ email: codeInput.email, code: a.outbox.lastCodeFor(codeInput.email)!.code, kind: "signup" });
    await b.signInWithPassword({ email: codeInput.email, password: codeInput.password });
    await a.signOut();
    expect(await a.getUser()).toBeNull();
    expect(await b.getUser()).not.toBeNull();
  });

  test("the cookie holds a session id, not the user id", async () => {
    const store = createFakeAuthStore();
    const cookies = jar();
    const p = createFakeAuthProvider({ store, cookies });
    const { userId } = await p.signUpWithPassword(codeInput);
    await p.verifyCode({ email: codeInput.email, code: p.outbox.lastCodeFor(codeInput.email)!.code, kind: "signup" });
    const value = cookies.get("fake-auth-session");
    expect(value).toBeTruthy();
    expect(value).not.toBe(userId);
  });
});

describe("fake Google", () => {
  test("the sign-in URL asks for the account chooser (prompt=select_account)", async () => {
    const p = createFakeAuthProvider({ store: createFakeAuthStore(), cookies: jar() });
    const { url } = await p.startGoogleSignIn({ redirectTo: "http://localhost:3000/auth/callback" });
    const parsed = new URL(url, "http://localhost");
    expect(parsed.pathname).toBe("/fake-google");
    expect(parsed.searchParams.get("prompt")).toBe("select_account");
    expect(parsed.searchParams.get("code")).toBeTruthy();
  });
});

describe("failNextSignOut (test mode only)", () => {
  test("makes exactly the next signOut throw, keeps the session, and a retry succeeds", async () => {
    const store = createFakeAuthStore();
    const cookies = jar();
    const provider = createFakeAuthProvider({ store, cookies });
    await provider.signUpWithPassword({ ...input, email: "out@example.com" });
    await confirmByCode(provider, "out@example.com");

    store.failNextSignOut = true;
    await expect(provider.signOut()).rejects.toMatchObject({ name: "AuthProviderError", code: "unavailable" });
    expect(await provider.getUser()).not.toBeNull();

    await provider.signOut();
    expect(await provider.getUser()).toBeNull();
  });

  test("is cleared by a reset", () => {
    const store = getFakeAuthStore();
    store.failNextSignOut = true;
    resetFakeAuthStore();
    expect(store.failNextSignOut).toBe(false);
  });
});

describe("session lifetime", () => {
  test("getUser checks the session's expiry against the clock, as the real token check does", async () => {
    vi.useFakeTimers();
    try {
      const p = createFakeAuthProvider({ store: createFakeAuthStore(), cookies: jar() });
      await p.signUpWithPassword({ ...input, email: "expiry@example.com" });
      await confirmByCode(p, "expiry@example.com");
      expect((await p.getUser())?.email).toBe("expiry@example.com");
      vi.advanceTimersByTime(FAKE_SESSION_MS + 1);
      expect(await p.getUser()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
