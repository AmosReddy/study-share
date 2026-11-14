import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BACKOFF_MS,
  LATEST_EVERY,
  POLL_INTERVAL_MS,
  fetchChatPage,
  messagesUrl,
  parseChatPage,
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
