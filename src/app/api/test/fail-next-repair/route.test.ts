import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));

import { getFakeAuthStore, resetFakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { POST } from "./route";

describe("POST /api/test/fail-next-repair", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetFakeAuthStore();
  });

  test("is not found outside test mode and switches nothing on (the setting is read per request)", async () => {
    for (const mode of ["real", "", undefined]) {
      vi.stubEnv("SERVICES_MODE", mode);
      expect((await POST()).status).toBe(404);
      expect(getFakeAuthStore().failNextRepair).toBe(false);
    }
  });

  test("in test mode switches the next repair failure on, and a reset switches it off", async () => {
    vi.stubEnv("SERVICES_MODE", "fake");
    expect((await POST()).status).toBe(204);
    expect(getFakeAuthStore().failNextRepair).toBe(true);
    resetFakeAuthStore();
    expect(getFakeAuthStore().failNextRepair).toBe(false);
  });
});
