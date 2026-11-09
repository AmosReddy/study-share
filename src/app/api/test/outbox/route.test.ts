import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));

import { NextRequest } from "next/server";
import { createFakeAuthProvider, getFakeAuthStore, resetFakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { GET } from "./route";

function jar() {
  const m = new Map<string, string>();
  return {
    get: (name: string) => m.get(name),
    set: (name: string, value: string) => void m.set(name, value),
    delete: (name: string) => void m.delete(name),
  };
}

const get = (email: string) => GET(new NextRequest(`http://localhost/api/test/outbox?email=${encodeURIComponent(email)}`));
const signUp = { password: "correct horse", displayName: "Ada", termsVersion: "2026-11" };

describe("GET /api/test/outbox", () => {
  beforeEach(() => resetFakeAuthStore());
  afterEach(() => {
    vi.unstubAllEnvs();
    resetFakeAuthStore();
  });

  test("is not found outside test mode, and reveals nothing", async () => {
    const provider = createFakeAuthProvider({ store: getFakeAuthStore(), cookies: jar() });
    await provider.signUpWithPassword({ ...signUp, email: "ada@example.com" });
    for (const mode of ["real", "", undefined]) {
      vi.stubEnv("SERVICES_MODE", mode);
      const response = await get("ada@example.com");
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not found");
    }
  });

  test("returns { code: null, purpose: null } when nothing was sent to the address", async () => {
    vi.stubEnv("SERVICES_MODE", "fake");
    const response = await get("nobody@example.com");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ code: null, purpose: null });
  });

  test("returns { code, purpose } when the newest email is a code", async () => {
    vi.stubEnv("SERVICES_MODE", "fake");
    const provider = createFakeAuthProvider({ store: getFakeAuthStore(), cookies: jar() });
    await provider.signUpWithPassword({ ...signUp, email: "ada@example.com" });
    const code = provider.outbox.lastCodeFor("ada@example.com")!.code;
    expect(await (await get("ada@example.com")).json()).toEqual({ code, purpose: "signup" });

    await provider.sendPasswordResetCode({ email: "ada@example.com" });
    const recovery = provider.outbox.lastCodeFor("ada@example.com")!.code;
    expect(await (await get("ada@example.com")).json()).toEqual({ code: recovery, purpose: "recovery" });
  });
});
