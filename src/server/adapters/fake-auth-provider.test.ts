import { describe, expect, test } from "vitest";
import { createFakeAuthProvider, createFakeAuthStore, getFakeAuthStore, resetFakeAuthStore } from "./fake-auth-provider";

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
  redirectTo: "http://localhost:3000/after",
};

describe("getFakeAuthStore", () => {
  test("returns one shared store, so separately built providers see the same users and outbox", async () => {
    const a = createFakeAuthProvider({ store: getFakeAuthStore(), cookies: jar() });
    const b = createFakeAuthProvider({ store: getFakeAuthStore(), cookies: jar() });
    expect(getFakeAuthStore()).toBe(getFakeAuthStore());
    await a.signUpWithPassword({ ...input, email: "shared@example.com" });
    expect(b.outbox).toBe(a.outbox);
    expect(b.outbox.lastFor("shared@example.com")?.kind).toBe("confirm");
  });

  test("keeps the store on globalThis rather than in module state", () => {
    const store = getFakeAuthStore();
    const holders = Object.values(globalThis as unknown as Record<string, unknown>);
    expect(holders).toContain(store);
  });
});

describe("resetFakeAuthStore", () => {
  test("empties the shared store in place: users, tokens, Google codes and the outbox", async () => {
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
    expect(store.tokens.size).toBe(0);
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

describe("fake outbox", () => {
  test("records a confirm link shaped like the real one, with a unique unguessable token each time", async () => {
    const p = createFakeAuthProvider({ store: createFakeAuthStore(), cookies: jar() });
    await p.signUpWithPassword(input);
    await p.resendConfirmation({ email: input.email, redirectTo: input.redirectTo });
    const [first, second] = p.outbox.entries;
    expect(first.to).toBe("ada@example.com");
    expect(first.kind).toBe("confirm");
    expect(first.url.startsWith("/auth/confirm?")).toBe(true);
    const t1 = new URL(first.url, "http://x").searchParams.get("token_hash")!;
    const t2 = new URL(second.url, "http://x").searchParams.get("token_hash")!;
    expect(t1).toMatch(/^[0-9a-f-]{36}$/);
    expect(t1).not.toBe(t2);
    expect(p.outbox.lastFor("ADA@example.com")).toBe(second);
  });
});

describe("fake provider safety", () => {
  test("the session lives in the cookie jar, so a fresh provider on the same jar is signed in", async () => {
    const store = createFakeAuthStore();
    const cookies = jar();
    const a = createFakeAuthProvider({ store, cookies });
    await a.signUpWithPassword(input);
    const token = new URL(a.outbox.lastFor(input.email)!.url, "http://x").searchParams.get("token_hash")!;
    await a.confirmEmailToken({ tokenHash: token, type: "email" });
    const b = createFakeAuthProvider({ store, cookies });
    expect((await b.getUser())?.email).toBe("ada@example.com");
    expect(await createFakeAuthProvider({ store, cookies: jar() }).getUser()).toBeNull();
  });

  test("errors never contain a password or a token", async () => {
    const p = createFakeAuthProvider({ store: createFakeAuthStore(), cookies: jar() });
    await p.signUpWithPassword(input);
    const token = new URL(p.outbox.lastFor(input.email)!.url, "http://x").searchParams.get("token_hash")!;
    await p.confirmEmailToken({ tokenHash: token, type: "email" });
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

describe("failNextSignOut (test mode only)", () => {
  test("makes exactly the next signOut throw, keeps the session, and a retry succeeds", async () => {
    const store = createFakeAuthStore();
    const cookies = jar();
    const provider = createFakeAuthProvider({ store, cookies });
    await provider.signUpWithPassword({ ...input, email: "out@example.com" });
    const token = new URL(provider.outbox.lastFor("out@example.com")!.url, "http://x").searchParams.get("token_hash")!;
    await provider.confirmEmailToken({ tokenHash: token, type: "email" });

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
