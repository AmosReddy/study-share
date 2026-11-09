import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  The build runs with no settings at all, and prerenders pages that call getAuthProvider().
  Next.js stops a prerender at the first request-reading call (cookies()); anything that
  runs before it, like reading the settings, runs at build time and breaks the build.
  This guards that order. The mocked cookies() stands in for the prerender stopping.
  A future page that calls getRateLimiter() or getServerEnv() before a dynamic API is caught
  only by the CI quality job, which builds with no settings; that is the intended backstop.
*/
const { getServerEnv, cookies } = vi.hoisted(() => ({
  getServerEnv: vi.fn(() => {
    throw new Error("settings were read before the request-reading call");
  }),
  cookies: vi.fn(),
}));

const { getDb, createAccountDirectory } = vi.hoisted(() => ({
  getDb: vi.fn(() => ({ execute: vi.fn() })),
  createAccountDirectory: vi.fn(() => ({ sql: true })),
}));
const { createProfileStore } = vi.hoisted(() => ({ createProfileStore: vi.fn(() => ({ sqlProfiles: true })) }));
const { createGroupStore } = vi.hoisted(() => ({ createGroupStore: vi.fn(() => ({ sqlGroups: true })) }));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/server/env", () => ({ getServerEnv }));
vi.mock("@/server/db/client", () => ({ getDb }));
vi.mock("@/server/db/account-directory", () => ({ createAccountDirectory }));
vi.mock("@/server/db/profile-store", () => ({ createProfileStore }));
vi.mock("@/server/db/group-store", () => ({ createGroupStore }));

import { getFakeAuthStore, resetFakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { resetFakeGroupStore } from "@/server/adapters/fake-group-store";
import { getAccountDirectory, getAuthProvider, getGroupStore, getProfileStore } from "./services";

describe("getProfileStore", () => {
  beforeEach(() => {
    getDb.mockClear();
    createProfileStore.mockClear();
  });

  it("in fake mode is the fake store over the shared fake auth store, and never opens the database", async () => {
    getServerEnv.mockReturnValueOnce({ SERVICES_MODE: "fake" } as never);
    resetFakeAuthStore();
    expect(await getProfileStore().recordTermsAcceptance("nobody", "v1")).toBe(false);
    expect(getDb).not.toHaveBeenCalled();
    expect(createProfileStore).not.toHaveBeenCalled();
  });

  it("otherwise (every real deployment) is the SQL store", () => {
    getServerEnv.mockReturnValueOnce({ SERVICES_MODE: "real" } as never);
    expect(getProfileStore()).toEqual({ sqlProfiles: true });
    expect(createProfileStore).toHaveBeenCalledTimes(1);
  });
});

describe("getGroupStore", () => {
  beforeEach(() => {
    getDb.mockClear();
    createGroupStore.mockClear();
  });

  it("in fake mode is the fake store over the shared fake auth store, and never opens the database", async () => {
    getServerEnv.mockReturnValue({ SERVICES_MODE: "fake" } as never);
    try {
      resetFakeAuthStore();
      resetFakeGroupStore();
      const owner = "11111111-1111-4111-8111-111111111111";
      getFakeAuthStore().users.set(owner, {
        id: owner,
        email: "ada@example.test",
        password: null,
        displayName: "Ada",
        termsVersion: null,
        confirmed: true,
        identities: [],
      });
      const made = await getGroupStore().createGroup({
        ownerId: owner,
        name: "Maths",
        description: "",
        joinMode: "link",
        passwordHash: null,
        inviteToken: "token-1",
        inviteCode: "ABCDEFGH",
      });
      expect(made.ok).toBe(true);
      // A second call sees the same groups, and the names come from the fake auth store.
      const group = await getGroupStore().findByInvite({ code: "ABCDEFGH" });
      expect((await getGroupStore().listMembers(group!.id)).map((m) => m.displayName)).toEqual(["Ada"]);
      expect(getDb).not.toHaveBeenCalled();
      expect(createGroupStore).not.toHaveBeenCalled();
    } finally {
      resetFakeGroupStore();
      resetFakeAuthStore();
      getServerEnv.mockReset();
      getServerEnv.mockImplementation(() => {
        throw new Error("settings were read before the request-reading call");
      });
    }
  });

  it("otherwise (every real deployment) is the SQL store over the database, made once", () => {
    getServerEnv.mockReturnValue({ SERVICES_MODE: "real" } as never);
    try {
      expect(getGroupStore()).toEqual({ sqlGroups: true });
      expect(getGroupStore()).toBe(getGroupStore());
      expect(createGroupStore).toHaveBeenCalledTimes(1);
      expect(createGroupStore).toHaveBeenCalledWith(getDb.mock.results[0].value);
    } finally {
      getServerEnv.mockReset();
      getServerEnv.mockImplementation(() => {
        throw new Error("settings were read before the request-reading call");
      });
    }
  });
});

describe("getAccountDirectory", () => {
  beforeEach(() => {
    getDb.mockClear();
    createAccountDirectory.mockClear();
  });

  it("in fake mode is the fake directory over the shared fake auth store, and never opens the database", async () => {
    getServerEnv.mockReturnValueOnce({ SERVICES_MODE: "fake" } as never);
    resetFakeAuthStore();
    const directory = getAccountDirectory();
    expect(await directory.describeEmail("nobody@example.com")).toEqual({ kind: "none" });
    expect(getFakeAuthStore().users.size).toBe(0);
    expect(getDb).not.toHaveBeenCalled();
    expect(createAccountDirectory).not.toHaveBeenCalled();
  });

  it("otherwise is the SQL directory", () => {
    getServerEnv.mockReturnValueOnce({ SERVICES_MODE: "real" } as never);
    expect(getAccountDirectory()).toEqual({ sql: true });
    expect(createAccountDirectory).toHaveBeenCalledTimes(1);
  });
});

describe("getAuthProvider", () => {
  beforeEach(() => {
    getServerEnv.mockClear();
    cookies.mockReset();
  });

  it("stops at cookies() without reading the settings (so a prerender needs none)", async () => {
    const stop = new Error("prerender stopped: cookies() needs a real request");
    cookies.mockRejectedValue(stop);

    await expect(getAuthProvider()).rejects.toBe(stop);
    expect(getServerEnv).not.toHaveBeenCalled();
  });

  it("reads the settings once the request's cookies are available", async () => {
    cookies.mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} });

    await expect(getAuthProvider()).rejects.toThrow("settings were read");
    expect(getServerEnv).toHaveBeenCalledTimes(1);
  });
});
