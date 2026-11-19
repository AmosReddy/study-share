import type { Limit } from "../use-case-kit";

export type { Limit } from "../use-case-kit";

/** Sending a private message: 20 a minute per person (key `dm-send:user:<userId>`), counted apart from the group chat's. */
export const DIRECT_SEND_USER_LIMIT: Limit = { limit: 20, windowSeconds: 60 };
export const directSendKey = (userId: string) => `dm-send:user:${userId}`;

/** Opening a private chat from the Members list: 30 an hour per person (key `dm-open:user:<userId>`). */
export const DIRECT_OPEN_USER_LIMIT: Limit = { limit: 30, windowSeconds: 3600 };
export const directOpenKey = (userId: string) => `dm-open:user:${userId}`;
