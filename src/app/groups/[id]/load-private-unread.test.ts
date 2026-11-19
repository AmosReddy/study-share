import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadGroupPage, withDirectChat, loadPrivateSummary } = vi.hoisted(() => ({
  loadGroupPage: vi.fn(),
  withDirectChat: vi.fn((deps: unknown) => ({ deps })),
  loadPrivateSummary: vi.fn(),
}));

vi.mock("./load-group", () => ({ loadGroupPage }));
vi.mock("@/server/chat/direct-request-deps", () => ({ withDirectChat }));
vi.mock("@/server/chat/direct-use-cases", () => ({ loadPrivateSummary }));
vi.mock("@/server/env", () => ({ getServerEnv: () => ({ SUPABASE_SERVICE_ROLE_KEY: "test-secret" }) }));

import { loadPrivateUnread, safeUnreadState, viewerTokenOf } from "./load-private-unread";

const NOTHING = { any: false, fromChatKeys: [], chats: [] };
const GROUP = "11111111-1111-4111-8111-111111111111";
const SUMMARY = {
  chats: [
    { chatId: "c1", name: "Ravi", otherGone: false, preview: "hi", lastAt: "2026-11-14T10:00:00.000Z", unread: true },
    { chatId: "c2", name: "Mina", otherGone: false, preview: "yo", lastAt: "2026-11-14T09:00:00.000Z", unread: false },
  ],
  unread: { any: true, fromChatKeys: ["k"] },
};

beforeEach(() => {
  loadGroupPage.mockReset();
  loadPrivateSummary.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadPrivateUnread", () => {
  it("answers the unread state of the person's own summary for a person who may see the group", async () => {
    loadGroupPage.mockResolvedValue({ deps: { id: "deps" } });
    loadPrivateSummary.mockResolvedValue(SUMMARY);
    expect(await loadPrivateUnread(GROUP)).toEqual({ any: true, fromChatKeys: ["k"], chats: [{ chatId: "c1", name: "Ravi" }] });
    expect(loadPrivateSummary).toHaveBeenCalledWith({ deps: { id: "deps" } }, GROUP);
  });

  it("answers nothing unread, without asking the store, for a person who may not see the group", async () => {
    loadGroupPage.mockResolvedValue(null);
    expect(await loadPrivateUnread(GROUP)).toEqual(NOTHING);
    expect(loadPrivateSummary).not.toHaveBeenCalled();
  });

  it("answers nothing unread when the summary says the person may not use the chat (null)", async () => {
    loadGroupPage.mockResolvedValue({ deps: {} });
    loadPrivateSummary.mockResolvedValue(null);
    expect(await loadPrivateUnread(GROUP)).toEqual(NOTHING);
  });

  it("answers nothing unread when the store fails, and logs one fixed line that carries nothing from the error", async () => {
    loadGroupPage.mockResolvedValue({ deps: {} });
    loadPrivateSummary.mockRejectedValue(new Error("db down at secret-host"));
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

describe("safeUnreadState", () => {
  it("is the same answer from deps already in hand, and never throws", async () => {
    loadPrivateSummary.mockResolvedValue(SUMMARY);
    expect((await safeUnreadState({} as never, GROUP)).chats).toEqual([{ chatId: "c1", name: "Ravi" }]);
    loadPrivateSummary.mockRejectedValue(new Error("down"));
    expect(await safeUnreadState({} as never, GROUP)).toEqual(NOTHING);
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
