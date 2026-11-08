import { describe, expect, test } from "vitest";
import { createFakeAuthStore, resetFakeAuthStore, getFakeAuthStore, type FakeAuthStore } from "./fake-auth-provider";
import { createFakeProfileStore } from "./fake-profile-store";

/* Mirrors src/server/db/profile-store.int.test.ts over the fake store, for SERVICES_MODE=fake. */

function seedUser(store: FakeAuthStore): string {
  const id = crypto.randomUUID();
  store.users.set(id, {
    id,
    email: `${id}@example.invalid`,
    password: null,
    displayName: "Someone",
    termsVersion: null,
    confirmed: true,
    identities: [],
  });
  return id;
}

describe("fake profile store", () => {
  test("records the version with one acceptance time for both the terms and the age", async () => {
    const store = createFakeAuthStore();
    const id = seedUser(store);
    const before = Date.now();
    expect(await createFakeProfileStore(store).recordTermsAcceptance(id, "2026-11-06")).toBe(true);
    const record = store.profileTerms.get(id)!;
    expect(record.termsVersion).toBe("2026-11-06");
    expect(record.termsAcceptedAt).not.toBeNull();
    expect(record.termsAcceptedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(record.ageConfirmedAt).toEqual(record.termsAcceptedAt);
  });

  test("a later acceptance replaces an earlier one", async () => {
    const store = createFakeAuthStore();
    const id = seedUser(store);
    const profiles = createFakeProfileStore(store);
    await profiles.recordTermsAcceptance(id, "old");
    await profiles.recordTermsAcceptance(id, "new");
    expect(store.profileTerms.get(id)?.termsVersion).toBe("new");
  });

  test("clearing empties all three fields", async () => {
    const store = createFakeAuthStore();
    const id = seedUser(store);
    const profiles = createFakeProfileStore(store);
    await profiles.recordTermsAcceptance(id, "v1");
    expect(await profiles.clearTermsAcceptance(id)).toBe(true);
    expect(store.profileTerms.get(id)).toEqual({ termsVersion: null, termsAcceptedAt: null, ageConfirmedAt: null });
  });

  test("an unknown user changes nothing and answers false", async () => {
    const store = createFakeAuthStore();
    const profiles = createFakeProfileStore(store);
    expect(await profiles.recordTermsAcceptance("nobody", "v1")).toBe(false);
    expect(await profiles.clearTermsAcceptance("nobody")).toBe(false);
    expect(store.profileTerms.size).toBe(0);
  });

  test("works over the shared store by default, and a reset forgets the records", async () => {
    resetFakeAuthStore();
    const id = seedUser(getFakeAuthStore());
    expect(await createFakeProfileStore().recordTermsAcceptance(id, "v1")).toBe(true);
    resetFakeAuthStore();
    expect(getFakeAuthStore().profileTerms.size).toBe(0);
  });
});
