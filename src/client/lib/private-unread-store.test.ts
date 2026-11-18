import { afterEach, describe, expect, it } from "vitest";
import { clearPrivateUnread, readPrivateUnread, setPrivateUnread } from "./private-unread-store";

afterEach(() => clearPrivateUnread());

describe("the private unread store", () => {
  it("holds an answer per person and group, and says nothing for one it never learned", () => {
    expect(readPrivateUnread("alice", "g1")).toBeUndefined();
    setPrivateUnread("alice", "g1", true);
    setPrivateUnread("alice", "g2", false);
    expect(readPrivateUnread("alice", "g1")).toBe(true);
    expect(readPrivateUnread("alice", "g2")).toBe(false);
    expect(readPrivateUnread("alice", "g3")).toBeUndefined();
  });

  it("never hands one person's answer to another person on the same tab (a sign-out and sign-in)", () => {
    setPrivateUnread("alice", "g1", true);
    expect(readPrivateUnread("bob", "g1")).toBeUndefined();
    setPrivateUnread("bob", "g1", false);
    expect(readPrivateUnread("alice", "g1")).toBe(true);
    expect(readPrivateUnread("bob", "g1")).toBe(false);
  });

  it("a newer answer replaces an older one", () => {
    setPrivateUnread("alice", "g1", true);
    setPrivateUnread("alice", "g1", false);
    expect(readPrivateUnread("alice", "g1")).toBe(false);
  });

  it("clearPrivateUnread forgets everything", () => {
    setPrivateUnread("alice", "g1", true);
    clearPrivateUnread();
    expect(readPrivateUnread("alice", "g1")).toBeUndefined();
  });
});
