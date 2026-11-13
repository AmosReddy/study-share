import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  The build runs with no settings at all, and prerenders pages that call getAuthProvider().
  Next.js stops a prerender at the first request-reading call (cookies()); anything that
  runs before it, like reading the settings, runs at build time and breaks the build.
  This guards that order. The mocked cookies() stands in for the prerender stopping.
  A future page that calls getRateLimiter() or getServerEnv() before a dynamic API is caught
  only by the CI quality job, which builds with no settings; that is the intended backstop.
*/
const { getServerEnv, cookies, connection, createSupabaseAuthProvider } = vi.hoisted(() => ({
  getServerEnv: vi.fn(() => {
    throw new Error("settings were read before the request-reading call");
  }),
  cookies: vi.fn(),
  // connection() is what makes a prerender wait for a real request; here a promise the tests settle.
  connection: vi.fn(),
  createSupabaseAuthProvider: vi.fn(),
}));

const { getDb, createAccountDirectory } = vi.hoisted(() => ({
  getDb: vi.fn(() => ({ execute: vi.fn() })),
  createAccountDirectory: vi.fn(() => ({ sql: true })),
}));
const { createProfileStore } = vi.hoisted(() => ({ createProfileStore: vi.fn(() => ({ sqlProfiles: true })) }));
const { createGroupStore } = vi.hoisted(() => ({ createGroupStore: vi.fn(() => ({ sqlGroups: true })) }));
const { createResourceStore } = vi.hoisted(() => ({ createResourceStore: vi.fn(() => ({ sqlResources: true })) }));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("next/server", () => ({ connection }));
vi.mock("@/server/adapters/supabase-auth-provider", () => ({ createSupabaseAuthProvider }));
vi.mock("@/server/env", () => ({ getServerEnv }));
vi.mock("@/server/db/client", () => ({ getDb }));
vi.mock("@/server/db/account-directory", () => ({ createAccountDirectory }));
vi.mock("@/server/db/profile-store", () => ({ createProfileStore }));
vi.mock("@/server/db/group-store", () => ({ createGroupStore }));
vi.mock("@/server/db/resource-store", () => ({ createResourceStore }));

import { getFakeAuthStore, resetFakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { resetFakeGroupStore } from "@/server/adapters/fake-group-store";
import { resetFakeResourceStore } from "@/server/adapters/fake-resource-store";
import { getAccountDirectory, getAuthProvider, getGroupStore, getProfileStore, getResourceStore } from "./services";

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

describe("getResourceStore", () => {
  beforeEach(() => {
    getDb.mockClear();
    createResourceStore.mockClear();
  });

  it("in fake mode is the fake store, sharing its state between calls, and never opens the database", async () => {
    getServerEnv.mockReturnValue({ SERVICES_MODE: "fake" } as never);
    try {
      resetFakeAuthStore();
      resetFakeGroupStore();
      resetFakeResourceStore();
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
      if (!made.ok) throw new Error("createGroup failed");
      const id = "22222222-2222-4222-8222-222222222222";
      await getResourceStore().createPending({
        id,
        groupId: made.group.id,
        uploaderId: owner,
        title: "Notes",
        subject: "",
        type: "notes",
        fileKey: "key-1",
        fileName: "notes.pdf",
        contentType: "application/pdf",
        sizeBytes: 10,
      });
      // A second call sees the same files, and the names come from the fake auth store.
      expect((await getResourceStore().findById(made.group.id, id))?.uploaderName).toBe("Ada");
      expect(getDb).not.toHaveBeenCalled();
      expect(createResourceStore).not.toHaveBeenCalled();
    } finally {
      resetFakeResourceStore();
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
      expect(getResourceStore()).toEqual({ sqlResources: true });
      expect(getResourceStore()).toBe(getResourceStore());
      expect(createResourceStore).toHaveBeenCalledTimes(1);
      expect(createResourceStore).toHaveBeenCalledWith(getDb.mock.results[0].value);
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
    connection.mockReset();
    connection.mockResolvedValue(undefined);
    createSupabaseAuthProvider.mockReset();
  });

  it("stops at cookies() without reading the settings (so a prerender needs none)", async () => {
    const stop = new Error("prerender stopped: cookies() needs a real request");
    cookies.mockRejectedValue(stop);

    await expect(getAuthProvider()).rejects.toBe(stop);
    expect(getServerEnv).not.toHaveBeenCalled();
  });

  it("stops at connection() too: nothing is read or built until there is a real request", async () => {
    cookies.mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} });
    connection.mockReturnValue(new Promise(() => {})); // a prerender never gets past this

    const pending = getAuthProvider();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(connection).toHaveBeenCalledTimes(1);
    expect(getServerEnv).not.toHaveBeenCalled();
    expect(createSupabaseAuthProvider).not.toHaveBeenCalled();
    void pending;
  });

  it("reads the cookies, then waits for connection(), and only then builds the Supabase client", async () => {
    // Building the client reads the clock (see supabase-auth-provider.test.ts), and Next.js refuses
    // that while it prerenders a page with the session cookies for a prefetch. So the client must not
    // exist before connection() has resolved. A real incident: this once ran connection() later, in
    // getCurrentUser, and every signed-in prefetch logged "unstable value Date.now()".
    const order: string[] = [];
    let release!: () => void;
    cookies.mockImplementation(async () => {
      order.push("cookies");
      return { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} };
    });
    connection.mockImplementation(async () => {
      order.push("connection:start");
      await new Promise<void>((resolve) => (release = resolve));
      order.push("connection:done");
    });
    getServerEnv.mockImplementationOnce(() => {
      order.push("env");
      return {
        SERVICES_MODE: "real",
        NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "service",
      } as never;
    });
    createSupabaseAuthProvider.mockImplementation(() => {
      order.push("client");
      return { built: true };
    });

    const provider = getAuthProvider();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(["cookies", "connection:start"]);
    expect(createSupabaseAuthProvider).not.toHaveBeenCalled();

    release();
    await expect(provider).resolves.toEqual({ built: true });
    expect(order).toEqual(["cookies", "connection:start", "connection:done", "env", "client"]);
  });

  it("reads the settings once the request's cookies are available", async () => {
    cookies.mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} });

    await expect(getAuthProvider()).rejects.toThrow("settings were read");
    expect(getServerEnv).toHaveBeenCalledTimes(1);
  });
});
