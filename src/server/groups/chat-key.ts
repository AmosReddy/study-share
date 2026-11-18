import { createHmac, timingSafeEqual } from "node:crypto";

/*
  The one-way code (`chatKey`) that stands in for a member's account id in the Members list, so a
  plain member can start a private chat with someone without ever being shown that person's id.

    chatKey = base64url(HMAC-SHA256(secret, `direct-chat:${groupId}:${userId}`))

  The secret is the service-role key (as the pending sign-up cookie does: no new setting). The
  code is the same for every viewer, and it is bound to the group and the member: another group's
  code, or one for another member, never matches. It decides nothing by itself: the server turns it
  back into a member only by recomputing it over the group's ACTIVE members, and the person it
  names must also pass every other check.

  Pure functions over the secret; the caller reads it from the settings.
*/

const KEY_BYTES = 32;
/** base64url of 32 bytes, without padding. */
const KEY_LENGTH = 43;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function digest(secret: string, groupId: string, userId: string): Buffer {
  if (secret === "") throw new Error("Chat keys need a secret.");
  return createHmac("sha256", secret).update(`direct-chat:${groupId.toLowerCase()}:${userId.toLowerCase()}`).digest();
}

/** The code for one member of one group. Ids are used in lower case. */
export function chatKeyFor(secret: string, groupId: string, userId: string): string {
  return digest(secret, groupId, userId).toString("base64url");
}

/**
 * The member a code names, among the group's ACTIVE members, or null: for a malformed code, one
 * made for another group or with another secret, and one for somebody who is not in the list. It
 * never throws for a bad code. The code is compared with each member's with `timingSafeEqual`,
 * and every member is compared (no early exit), so the time says nothing about who matched.
 */
export function findMemberByChatKey(secret: string, groupId: string, activeUserIds: string[], key: string): string | null {
  if (typeof key !== "string" || key.length !== KEY_LENGTH || !BASE64URL.test(key)) return null;
  const given = Buffer.from(key, "base64url");
  // Only the canonical spelling: the last character's unused bits must not make a second valid code.
  if (given.length !== KEY_BYTES || given.toString("base64url") !== key) return null;

  let match: string | null = null;
  for (const userId of activeUserIds) {
    if (timingSafeEqual(given, digest(secret, groupId, userId))) match ??= userId;
  }
  return match;
}

/**
 * A short opaque tag for the signed-in person, sent to their browser so a store of "what this
 * person has already been told" is never shared between two accounts used in one tab. It is a
 * different code from every chat key (its own label), so it opens nothing. Stable for a person.
 */
export function viewerTokenFor(secret: string, userId: string): string {
  if (secret === "") throw new Error("Viewer tokens need a secret.");
  return createHmac("sha256", secret).update(`unread-viewer:${userId.toLowerCase()}`).digest("base64url").slice(0, 22);
}
