import { CHAT_LIMITS } from "./messages";

/**
 * Every sentence the chat use-cases show, in one place so the owner can change the wording.
 * None of them names a person, an id or anything from the database.
 */
export const CHAT_MESSAGES = {
  bodyRequired: "Write a message first.",
  bodyTooLong: `Messages can be up to ${CHAT_LIMITS.maxBody} characters.`,
  badForm: "We couldn't send that. Please try again.",
  tooMany: "You're sending messages too fast. Please wait a moment and try again.",
  couldNotSave: "We couldn't save that right now. Please try again.",
  /** The same answer for a message that does not exist, one in a group the person is not in, and one that is not theirs to delete. */
  notFound: "That message isn't available.",
  /** A retried send of a message that was deleted in the meantime. */
  messageRemoved: "That message was removed.",
  formerMember: "Former member",
} as const;
