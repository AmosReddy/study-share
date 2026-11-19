import { createHmac, timingSafeEqual } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// The real function, wrapped so a test can count how often it is used.
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

import { chatKeyFor, findMemberByChatKey } from "./chat-key";

const SECRET = "test-service-role-key";
const GROUP = "11111111-1111-4111-8111-111111111111";
const OTHER_GROUP = "22222222-2222-4222-8222-222222222222";
const ADA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RAVI = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MINA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("chatKeyFor", () => {
  it("is base64url(HMAC-SHA256(secret, 'direct-chat:<group>:<user>')), 43 characters", () => {
    const expected = createHmac("sha256", SECRET).update(`direct-chat:${GROUP}:${ADA}`).digest("base64url");
    expect(chatKeyFor(SECRET, GROUP, ADA)).toBe(expected);
    expect(expected).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("is stable, and different for each member, each group and each secret", () => {
    expect(chatKeyFor(SECRET, GROUP, ADA)).toBe(chatKeyFor(SECRET, GROUP, ADA));
    const keys = [
      chatKeyFor(SECRET, GROUP, ADA),
      chatKeyFor(SECRET, GROUP, RAVI),
      chatKeyFor(SECRET, OTHER_GROUP, ADA),
      chatKeyFor("another-secret", GROUP, ADA),
    ];
    expect(new Set(keys).size).toBe(4);
  });

  it("does not depend on the letter case of the ids, and never contains an id", () => {
    expect(chatKeyFor(SECRET, GROUP.toUpperCase(), ADA.toUpperCase())).toBe(chatKeyFor(SECRET, GROUP, ADA));
    expect(chatKeyFor(SECRET, GROUP, ADA)).not.toContain(ADA);
  });

  it("refuses to work without a secret", () => {
    expect(() => chatKeyFor("", GROUP, ADA)).toThrow();
    expect(() => findMemberByChatKey("", GROUP, [ADA], chatKeyFor(SECRET, GROUP, ADA))).toThrow();
  });
});

describe("findMemberByChatKey", () => {
  const members = [ADA, RAVI, MINA];

  it("finds the member a key was made for", () => {
    for (const id of members) expect(findMemberByChatKey(SECRET, GROUP, members, chatKeyFor(SECRET, GROUP, id))).toBe(id);
  });

  it("finds nobody for a key made for another group, another secret, or a person outside the list", () => {
    expect(findMemberByChatKey(SECRET, GROUP, members, chatKeyFor(SECRET, OTHER_GROUP, RAVI))).toBeNull();
    expect(findMemberByChatKey(SECRET, GROUP, members, chatKeyFor("another-secret", GROUP, RAVI))).toBeNull();
    expect(findMemberByChatKey(SECRET, GROUP, [ADA, MINA], chatKeyFor(SECRET, GROUP, RAVI))).toBeNull();
    expect(findMemberByChatKey(SECRET, GROUP, [], chatKeyFor(SECRET, GROUP, RAVI))).toBeNull();
  });

  it("finds nobody for garbage, and never throws", () => {
    const good = chatKeyFor(SECRET, GROUP, ADA);
    const bad = [
      "",
      "garbage",
      " ",
      good.slice(1),
      `${good}A`,
      good.replace(/.$/, "!"),
      `${good.slice(0, 42)}=`,
      good.toUpperCase() === good ? good.toLowerCase() : good.toUpperCase(),
      ADA,
      "\u0000".repeat(43),
      "é".repeat(43),
      "A".repeat(43),
      "A".repeat(10_000),
    ];
    for (const key of bad) expect(findMemberByChatKey(SECRET, GROUP, members, key)).toBeNull();
    for (const key of [undefined, null, 5, {}, []]) expect(findMemberByChatKey(SECRET, GROUP, members, key as never)).toBeNull();
  });

  it("accepts only the canonical spelling: a key whose last character differs only in unused bits is not a second valid key", () => {
    const good = chatKeyFor(SECRET, GROUP, ADA);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const siblings = [...alphabet].map((c) => good.slice(0, 42) + c).filter((key) => key !== good);
    for (const key of siblings) expect(findMemberByChatKey(SECRET, GROUP, members, key)).toBeNull();
  });

  it("compares with timingSafeEqual against every member, with no early exit", () => {
    const compare = vi.mocked(timingSafeEqual);
    compare.mockClear();
    const key = chatKeyFor(SECRET, GROUP, ADA);
    // Ada is first, yet all three are compared.
    expect(findMemberByChatKey(SECRET, GROUP, members, key)).toBe(ADA);
    expect(compare).toHaveBeenCalledTimes(3);
    compare.mockClear();
    expect(findMemberByChatKey(SECRET, GROUP, members, chatKeyFor(SECRET, OTHER_GROUP, ADA))).toBeNull();
    expect(compare).toHaveBeenCalledTimes(3);
    compare.mockClear();
    // A key of the wrong shape is refused before any comparison (nothing to compare).
    expect(findMemberByChatKey(SECRET, GROUP, members, "short")).toBeNull();
    expect(compare).not.toHaveBeenCalled();
  });
});
