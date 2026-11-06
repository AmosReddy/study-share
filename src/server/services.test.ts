import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  The build runs with no settings at all, and prerenders pages that call getAuthProvider().
  Next.js stops a prerender at the first request-reading call (cookies()); anything that
  runs before it, like reading the settings, runs at build time and breaks the build.
  This guards that order. The mocked cookies() stands in for the prerender stopping.
*/
const { getServerEnv, cookies } = vi.hoisted(() => ({
  getServerEnv: vi.fn(() => {
    throw new Error("settings were read before the request-reading call");
  }),
  cookies: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/server/env", () => ({ getServerEnv }));

import { getAuthProvider } from "./services";

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
