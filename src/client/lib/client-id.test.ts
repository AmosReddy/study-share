import { afterEach, describe, expect, it, vi } from "vitest";
import { newClientId } from "./client-id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newClientId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("makes a version 4 uuid, different each time", () => {
    const [a, b] = [newClientId(), newClientId()];
    expect(a).toMatch(UUID);
    expect(a).not.toBe(b);
  });

  it("still does where crypto.randomUUID does not exist (an http page)", () => {
    vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    expect(newClientId()).toMatch(UUID);
  });
});
