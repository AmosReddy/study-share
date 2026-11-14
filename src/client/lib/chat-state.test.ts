import { describe, expect, it } from "vitest";
import type { ChatPage, MessageView } from "@/shared/chat-types";
import {
  chatItems,
  chatReducer,
  dedupe,
  hasUnseen,
  initialChatState,
  newestSentAt,
  type ChatAction,
  type ChatState,
} from "./chat-state";

let counter = 0;
/** A message at minute `minute` of an arbitrary day; ids and cursors sort like the minutes. */
function msg(minute: number, overrides: Partial<MessageView> = {}): MessageView {
  counter += 1;
  const label = String(minute).padStart(4, "0");
  return {
    id: `id-${label}`,
    clientId: `client-${label}-${counter}`,
    body: `message ${minute}`,
    senderName: "Ravi",
    mine: false,
    canDelete: false,
    createdAt: new Date(Date.UTC(2026, 10, 14, 10, minute)).toISOString(),
    cursor: `cur-${label}`,
    ...overrides,
  };
}

const page = (messages: MessageView[], extra: Partial<ChatPage> = {}): ChatPage => ({
  messages,
  hasMore: false,
  cursor: messages[messages.length - 1]?.cursor ?? null,
  canDeleteAny: false,
  ...extra,
});

const run = (state: ChatState, ...actions: ChatAction[]) => actions.reduce(chatReducer, state);
const ids = (state: ChatState) => state.messages.map((m) => m.id);
const bodies = (state: ChatState) => chatItems(state).map((item) => item.body);

describe("initialChatState", () => {
  it("holds the page, its cursor and whether earlier messages exist", () => {
    const a = msg(1);
    const b = msg(2);
    const state = initialChatState(page([a, b], { hasMore: true }));
    expect(ids(state)).toEqual([a.id, b.id]);
    expect(state.cursor).toBe(b.cursor);
    expect(state.hasOlder).toBe(true);
  });

  it("starts empty with no cursor for an empty chat", () => {
    const state = initialChatState(page([]));
    expect(state.messages).toEqual([]);
    expect(state.cursor).toBeNull();
  });

  it("drops duplicates in the page", () => {
    const a = msg(1);
    expect(dedupe([a, a, { ...a, id: "other" }])).toEqual([a]);
  });
});

describe("after (the poll)", () => {
  it("adds newer messages at the end and moves the cursor", () => {
    const a = msg(1);
    const b = msg(2);
    const c = msg(3);
    const state = run(initialChatState(page([a])), { type: "after", page: page([b, c]) });
    expect(ids(state)).toEqual([a.id, b.id, c.id]);
    expect(state.cursor).toBe(c.cursor);
  });

  it("keeps the cursor when nothing is new", () => {
    const a = msg(1);
    const state = run(initialChatState(page([a])), { type: "after", page: page([], { cursor: a.cursor }) });
    expect(ids(state)).toEqual([a.id]);
    expect(state.cursor).toBe(a.cursor);
  });

  it("never shows a message twice, by id or by client id", () => {
    const a = msg(1);
    const sameClient = msg(2, { clientId: a.clientId });
    const state = run(initialChatState(page([a])), { type: "after", page: page([a, sameClient]) });
    expect(ids(state)).toEqual([a.id]);
  });

  it("puts a message that landed before one already held in time order", () => {
    const a = msg(1);
    const c = msg(3, { mine: true });
    const b = msg(2);
    const state = run(initialChatState(page([a])), { type: "sent", message: c }, { type: "after", page: page([b, c]) });
    expect(ids(state)).toEqual([a.id, b.id, c.id]);
  });

  it("does not bring back a message deleted on this screen", () => {
    const a = msg(1);
    const b = msg(2);
    const state = run(initialChatState(page([a, b])), { type: "remove", id: b.id }, { type: "after", page: page([b]) });
    expect(ids(state)).toEqual([a.id]);
  });
});

describe("latest (the periodic look at the newest page)", () => {
  it("adds a message an after poll missed, in its place", () => {
    const a = msg(1);
    const c = msg(3);
    const missed = msg(2);
    const state = run(initialChatState(page([a, c])), { type: "latest", page: page([a, missed, c]) });
    expect(ids(state)).toEqual([a.id, missed.id, c.id]);
  });

  it("removes a message inside the window that is gone from it (deleted by someone else)", () => {
    const [a, b, c] = [msg(1), msg(2), msg(3)];
    const state = run(initialChatState(page([a, b, c])), { type: "latest", page: page([a, c]) });
    expect(ids(state)).toEqual([a.id, c.id]);
  });

  it("keeps older messages that were loaded above a window that has more before it", () => {
    const old = msg(1);
    const [b, c] = [msg(5), msg(6)];
    const state = run(initialChatState(page([old, b, c])), { type: "latest", page: page([b, c], { hasMore: true }) });
    expect(ids(state)).toEqual([old.id, b.id, c.id]);
  });

  it("removes older messages too when the window reaches the start of the chat", () => {
    const [a, b, c] = [msg(1), msg(5), msg(6)];
    const state = run(initialChatState(page([a, b, c])), { type: "latest", page: page([b, c], { hasMore: false }) });
    expect(ids(state)).toEqual([b.id, c.id]);
  });

  it("keeps messages newer than the window (they arrived after it was read)", () => {
    const [a, b] = [msg(1), msg(2)];
    const newest = msg(9, { mine: true });
    const state = run(initialChatState(page([a, b, newest])), { type: "latest", page: page([a, b]) });
    expect(ids(state)).toEqual([a.id, b.id, newest.id]);
  });

  it("removes the newest message when it was held before the request and the page no longer has it (deleted)", () => {
    const [a, b] = [msg(1), msg(2)];
    const held = initialChatState(page([a, b]));
    const state = run(held, { type: "latest", page: page([a]), known: [a.id, b.id] });
    expect(ids(state)).toEqual([a.id]);
    expect(state.cursor).toBe(a.cursor);
  });

  it("keeps a newer message that was not held when the request was made (it arrived since)", () => {
    const a = msg(1);
    const arrived = msg(2, { mine: true });
    const state = run(initialChatState(page([a, arrived])), { type: "latest", page: page([a]), known: [a.id] });
    expect(ids(state)).toEqual([a.id, arrived.id]);
  });

  it("empties the list for an empty chat", () => {
    const state = run(initialChatState(page([msg(1)])), { type: "latest", page: page([]) });
    expect(state.messages).toEqual([]);
    expect(state.cursor).toBeNull();
  });

  it("uses the server's copy of a message it already holds", () => {
    const a = msg(1);
    const state = run(initialChatState(page([a])), { type: "latest", page: page([{ ...a, canDelete: true }]) });
    expect(state.messages[0].canDelete).toBe(true);
    expect(state.messages).toHaveLength(1);
  });

  it("sets whether earlier messages exist from the window when nothing older is held", () => {
    const [a, b] = [msg(1), msg(2)];
    const state = run(initialChatState(page([a, b])), { type: "latest", page: page([a, b], { hasMore: true }) });
    expect(state.hasOlder).toBe(true);
  });

  it("does not bring back a message deleted on this screen", () => {
    const [a, b] = [msg(1), msg(2)];
    const state = run(initialChatState(page([a, b])), { type: "remove", id: a.id }, { type: "latest", page: page([a, b]) });
    expect(ids(state)).toEqual([b.id]);
  });

  it("learns whether the viewer may delete any message", () => {
    const a = msg(1);
    const state = run(initialChatState(page([a])), { type: "latest", page: page([a], { canDeleteAny: true }) });
    expect(state.canDeleteAny).toBe(true);
  });
});

describe("before (earlier messages)", () => {
  it("adds them above, without moving the cursor, and tracks whether still more exist", () => {
    const [a, b] = [msg(5), msg(6)];
    const older = [msg(1), msg(2)];
    const state = run(initialChatState(page([a, b], { hasMore: true })), {
      type: "before",
      page: page(older, { hasMore: false, cursor: null }),
    });
    expect(ids(state)).toEqual([older[0].id, older[1].id, a.id, b.id]);
    expect(state.cursor).toBe(b.cursor);
    expect(state.hasOlder).toBe(false);
  });

  it("ignores messages it already holds", () => {
    const [a, b] = [msg(5), msg(6)];
    const state = run(initialChatState(page([a, b])), { type: "before", page: page([a], { cursor: null }) });
    expect(ids(state)).toEqual([a.id, b.id]);
  });
});

describe("sending", () => {
  const pending = (clientId: string, body = "hi") => ({
    clientId,
    body,
    createdAt: "2026-11-14T10:00:00.000Z",
    status: "sending" as const,
  });

  it("shows a queued message after the confirmed ones", () => {
    const a = msg(1);
    const state = run(initialChatState(page([a])), { type: "queue", message: pending("c1", "typed") });
    expect(bodies(state)).toEqual(["message 1", "typed"]);
    expect(chatItems(state)[1]).toMatchObject({ status: "sending", mine: true, key: "c1" });
  });

  it("replaces the pending message with the server's copy, once, under the same key", () => {
    const sent = msg(2, { mine: true, clientId: "c1", body: "typed" });
    const state = run(initialChatState(page([msg(1)])), { type: "queue", message: pending("c1", "typed") }, { type: "sent", message: sent });
    const items = chatItems(state);
    expect(items.map((item) => item.body)).toEqual(["message 1", "typed"]);
    expect(items[1]).toMatchObject({ status: "sent", key: "c1", id: sent.id });
    expect(state.pending).toEqual([]);
  });

  it("is not doubled when a poll brings the message before the send answer does", () => {
    const sent = msg(2, { mine: true, clientId: "c1", body: "typed" });
    const state = run(
      initialChatState(page([msg(1)])),
      { type: "queue", message: pending("c1", "typed") },
      { type: "after", page: page([sent]) },
      { type: "sent", message: sent },
    );
    expect(bodies(state)).toEqual(["message 1", "typed"]);
    expect(state.pending).toEqual([]);
  });

  it("does not move the poll cursor when the send answer arrives", () => {
    const first = msg(1);
    const sent = msg(5, { mine: true, clientId: "c1" });
    const state = run(initialChatState(page([first])), { type: "queue", message: pending("c1") }, { type: "sent", message: sent });
    expect(state.cursor).toBe(first.cursor);
  });

  it("marks a failure, keeps the text and its error, and a retry makes it sending again with the same client id", () => {
    let state = run(initialChatState(page([])), { type: "queue", message: pending("c1", "try me") });
    state = run(state, { type: "failed", clientId: "c1", error: "Too fast." });
    expect(chatItems(state)[0]).toMatchObject({ status: "failed", error: "Too fast.", body: "try me", key: "c1" });
    state = run(state, { type: "retry", clientId: "c1" });
    expect(chatItems(state)[0]).toMatchObject({ status: "sending", key: "c1" });
    expect(chatItems(state)[0].error).toBeUndefined();
  });

  it("queues the same client id only once, and a retried send that succeeds shows one message", () => {
    const sent = msg(3, { mine: true, clientId: "c1", body: "once" });
    const state = run(
      initialChatState(page([])),
      { type: "queue", message: pending("c1", "once") },
      { type: "queue", message: pending("c1", "once") },
      { type: "failed", clientId: "c1" },
      { type: "retry", clientId: "c1" },
      { type: "sent", message: sent },
      { type: "sent", message: sent },
    );
    expect(bodies(state)).toEqual(["once"]);
  });

  it("discards a pending message", () => {
    const state = run(initialChatState(page([])), { type: "queue", message: pending("c1") }, { type: "discard", clientId: "c1" });
    expect(chatItems(state)).toEqual([]);
  });
});

describe("remove", () => {
  it("drops the message", () => {
    const [a, b] = [msg(1), msg(2)];
    expect(ids(run(initialChatState(page([a, b])), { type: "remove", id: a.id }))).toEqual([b.id]);
  });
});

describe("new-message tracking", () => {
  it("finds someone else's message newer than what was seen", () => {
    const [a, b] = [msg(1), msg(2)];
    const items = chatItems(initialChatState(page([a, b])));
    expect(newestSentAt(items)).toBe(b.createdAt);
    expect(hasUnseen(items, a.createdAt)).toBe(true);
    expect(hasUnseen(items, b.createdAt)).toBe(false);
  });

  it("ignores own and unsent messages", () => {
    const mine = msg(2, { mine: true });
    const state = run(initialChatState(page([mine])), {
      type: "queue",
      message: { clientId: "c9", body: "x", createdAt: "2030-01-01T00:00:00.000Z", status: "sending" },
    });
    expect(hasUnseen(chatItems(state), "")).toBe(false);
    expect(newestSentAt(chatItems(state))).toBe(mine.createdAt);
  });
});
