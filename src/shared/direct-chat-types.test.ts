import { describe, expect, it } from "vitest";
import { noUnreadState, unreadStateFrom, type PrivateChatRow } from "./direct-chat-types";

const row = (chatId: string, name: string, unread: boolean): PrivateChatRow => ({
  chatId,
  name,
  otherGone: false,
  preview: "hi",
  lastAt: "2026-11-14T10:00:00.000Z",
  unread,
});

describe("unreadStateFrom", () => {
  it("names the unread conversations only, and carries the dots' keys", () => {
    const state = unreadStateFrom({
      chats: [row("c1", "Ravi", true), row("c2", "Mina", false), row("c3", "Zoe", true)],
      unread: { any: true, fromChatKeys: ["k1", "k3"] },
    });
    expect(state).toEqual({
      any: true,
      fromChatKeys: ["k1", "k3"],
      chats: [
        { chatId: "c1", name: "Ravi" },
        { chatId: "c3", name: "Zoe" },
      ],
    });
  });

  it("is empty when nothing is unread, and does not share its arrays with the summary", () => {
    const summary = { chats: [row("c1", "Ravi", false)], unread: { any: false, fromChatKeys: [] as string[] } };
    const state = unreadStateFrom(summary);
    expect(state).toEqual(noUnreadState());
    state.fromChatKeys.push("x");
    expect(summary.unread.fromChatKeys).toEqual([]);
  });
});
