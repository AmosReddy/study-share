import { describe, expect, it } from "vitest";
import { CHAT_MESSAGES } from "./chat-messages";
import { cleanMessageBody, sendMessageSchema } from "./message-schemas";
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
  ])("%j becomes %j", (input, expected) => {
    expect(cleanMessageBody(input)).toBe(expected);
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

  it("drops fields it does not know", () => {
    const result = sendMessageSchema.safeParse({ body: "hi", clientId, senderId: "x" });
    expect(result.success && Object.keys(result.data)).toEqual(["body", "clientId"]);
  });
});
