/**
 * A message of a private chat: the group chat's MessageRecord, with the chat's id in place of the
 * group's. Names and cursors work the same way (see src/server/ports/message-store.ts).
 */
export type DirectMessageRecord = {
  id: string;
  chatId: string;
  /** Null once the sender's account is gone (the message stays). */
  senderId: string | null;
  /** The sender's display name; empty when it is unknown. */
  senderName: string;
  body: string;
  /** The id the sender's browser made for this message; (chatId, clientId) is unique. */
  clientId: string;
  createdAt: Date;
  /** True for a message that was deleted. Only `send` (a retry) and `softDelete` can return one. */
  deleted: boolean;
  /** This message's place in the chat (creation time in microseconds, then id), opaque. */
  cursor: string;
};

export type NewDirectMessage = {
  chatId: string;
  senderId: string;
  clientId: string;
  /** Stored as given: the caller trims and cleans it (the database refuses an empty or 2000+ one). */
  body: string;
};

/** Messages oldest first. `hasMore` is whether more exist beyond them, in the direction asked. */
export type DirectMessagePage = { messages: DirectMessageRecord[]; hasMore: boolean };

/** One row of a person's list of private chats. Only chats with a message that is not deleted are listed. */
export type DirectChatSummary = {
  chatId: string;
  otherUserId: string;
  /** The other person's display name; empty when they have no profile. */
  otherName: string;
  /** The newest message that is not deleted, cut to 80 characters (as people see them). */
  lastBody: string;
  lastAt: Date;
  /** The other person sent a message (not deleted) that is newer than this person's read position. */
  unread: boolean;
};

/**
 * The private chats of the groups: one chat per pair of people per group. The store knows the two
 * people of a chat and nothing about who is in the group: callers check membership AND that the
 * person is one of the two, first. A chat or message of a deleted group is not found by any
 * method. Deleted messages are never listed or found. These tables are never shared with the
 * group chat's `messages`.
 */
export interface DirectChatStore {
  /**
   * The chat between two people in a group, made when it does not exist yet (safe to repeat and
   * to run at the same instant: one chat comes back). The pair is stored in a fixed order
   * (`user_low` < `user_high`, compared as lower-case text), so (x, y) and (y, x) are one chat.
   * Throws when the group does not exist or is deleted, an id is not a uuid, the two ids are the
   * same person, or a person has no account.
   */
  openChat(groupId: string, userX: string, userY: string): Promise<{ chatId: string }>;
  /**
   * The chat and its two people (low first), only when it belongs to THIS group and the group is
   * live. Null for a malformed id, an unknown chat, another group's chat and a deleted group.
   */
  findChat(groupId: string, chatId: string): Promise<{ id: string; participants: [string, string] } | null>;
  /**
   * The person's chats in the group that have at least one message that is not deleted, the one
   * with the newest such message first. Empty for a malformed id or a deleted group.
   */
  listChatsFor(groupId: string, userId: string): Promise<DirectChatSummary[]>;
  /**
   * Saves a message. When (chatId, clientId) is taken already, nothing is saved and the EXISTING
   * message comes back with created false, even when it was deleted (`deleted` is then true and it
   * is not brought back). Throws when the chat does not exist, its group is deleted, the sender is
   * not one of the chat's two people (not even for a repeat), an id is not a uuid, or the body
   * breaks the rules in src/shared/messages.ts (1 to 2000 characters after trimming spaces, no NUL).
   */
  send(input: NewDirectMessage): Promise<{ message: DirectMessageRecord; created: boolean }>;
  /** The newest `limit` (clamped to 1..50) messages, oldest first; `hasMore` is whether older ones exist. */
  listLatest(chatId: string, limit: number): Promise<DirectMessagePage>;
  /**
   * Messages strictly after `cursor`, oldest first, at most `limit`; `hasMore` is whether still
   * newer ones exist. A cursor that is not one made by a store is treated as no cursor: the
   * answer is then listLatest's.
   */
  listAfter(chatId: string, cursor: string, limit: number): Promise<DirectMessagePage>;
  /** The `limit` messages just before `cursor`, oldest first. A cursor that is not one: listLatest's answer. */
  listBefore(chatId: string, cursor: string, limit: number): Promise<DirectMessagePage>;
  /** One message that is not deleted, in this chat. Null for a malformed id, another chat's message, a deleted one. */
  findMessageById(chatId: string, id: string): Promise<DirectMessageRecord | null>;
  /** Marks the message deleted (the row stays) and returns it. Null when not found or deleted already. */
  softDelete(chatId: string, id: string): Promise<DirectMessageRecord | null>;
  /**
   * Records that `userId` has seen the chat up to `cursor` (a message's cursor). The position only
   * moves forward: an older or equal cursor changes nothing. Does nothing for a cursor that is not
   * one, an unknown chat or group, a deleted group, or a person who is not one of the chat's two.
   */
  markRead(chatId: string, userId: string, cursor: string): Promise<void>;
  /**
   * For the group and person: whether any of their chats holds a message (not deleted) from the
   * OTHER person that is newer than their read position, and who from. A chat with no messages
   * is never counted. `fromUserIds` has each other person once. Empty for a deleted group.
   */
  unreadSummary(groupId: string, userId: string): Promise<{ any: boolean; fromUserIds: string[] }>;
}
