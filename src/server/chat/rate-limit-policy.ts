import type { Limit } from "../use-case-kit";

export type { Limit } from "../use-case-kit";

/** Sending a message: 20 a minute per person (key `chat-send:user:<userId>`). */
export const CHAT_SEND_USER_LIMIT: Limit = { limit: 20, windowSeconds: 60 };
