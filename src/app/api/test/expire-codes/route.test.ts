import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));

import { createFakeAuthProvider, getFakeAuthStore, resetFakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { POST } from "./route";

function jar() {
  const m = new Map<string, string>();
  return {
    get: (name: string) => m.get(name),
    set: (name: string, value: string) => void m.set(name, value),
    delete: (name: string) => void m.delete(name),
  };
}

const EMAIL = "ada@example.com";

async function pendingCode() {
  const provider = createFakeAuthProvider({ store: getFakeAuthStore(), cookies: jar() });
  await provider.signUpWithPassword({ email: EMAIL, password: "correct horse", displayName: "Ada", termsVersion: "2026-11" });
  return { provider, code: provider.outbox.lastCodeFor(EMAIL)!.code };
}

describe("POST /api/test/expire-codes", () => {
  beforeEach(() => resetFakeAuthStore());
  afterEach(() => {
    vi.unstubAllEnvs();
    resetFakeAuthStore();
  });

  test("is not found outside test mode and expires nothing", async () => {
    const { provider, code } = await pendingCode();
    for (const mode of ["real", "", undefined]) {
      vi.stubEnv("SERVICES_MODE", mode);
      const response = await POST();
      expect(response.status).toBe(404);
    }
    expect((await provider.verifyCode({ email: EMAIL, code, kind: "signup" })).ok).toBe(true);
  });

  test("in test mode it expires every code issued so far", async () => {
    vi.stubEnv("SERVICES_MODE", "fake");
    const { provider, code } = await pendingCode();
    const response = await POST();
    expect(response.status).toBe(204);
    expect(await provider.verifyCode({ email: EMAIL, code, kind: "signup" })).toEqual({
      ok: false,
      reason: "invalid_or_expired",
    });
    // A code sent afterwards works.
    await provider.resendSignUpCode({ email: EMAIL });
    const fresh = provider.outbox.lastCodeFor(EMAIL)!.code;
    expect((await provider.verifyCode({ email: EMAIL, code: fresh, kind: "signup" })).ok).toBe(true);
  });
});
