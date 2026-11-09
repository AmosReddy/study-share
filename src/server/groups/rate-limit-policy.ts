import type { Limit } from "../use-case-kit";

export type { Limit } from "../use-case-kit";

const HOUR = 60 * 60;
const FIFTEEN_MINUTES = 15 * 60;

/** Making groups: 10 an hour per person. */
export const CREATE_GROUP_USER_LIMIT: Limit = { limit: 10, windowSeconds: HOUR };

/** Looking up an invite (a link or a typed code), per signed-in person. */
export const JOIN_LOOKUP_USER_LIMIT: Limit = { limit: 60, windowSeconds: FIFTEEN_MINUTES };

/**
 * Invite lookups per network, signed in or not: this is what slows down code guessing. Generous
 * because a whole class often joins together from one college Wi-Fi address.
 */
export const JOIN_IP_LIMIT: Limit = { limit: 300, windowSeconds: HOUR };

/**
 * Wrong group passwords: 5 per person per group per 15 minutes. Read with `peek` before the
 * password is checked and counted with `hit` only after a wrong one, so a person who is locked out
 * is refused even with the right password.
 */
export const WRONG_PASSWORD_LIMIT: Limit = { limit: 5, windowSeconds: FIFTEEN_MINUTES };

export const wrongPasswordKey = (groupId: string, userId: string) => `join-wrong:${groupId}:${userId}`;
