import { afterEach, describe, expect, it } from "vitest";
import type { PrivateUnreadState } from "@/shared/direct-chat-types";
import { clearPrivateUnread, readPrivateUnread, setPrivateUnread } from "./private-unread-store";

afterEach(() => clearPrivateUnread());

const some = (...names: string[]): PrivateUnreadState => ({
  any: names.length > 0,
  fromChatKeys: names.map((n) => `key-${n}`),
  chats: names.map((n) => ({ chatId: `chat-${n}`, name: n })),
});

describe("the private unread store", () => {
  it("holds an answer per person and group, and says nothing for one it never learned", () => {
    expect(readPrivateUnread("alice", "g1")).toBeUndefined();
    setPrivateUnread("alice", "g1", some("Ravi"));
    setPrivateUnread("alice", "g2", some());
    expect(readPrivateUnread("alice", "g1")).toEqual(some("Ravi"));
    expect(readPrivateUnread("alice", "g2")).toEqual(some());
    expect(readPrivateUnread("alice", "g3")).toBeUndefined();
  });

  it("never hands one person's answer to another person on the same tab (a sign-out and sign-in)", () => {
    setPrivateUnread("alice", "g1", some("Ravi"));
    expect(readPrivateUnread("bob", "g1")).toBeUndefined();
    setPrivateUnread("bob", "g1", some());
    expect(readPrivateUnread("alice", "g1")?.any).toBe(true);
    expect(readPrivateUnread("bob", "g1")?.any).toBe(false);
  });

  it("a newer answer replaces an older one, with the keys and conversations that came with it", () => {
    setPrivateUnread("alice", "g1", some("Ravi", "Mina"));
    setPrivateUnread("alice", "g1", some("Mina"));
    expect(readPrivateUnread("alice", "g1")).toEqual(some("Mina"));
    setPrivateUnread("alice", "g1", some());
    expect(readPrivateUnread("alice", "g1")).toEqual({ any: false, fromChatKeys: [], chats: [] });
  });

  it("keeps its own copy, so changing what was handed in changes nothing stored", () => {
    const given = some("Ravi");
    setPrivateUnread("alice", "g1", given);
    given.fromChatKeys.push("x");
    given.chats[0].name = "Changed";
    expect(readPrivateUnread("alice", "g1")).toEqual(some("Ravi"));
  });

  it("clearPrivateUnread forgets everything", () => {
    setPrivateUnread("alice", "g1", some("Ravi"));
    clearPrivateUnread();
    expect(readPrivateUnread("alice", "g1")).toBeUndefined();
  });
});
