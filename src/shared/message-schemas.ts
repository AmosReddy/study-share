import { z } from "zod";
import { CHAT_MESSAGES } from "./chat-messages";
import { CHAT_LIMITS } from "./messages";

/** Counts characters people see (code points), as the database's char_length does. */
const characterCount = (value: string) => [...value].length;

/**
 * What is kept of typed text: line breaks become "\n", a tab becomes a space, every other control
 * character (a NUL, which Postgres cannot store, among them) is dropped, and so is every invisible
 * format character (zero-width spaces, bidirectional controls, soft hyphens, the byte-order mark)
 * except the zero-width joiner and non-joiner, which real text needs (emoji sequences, Persian,
 * Hindi). The ends are trimmed. Nothing inside the text is collapsed: blank lines and runs of
 * spaces stay.
 */
export function cleanMessageBody(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[^\P{Cc}\n]/gu, "")
    .replace(/(?![‌‍])\p{Cf}/gu, "")
    .trim();
}

/** Characters that show nothing: spaces, joiners, and the "blank" letters people use to fake an empty message. */
const SHOWS_NOTHING = /[\p{Z}\s\p{Cc}\p{Cf}‌‍⠀ㅤᅟᅠﾠ͏឴឵]/u;

/** Whether the text has at least one character a person can see. A message of only blanks is not a message. */
export function hasVisibleCharacter(text: string): boolean {
  for (const character of text) if (!SHOWS_NOTHING.test(character)) return true;
  return false;
}

/** Far above any real message, so cleaning never has to chew on a huge string. */
const MAX_RAW_BODY = CHAT_LIMITS.maxBody * 10;

const bodySchema = z
  .string(CHAT_MESSAGES.bodyRequired)
  .max(MAX_RAW_BODY, CHAT_MESSAGES.bodyTooLong)
  .transform(cleanMessageBody)
  .refine(hasVisibleCharacter, CHAT_MESSAGES.bodyRequired)
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
