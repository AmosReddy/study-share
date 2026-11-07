import { describe, expect, test } from "vitest";
import { createFakeAccountDirectory } from "./fake-account-directory";
import { createFakeAuthProvider, createFakeAuthStore, getFakeAuthStore, type FakeAuthStore, type FakeUser } from "./fake-auth-provider";

/*
  Mirrors the Task 2 integration cases (src/server/db/account-directory.int.test.ts) over the
  fake store, so browser tests in SERVICES_MODE=fake see the same answers as the SQL directory.
*/

type Identity = { provider: "email" | "google"; verified?: boolean };

function seed(
  store: FakeAuthStore,
  o: { email: string; confirmed: boolean; password?: string | null; identities?: Identity[] },
): string {
  const user: FakeUser = {
    id: crypto.randomUUID(),
    email: o.email,
    password: o.password ?? null,
    displayName: "Someone",
    termsVersion: null,
    confirmed: o.confirmed,
    identities: (o.identities ?? []).map((i) => ({ provider: i.provider, verified: i.verified ?? false })),
  };
  store.users.set(user.id, user);
  return user.id;
}

const providersOf = (store: FakeAuthStore, userId: string) =>
  (store.users.get(userId)?.identities ?? []).map((i) => `${i.provider}:${i.verified}`).sort();

function jar() {
  const m = new Map<string, string>();
  return {
    get: (name: string) => m.get(name),
    set: (name: string, value: string) => void m.set(name, value),
    delete: (name: string) => void m.delete(name),
  };
}

describe("fake account directory: describeEmail", () => {
  test("says none for an address nobody signed up with", async () => {
    expect(await createFakeAccountDirectory(createFakeAuthStore()).describeEmail("nobody@example.com")).toEqual({
      kind: "none",
    });
  });

  test("says pending for an unconfirmed sign-up made through the fake provider, with the same id", async () => {
    const store = createFakeAuthStore();
    const provider = createFakeAuthProvider({ store, cookies: jar() });
    const { userId } = await provider.signUpWithPassword({
      email: "ada@example.com",
      password: "correct horse",
      displayName: "Ada",
      termsVersion: "2026-11",
    });
    expect(await createFakeAccountDirectory(store).describeEmail("ada@example.com")).toEqual({ kind: "pending", userId });
  });

  test("says confirmed with the email provider and a password once the code is used", async () => {
    const store = createFakeAuthStore();
    const provider = createFakeAuthProvider({ store, cookies: jar() });
    const { userId } = await provider.signUpWithPassword({
      email: "ada@example.com",
      password: "correct horse",
      displayName: "Ada",
      termsVersion: "2026-11",
    });
    const code = provider.outbox.lastCodeFor("ada@example.com")!.code;
    await provider.verifyCode({ email: "ada@example.com", code, kind: "signup" });
    expect(await createFakeAccountDirectory(store).describeEmail("ada@example.com")).toEqual({
      kind: "confirmed",
      userId,
      providers: ["email"],
      hasPassword: true,
    });
  });

  test("says confirmed with only Google and no password for a fake Google sign-in", async () => {
    const store = createFakeAuthStore();
    const provider = createFakeAuthProvider({ store, cookies: jar() });
    const { url } = await provider.startGoogleSignIn({ redirectTo: "http://localhost:3000/auth/callback" });
    await provider.completeOAuth(new URL(url, "http://localhost").searchParams.get("code")!);
    const user = await provider.getUser();
    expect(await createFakeAccountDirectory(store).describeEmail(user!.email)).toEqual({
      kind: "confirmed",
      userId: user!.id,
      providers: ["google"],
      hasPassword: false,
    });
  });

  test("lists both providers, sorted, for a Google user who also has an email identity and a password", async () => {
    const store = createFakeAuthStore();
    const userId = seed(store, {
      email: "both@example.com",
      confirmed: true,
      password: "pw",
      identities: [
        { provider: "google", verified: true },
        { provider: "email", verified: true },
      ],
    });
    expect(await createFakeAccountDirectory(store).describeEmail("both@example.com")).toEqual({
      kind: "confirmed",
      userId,
      providers: ["email", "google"],
      hasPassword: true,
    });
  });

  test("an empty password counts as no password", async () => {
    const store = createFakeAuthStore();
    seed(store, { email: "g@example.com", confirmed: true, password: "", identities: [{ provider: "google", verified: true }] });
    expect(await createFakeAccountDirectory(store).describeEmail("g@example.com")).toMatchObject({ hasPassword: false });
  });

  test("a user with a Google identity is never pending, even when unconfirmed", async () => {
    const store = createFakeAuthStore();
    const userId = seed(store, {
      email: "linked@example.com",
      confirmed: false,
      password: "pw",
      identities: [
        { provider: "email", verified: false },
        { provider: "google", verified: true },
      ],
    });
    expect(await createFakeAccountDirectory(store).describeEmail("linked@example.com")).toEqual({
      kind: "confirmed",
      userId,
      providers: ["email", "google"],
      hasPassword: true,
    });
  });

  test("ignores case and surrounding spaces in the address", async () => {
    const store = createFakeAuthStore();
    const userId = seed(store, { email: "case@example.com", confirmed: false, password: "pw" });
    expect(await createFakeAccountDirectory(store).describeEmail("  CASE@example.com ")).toEqual({ kind: "pending", userId });
  });
});

describe("fake account directory: removePendingSignup", () => {
  test("deletes an unconfirmed sign-up (with its codes and sessions) and returns true; a new sign-up gets a new id", async () => {
    const store = createFakeAuthStore();
    const provider = createFakeAuthProvider({ store, cookies: jar() });
    const input = { email: "ada@example.com", password: "correct horse", displayName: "Ada", termsVersion: "2026-11" };
    const first = await provider.signUpWithPassword(input);
    const oldCode = provider.outbox.lastCodeFor("ada@example.com")!.code;
    const directory = createFakeAccountDirectory(store);

    expect(await directory.removePendingSignup("  ADA@example.com")).toBe(true);
    expect(store.users.has(first.userId)).toBe(false);
    expect(await directory.describeEmail("ada@example.com")).toEqual({ kind: "none" });
    expect(await directory.removePendingSignup("ada@example.com")).toBe(false);

    const second = await provider.signUpWithPassword({ ...input, password: "a newer password" });
    expect(second.userId).not.toBe(first.userId);
    const newCode = provider.outbox.lastCodeFor("ada@example.com")!.code;
    if (oldCode !== newCode) {
      expect((await provider.verifyCode({ email: "ada@example.com", code: oldCode, kind: "signup" })).ok).toBe(false);
    }
    expect(await provider.verifyCode({ email: "ada@example.com", code: newCode, kind: "signup" })).toEqual({
      ok: true,
      userId: second.userId,
    });
  });

  test("returns false and deletes nothing for a confirmed user", async () => {
    const store = createFakeAuthStore();
    const userId = seed(store, { email: "c@example.com", confirmed: true, password: "pw", identities: [{ provider: "email", verified: true }] });
    expect(await createFakeAccountDirectory(store).removePendingSignup("c@example.com")).toBe(false);
    expect(store.users.has(userId)).toBe(true);
  });

  test("does not delete an unconfirmed user who has a Google identity", async () => {
    const store = createFakeAuthStore();
    const userId = seed(store, {
      email: "linked@example.com",
      confirmed: false,
      password: "pw",
      identities: [
        { provider: "email", verified: false },
        { provider: "google", verified: true },
      ],
    });
    expect(await createFakeAccountDirectory(store).removePendingSignup("linked@example.com")).toBe(false);
    expect(store.users.has(userId)).toBe(true);
    expect(providersOf(store, userId)).toEqual(["email:false", "google:true"]);
  });

  test("returns false for an address nobody signed up with", async () => {
    expect(await createFakeAccountDirectory(createFakeAuthStore()).removePendingSignup("nobody@example.com")).toBe(false);
  });

  test("of two simultaneous calls exactly one is told true", async () => {
    const store = createFakeAuthStore();
    seed(store, { email: "race@example.com", confirmed: false, password: "pw", identities: [{ provider: "email" }] });
    const directory = createFakeAccountDirectory(store);
    const results = await Promise.all([directory.removePendingSignup("race@example.com"), directory.removePendingSignup("race@example.com")]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe("fake account directory: repairAfterGoogle", () => {
  test("removes an unverified email identity of a Google user and reports it", async () => {
    const store = createFakeAuthStore();
    const userId = seed(store, {
      email: "r@example.com",
      confirmed: true,
      identities: [
        { provider: "email", verified: false },
        { provider: "google", verified: true },
      ],
    });
    expect(await createFakeAccountDirectory(store).repairAfterGoogle(userId)).toEqual({ hadPendingEmailSignup: true });
    expect(providersOf(store, userId)).toEqual(["google:true"]);
    expect(store.users.has(userId)).toBe(true);
  });

  test("reports false when there is no email identity", async () => {
    const store = createFakeAuthStore();
    const userId = seed(store, { email: "g@example.com", confirmed: true, identities: [{ provider: "google", verified: true }] });
    expect(await createFakeAccountDirectory(store).repairAfterGoogle(userId)).toEqual({ hadPendingEmailSignup: false });
    expect(providersOf(store, userId)).toEqual(["google:true"]);
  });

  test("removes nothing for a user without a Google identity, even with an unverified email identity", async () => {
    const store = createFakeAuthStore();
    const userId = seed(store, { email: "p@example.com", confirmed: true, password: "pw", identities: [{ provider: "email", verified: false }] });
    expect(await createFakeAccountDirectory(store).repairAfterGoogle(userId)).toEqual({ hadPendingEmailSignup: false });
    expect(providersOf(store, userId)).toEqual(["email:false"]);
  });

  test("never touches a verified email identity", async () => {
    const store = createFakeAuthStore();
    const userId = seed(store, {
      email: "v@example.com",
      confirmed: true,
      identities: [
        { provider: "email", verified: true },
        { provider: "google", verified: true },
      ],
    });
    expect(await createFakeAccountDirectory(store).repairAfterGoogle(userId)).toEqual({ hadPendingEmailSignup: false });
    expect(providersOf(store, userId)).toEqual(["email:true", "google:true"]);
  });

  test("never touches another user's identity, and an unknown user reports false", async () => {
    const store = createFakeAuthStore();
    const userId = seed(store, { email: "g@example.com", confirmed: true, identities: [{ provider: "google", verified: false }] });
    const otherId = seed(store, { email: "o@example.com", confirmed: false, identities: [{ provider: "email", verified: false }] });
    const directory = createFakeAccountDirectory(store);
    expect(await directory.repairAfterGoogle(userId)).toEqual({ hadPendingEmailSignup: false });
    expect(await directory.repairAfterGoogle("no-such-user")).toEqual({ hadPendingEmailSignup: false });
    expect(providersOf(store, userId)).toEqual(["google:false"]);
    expect(providersOf(store, otherId)).toEqual(["email:false"]);
  });
});

describe("fake account directory over the shared store", () => {
  test("defaults to the globalThis store the fake provider uses", async () => {
    expect(createFakeAccountDirectory()).toBeTruthy();
    const store = getFakeAuthStore();
    const before = store.users.size;
    const email = `shared-${crypto.randomUUID()}@example.com`;
    const userId = seed(store, { email, confirmed: false, password: "pw" });
    try {
      expect(await createFakeAccountDirectory().describeEmail(email)).toEqual({ kind: "pending", userId });
    } finally {
      store.users.delete(userId);
    }
    expect(store.users.size).toBe(before);
  });
});
