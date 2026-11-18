import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadGroupPage, withDirectChat, privateUnread } = vi.hoisted(() => ({
  loadGroupPage: vi.fn(),
  withDirectChat: vi.fn((deps: unknown) => ({ deps })),
  privateUnread: vi.fn(),
}));

vi.mock("./load-group", () => ({ loadGroupPage }));
vi.mock("@/server/chat/direct-request-deps", () => ({ withDirectChat }));
vi.mock("@/server/chat/direct-use-cases", () => ({ privateUnread }));
vi.mock("@/server/env", () => ({ getServerEnv: () => ({ SUPABASE_SERVICE_ROLE_KEY: "test-secret" }) }));

import { loadPrivateUnread, viewerTokenOf } from "./load-private-unread";

const NOTHING = { any: false, fromChatKeys: [] };
const GROUP = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  loadGroupPage.mockReset();
  privateUnread.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadPrivateUnread", () => {
  it("answers what privateUnread says for a person who may see the group", async () => {
    loadGroupPage.mockResolvedValue({ deps: { id: "deps" } });
    privateUnread.mockResolvedValue({ any: true, fromChatKeys: ["k"] });
    expect(await loadPrivateUnread(GROUP)).toEqual({ any: true, fromChatKeys: ["k"] });
    expect(privateUnread).toHaveBeenCalledWith({ deps: { id: "deps" } }, GROUP);
  });

  it("answers nothing unread, without asking the store, for a person who may not see the group", async () => {
    loadGroupPage.mockResolvedValue(null);
    expect(await loadPrivateUnread(GROUP)).toEqual(NOTHING);
    expect(privateUnread).not.toHaveBeenCalled();
  });

  it("answers nothing unread when the store fails, and logs one fixed line that carries nothing from the error", async () => {
    loadGroupPage.mockResolvedValue({ deps: {} });
    privateUnread.mockRejectedValue(new Error("db down at secret-host"));
    expect(await loadPrivateUnread(GROUP)).toEqual(NOTHING);
    loadGroupPage.mockRejectedValue(new Error("lookup failed at secret-host"));
    expect(await loadPrivateUnread(GROUP)).toEqual(NOTHING);
    expect(vi.mocked(console.error).mock.calls).toEqual([
      ["Could not check for unread private messages."],
      ["Could not check for unread private messages."],
    ]);
  });

  it("lets Next's own control flow through (a redirect to log in when the session ended), and nothing else", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
    loadGroupPage.mockRejectedValue(redirect);
    await expect(loadPrivateUnread(GROUP)).rejects.toBe(redirect);
    expect(console.error).not.toHaveBeenCalled();
    // An error whose digest only looks similar is a failure like any other.
    loadGroupPage.mockRejectedValue(Object.assign(new Error("x"), { digest: "12345" }));
    expect(await loadPrivateUnread(GROUP)).toEqual(NOTHING);
  });
});

describe("viewerTokenOf", () => {
  it("is stable per person, different for another person, and never contains the account id", () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    expect(viewerTokenOf(a)).toBe(viewerTokenOf(a.toUpperCase()));
    expect(viewerTokenOf(a)).not.toBe(viewerTokenOf(b));
    expect(viewerTokenOf(a)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(viewerTokenOf(a)).not.toContain(a);
  });
});
