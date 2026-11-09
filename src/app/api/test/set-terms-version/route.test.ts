import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));

import { NextRequest } from "next/server";
import { getFakeAuthStore, resetFakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { POST } from "./route";

const EMAIL = "terms@example.invalid";

function seed() {
  const id = crypto.randomUUID();
  getFakeAuthStore().users.set(id, {
    id,
    email: EMAIL,
    password: null,
    displayName: "Someone",
    termsVersion: "2026-11-06",
    confirmed: true,
    identities: [],
  });
  return id;
}

const post = (query: string) => POST(new NextRequest(`http://localhost/api/test/set-terms-version?${query}`, { method: "POST" }));

describe("POST /api/test/set-terms-version", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetFakeAuthStore();
  });

  test("is not found outside test mode and changes nothing", async () => {
    const id = seed();
    for (const mode of ["real", "", undefined]) {
      vi.stubEnv("SERVICES_MODE", mode);
      expect((await post(`email=${EMAIL}&version=1999-01-01`)).status).toBe(404);
    }
    expect(getFakeAuthStore().users.get(id)?.termsVersion).toBe("2026-11-06");
  });

  test("in test mode sets the version of that account", async () => {
    vi.stubEnv("SERVICES_MODE", "fake");
    const id = seed();
    expect((await post(`email=${EMAIL}&version=1999-01-01`)).status).toBe(204);
    expect(getFakeAuthStore().users.get(id)?.termsVersion).toBe("1999-01-01");
  });

  test("an unknown account or a missing version is not found", async () => {
    vi.stubEnv("SERVICES_MODE", "fake");
    seed();
    expect((await post("email=nobody@example.invalid&version=1999-01-01")).status).toBe(404);
    expect((await post(`email=${EMAIL}`)).status).toBe(404);
  });
});
