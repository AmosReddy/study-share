import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));

const { requireGroupDeps } = vi.hoisted(() => ({ requireGroupDeps: vi.fn() }));
vi.mock("@/server/groups/request-deps", () => ({ requireGroupDeps }));

import { NextRequest } from "next/server";
import { POST } from "./route";

const request = () =>
  new NextRequest("http://localhost/api/test/join-group", {
    method: "POST",
    body: JSON.stringify({ key: "ABCDEFGH" }),
  });

describe("POST /api/test/join-group", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    requireGroupDeps.mockReset();
  });

  test("is not found outside test mode and reads no session", async () => {
    for (const mode of ["real", "", undefined]) {
      vi.stubEnv("SERVICES_MODE", mode);
      expect((await POST(request())).status).toBe(404);
    }
    expect(requireGroupDeps).not.toHaveBeenCalled();
  });
});
