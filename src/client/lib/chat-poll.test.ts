import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BACKOFF_MS,
  IDLE_SLOWER_AFTER_MS,
  IDLE_SLOW_AFTER_MS,
  REQUEST_TIMEOUT_MS,
  STALE_REQUEST_MS,
  idleDelay,
  nextPollDelay,
  LATEST_EVERY,
  POLL_INTERVAL_MS,
  directMessagesUrl,
  fetchChatPage,
  fetchDirectPage,
  fetchPrivateSummary,
  messagesUrl,
  parseChatPage,
  parseDirectPage,
  parsePrivateSummary,
  privateSummaryUrl,
  pollDelay,
  pollKind,
} from "./chat-poll";

describe("pollDelay", () => {
  it("is 2.5 s while all is well and backs off to 5, 10 and at most 20 s", () => {
    expect(POLL_INTERVAL_MS).toBe(2500);
    expect([0, 1, 2, 3, 4, 10].map(pollDelay)).toEqual([2500, 5000, 10_000, 20_000, 20_000, 20_000]);
    expect(BACKOFF_MS).toEqual([5000, 10_000, 20_000]);
  });
});

describe("idleDelay", () => {
  it("is 2.5 s for two minutes, then 10 s, then 30 s after ten minutes", () => {
    expect(IDLE_SLOW_AFTER_MS).toBe(120_000);
    expect(IDLE_SLOWER_AFTER_MS).toBe(600_000);
    expect([0, 1000, 119_999].map(idleDelay)).toEqual([2500, 2500, 2500]);
    expect([120_000, 300_000, 599_999].map(idleDelay)).toEqual([10_000, 10_000, 10_000]);
    expect([600_000, 3_600_000].map(idleDelay)).toEqual([30_000, 30_000]);
  });

  it("combines with the back-off: the slower of the two", () => {
    expect(nextPollDelay({ failures: 0, idleMs: 0 })).toBe(2500);
    expect(nextPollDelay({ failures: 1, idleMs: 0 })).toBe(5000);
    expect(nextPollDelay({ failures: 3, idleMs: 0 })).toBe(20_000);
    expect(nextPollDelay({ failures: 1, idleMs: 200_000 })).toBe(10_000);
    expect(nextPollDelay({ failures: 3, idleMs: 200_000 })).toBe(20_000);
    expect(nextPollDelay({ failures: 1, idleMs: 700_000 })).toBe(30_000);
  });

  it("gives up on a silent request after 15 s and abandons a stale one after 5 s", () => {
    expect(REQUEST_TIMEOUT_MS).toBe(15_000);
    expect(STALE_REQUEST_MS).toBe(5000);
  });
});

describe("pollKind", () => {
  it("asks after the cursor, and for the newest page on every sixth poll", () => {
    const kinds = [0, 1, 2, 3, 4, 5].map((sinceLatest) => pollKind({ sinceLatest, force: false, hasCursor: true }));
    expect(kinds).toEqual(["after", "after", "after", "after", "after", "latest"]);
    expect(LATEST_EVERY).toBe(6);
  });

  it("asks for the newest page when forced (tab visible again) or when there is no cursor", () => {
    expect(pollKind({ sinceLatest: 0, force: true, hasCursor: true })).toBe("latest");
    expect(pollKind({ sinceLatest: 0, force: false, hasCursor: false })).toBe("latest");
  });
});

describe("messagesUrl", () => {
  it("builds the route's address with at most one cursor", () => {
    expect(messagesUrl("g1")).toBe("/groups/g1/chat/messages");
    expect(messagesUrl("g1", { after: "abc_-" })).toBe("/groups/g1/chat/messages?after=abc_-");
    expect(messagesUrl("g1", { before: "xyz" })).toBe("/groups/g1/chat/messages?before=xyz");
  });
});

const message = {
  id: "i",
  clientId: "c",
  body: "b",
  senderName: "n",
  mine: false,
  canDelete: false,
  createdAt: "2026-11-14T10:00:00.000Z",
  cursor: "k",
};

describe("parseChatPage", () => {
  it("accepts a page and rejects other shapes", () => {
    const page = { messages: [message], hasMore: false, cursor: "k", canDeleteAny: false };
    expect(parseChatPage(page)).toEqual(page);
    expect(parseChatPage({ ...page, cursor: null })).not.toBeNull();
    expect(parseChatPage(null)).toBeNull();
    expect(parseChatPage({ ...page, messages: "no" })).toBeNull();
    expect(parseChatPage({ ...page, hasMore: "no" })).toBeNull();
    expect(parseChatPage({ ...page, messages: [{ id: 1 }] })).toBeNull();
  });
});

describe("fetchChatPage", () => {
  afterEach(() => vi.unstubAllGlobals());
  const signal = new AbortController().signal;
  const answer = (init: { status?: number; redirected?: boolean; json?: unknown }) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: init.status ?? 200,
        ok: (init.status ?? 200) < 400,
        redirected: init.redirected ?? false,
        json: async () => init.json,
      })),
    );

  it("returns the page", async () => {
    const page = { messages: [], hasMore: false, cursor: null, canDeleteAny: true };
    answer({ json: page });
    expect(await fetchChatPage("g1", {}, signal)).toEqual({ kind: "ok", page });
  });

  it("says gone for a 404, signed-out for a redirect, and error for 5xx, a bad body or a network failure", async () => {
    answer({ status: 404 });
    expect(await fetchChatPage("g1", {}, signal)).toEqual({ kind: "gone" });
    answer({ redirected: true, json: {} });
    expect(await fetchChatPage("g1", {}, signal)).toEqual({ kind: "signed-out" });
    answer({ status: 503 });
    expect(await fetchChatPage("g1", {}, signal)).toEqual({ kind: "error" });
    answer({ json: { nope: true } });
    expect(await fetchChatPage("g1", {}, signal)).toEqual({ kind: "error" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("offline"))),
    );
    expect(await fetchChatPage("g1", {}, signal)).toEqual({ kind: "error" });
  });

  it("says aborted when the request was cancelled", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      }),
    );
    expect(await fetchChatPage("g1", {}, controller.signal)).toEqual({ kind: "aborted" });
  });
});

describe("private chat addresses and shapes", () => {
  afterEach(() => vi.unstubAllGlobals());
  const signal = new AbortController().signal;
  const page = { messages: [message], hasMore: false, cursor: "k", canSend: true, otherName: "Ravi", otherGone: false };
  const answer = (json: unknown, status = 200) =>
    vi.stubGlobal("fetch", vi.fn(async () => ({ status, ok: status < 400, redirected: false, json: async () => json })));

  it("builds the conversation's and the list's addresses, encoding what it is given", () => {
    expect(directMessagesUrl("g1", "c1")).toBe("/groups/g1/chat/private/c1/messages");
    expect(directMessagesUrl("g1", "c1", { after: "a_-" })).toBe("/groups/g1/chat/private/c1/messages?after=a_-");
    expect(directMessagesUrl("g 1", "c/1", { before: "x y" })).toBe("/groups/g%201/chat/private/c%2F1/messages?before=x%20y");
    expect(privateSummaryUrl("g1")).toBe("/groups/g1/chat/private/summary");
  });

  it("reads a conversation page, never giving anyone delete-any power, and needs canSend", () => {
    expect(parseDirectPage(page)).toEqual({ ...page, canDeleteAny: false });
    expect(parseDirectPage({ ...page, canDeleteAny: true })?.canDeleteAny).toBe(false);
    expect(parseDirectPage({ ...page, canSend: false })?.canSend).toBe(false);
    expect(parseDirectPage({ ...page, canSend: "yes" })).toBeNull();
    expect(parseDirectPage({ messages: [], hasMore: false, cursor: null })).toBeNull();
    expect(parseDirectPage(null)).toBeNull();
  });

  it("reads the list's summary and rejects other shapes", () => {
    const row = { chatId: "c", name: "Ravi", otherGone: false, preview: "hi", lastAt: "2026-11-14T10:00:00.000Z", unread: true };
    const summary = { chats: [row], unread: { any: true, fromChatKeys: ["k"] } };
    expect(parsePrivateSummary(summary)).toEqual(summary);
    expect(parsePrivateSummary({ chats: [], unread: { any: false, fromChatKeys: [] } })).not.toBeNull();
    expect(parsePrivateSummary({ ...summary, chats: [{ ...row, unread: "yes" }] })).toBeNull();
    expect(parsePrivateSummary({ ...summary, unread: { any: true } })).toBeNull();
    expect(parsePrivateSummary({ chats: [] })).toBeNull();
    expect(parsePrivateSummary(null)).toBeNull();
  });

  it("fetches each with the same outcomes as the group chat", async () => {
    answer(page);
    expect(await fetchDirectPage("g1", "c1", {}, signal)).toEqual({ kind: "ok", page: { ...page, canDeleteAny: false } });
    answer({}, 404);
    expect(await fetchDirectPage("g1", "c1", {}, signal)).toEqual({ kind: "gone" });
    const summary = { chats: [], unread: { any: false, fromChatKeys: [] } };
    answer(summary);
    expect(await fetchPrivateSummary("g1", signal)).toEqual({ kind: "ok", page: summary });
    answer({ nope: true });
    expect(await fetchPrivateSummary("g1", signal)).toEqual({ kind: "error" });
    answer({}, 404);
    expect(await fetchPrivateSummary("g1", signal)).toEqual({ kind: "gone" });
  });
});
