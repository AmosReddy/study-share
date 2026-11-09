import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));

import { getFakeAuthStore, resetFakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { createFakeGroupStore, resetFakeGroupStore } from "@/server/adapters/fake-group-store";
import { POST } from "./route";

async function seed() {
  const auth = getFakeAuthStore();
  auth.users.set("u1", {
    id: "u1",
    email: "ada@example.test",
    password: null,
    displayName: "Ada",
    termsVersion: null,
    confirmed: true,
    identities: [],
  });
  const groups = createFakeGroupStore(auth);
  const made = await groups.createGroup({
    ownerId: "u1",
    name: "Maths",
    description: "",
    joinMode: "link",
    passwordHash: null,
    inviteToken: "token-1",
    inviteCode: "ABCDEFGH",
  });
  if (!made.ok) throw new Error("seed failed");
  return { auth, groups };
}

describe("POST /api/test/reset", () => {
  beforeEach(() => {
    resetFakeAuthStore();
    resetFakeGroupStore();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetFakeAuthStore();
    resetFakeGroupStore();
  });

  test("is not found outside test mode and clears nothing", async () => {
    const { auth, groups } = await seed();
    for (const mode of ["real", "", undefined]) {
      vi.stubEnv("SERVICES_MODE", mode);
      expect((await POST()).status).toBe(404);
    }
    expect(auth.users.size).toBe(1);
    expect(await groups.listGroupsFor("u1")).toHaveLength(1);
  });

  test("in test mode it clears the fake auth store and the fake group store", async () => {
    vi.stubEnv("SERVICES_MODE", "fake");
    const { auth, groups } = await seed();
    expect((await POST()).status).toBe(204);
    expect(auth.users.size).toBe(0);
    // The store made before the reset sees it: the state is cleared in place.
    expect(await groups.listGroupsFor("u1")).toEqual([]);
    expect(await groups.findByInvite({ token: "token-1" })).toBeNull();
  });
});
