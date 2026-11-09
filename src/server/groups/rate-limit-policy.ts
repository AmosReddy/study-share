import type { Limit } from "../use-case-kit";

export type { Limit } from "../use-case-kit";

const HOUR = 60 * 60;
const FIFTEEN_MINUTES = 15 * 60;

/** Making groups: 10 an hour per person. */
export const CREATE_GROUP_USER_LIMIT: Limit = { limit: 10, windowSeconds: HOUR };

/** Looking up an invite (a link or a typed code), per signed-in person. Every lookup counts. */
export const JOIN_LOOKUP_USER_LIMIT: Limit = { limit: 60, windowSeconds: FIFTEEN_MINUTES };

/**
 * Invite lookups that FIND NOTHING, per network, signed in or not: this is what slows down code
 * guessing. The bucket is checked (`peek`) before every lookup but counted (`hit`) only when the
 * lookup misses, so a whole class opening a real link from one college Wi-Fi address never uses it
 * up. Only guesses do: 300 an hour.
 */
export const JOIN_IP_LIMIT: Limit = { limit: 300, windowSeconds: HOUR };

/**
 * Password tries: 5 per person per group per 15 minutes. A try is counted (`hit`) BEFORE the password
 * is checked, so parallel guesses cannot all slip through, and a person who has used the 5 is
 * refused even with the right password. The right password uses a try too.
 */
export const WRONG_PASSWORD_LIMIT: Limit = { limit: 5, windowSeconds: FIFTEEN_MINUTES };

export const wrongPasswordKey = (groupId: string, userId: string) => `join-wrong:${groupId}:${userId}`;

/** Editing a group's name, description or join settings: 60 an hour per person, so a script cannot hammer the database. */
export const GROUP_EDIT_USER_LIMIT: Limit = { limit: 60, windowSeconds: HOUR };

/** Resetting an invite link: 20 an hour per person. */
export const RESET_INVITE_USER_LIMIT: Limit = { limit: 20, windowSeconds: HOUR };
