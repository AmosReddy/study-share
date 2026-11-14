import { z } from "zod";
import { CHAT_MESSAGES } from "./chat-messages";
import { CHAT_LIMITS } from "./messages";

/** Counts characters people see (code points), as the database's char_length does. */
const characterCount = (value: string) => [...value].length;

/**
 * What is kept of typed text: line breaks become "\n", a tab becomes a space, every other control
 * character (a NUL, which Postgres cannot store, among them) is dropped, and the ends are trimmed.
 * Nothing inside the text is collapsed: blank lines and runs of spaces stay.
 */
export function cleanMessageBody(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[^\P{Cc}\n]/gu, "")
    .trim();
}

/** Far above any real message, so cleaning never has to chew on a huge string. */
const MAX_RAW_BODY = CHAT_LIMITS.maxBody * 10;

const bodySchema = z
  .string(CHAT_MESSAGES.bodyRequired)
  .max(MAX_RAW_BODY, CHAT_MESSAGES.bodyTooLong)
  .transform(cleanMessageBody)
  .refine((body) => characterCount(body) >= 1, CHAT_MESSAGES.bodyRequired)
  .refine((body) => characterCount(body) <= CHAT_LIMITS.maxBody, CHAT_MESSAGES.bodyTooLong);

/** The browser makes this id once per message, so sending it again is harmless. */
const clientIdSchema = z
  .string(CHAT_MESSAGES.badForm)
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, CHAT_MESSAGES.badForm)
  .transform((id) => id.toLowerCase());

export const sendMessageSchema = z.object({
  body: bodySchema,
  clientId: clientIdSchema,
});
