import { describe, expect, it } from "vitest";
import { CHAT_MESSAGES } from "./chat-messages";
import { cleanMessageBody, hasVisibleCharacter, sendMessageSchema } from "./message-schemas";
import { CHAT_LIMITS } from "./messages";

const clientId = "3f2b8f64-5717-4562-b3fc-2c963f66afa6";

describe("cleanMessageBody", () => {
  it.each([
    ["  hi  ", "hi"],
    ["a\r\nb\rc", "a\nb\nc"],
    ["a\tb", "a b"],
    ["a\u0000b\u0001c\u007fd\u009fe", "abcde"],
    ["\n\n x \n\n", "x"],
    ["a\n\n\nb   c", "a\n\n\nb   c"],
    [" 　 hi  ", "hi"],
    ["‍नम", "‍नम"],
    // Zero-width space, bidirectional controls, soft hyphen and byte-order mark are dropped.
    ["a​b‮c⁦d­e﻿f", "abcdef"],
    // The joiner and non-joiner stay: emoji sequences and Persian need them.
    ["👨‍👩", "👨‍👩"],
    ["می‌خواهم", "می‌خواهم"],
  ])("%j becomes %j", (input, expected) => {
    expect(cleanMessageBody(input)).toBe(expected);
  });
});

describe("hasVisibleCharacter", () => {
  it.each([
    ["hi", true],
    ["​x", true],
    ["👨‍👩", true],
    ["", false],
    ["   \n\t ", false],
    ["​", false],
    ["⠀", false],
    ["ㅤᅟᅠﾠ", false],
    ["‌‍͏ 　", false],
  ])("%j is %s", (input, expected) => {
    expect(hasVisibleCharacter(input)).toBe(expected);
  });
});

describe("sendMessageSchema", () => {
  it("accepts a normal message and lower-cases the client id", () => {
    const result = sendMessageSchema.safeParse({ body: " hello ", clientId: clientId.toUpperCase() });
    expect(result.success && result.data).toEqual({ body: "hello", clientId });
  });

  it("has the limits written in CHAT_LIMITS", () => {
    expect(CHAT_LIMITS).toEqual({ maxBody: 2000, pageSize: 50 });
    expect(sendMessageSchema.safeParse({ body: "x".repeat(2000), clientId }).success).toBe(true);
    expect(sendMessageSchema.safeParse({ body: "x".repeat(2001), clientId }).success).toBe(false);
  });

  it("gives the fixed friendly sentences, never zod's own", () => {
    const messages = (raw: unknown) => {
      const result = sendMessageSchema.safeParse(raw);
      return result.success ? [] : result.error.issues.map((i) => i.message);
    };
    expect(messages({ body: "", clientId })).toEqual([CHAT_MESSAGES.bodyRequired]);
    expect(messages({ body: "x".repeat(2001), clientId })).toEqual([CHAT_MESSAGES.bodyTooLong]);
    expect(messages({ body: "x".repeat(100_000), clientId })).toEqual([CHAT_MESSAGES.bodyTooLong]);
    expect(messages({ body: "hi", clientId: "nope" })).toEqual([CHAT_MESSAGES.badForm]);
    expect(messages({ body: 1, clientId })).toEqual([CHAT_MESSAGES.bodyRequired]);
    expect(messages({ body: "hi", clientId: 1 })).toEqual([CHAT_MESSAGES.badForm]);
  });

  it("refuses a body with nothing visible in it with the empty-message sentence", () => {
    for (const body of ["​", "⠀", "​⠀ㅤ \n", "‮‏", "   "]) {
      const result = sendMessageSchema.safeParse({ body, clientId });
      expect(result.success, JSON.stringify(body)).toBe(false);
      expect(result.success ? [] : result.error.issues.map((i) => i.message), JSON.stringify(body)).toEqual([CHAT_MESSAGES.bodyRequired]);
    }
  });

  it("strips invisible characters from a normal message", () => {
    const result = sendMessageSchema.safeParse({ body: "he​llo‮", clientId });
    expect(result.success && result.data.body).toBe("hello");
  });

  it("drops fields it does not know", () => {
    const result = sendMessageSchema.safeParse({ body: "hi", clientId, senderId: "x" });
    expect(result.success && Object.keys(result.data)).toEqual(["body", "clientId"]);
  });
});
