export type MessageRecord = {
  id: string;
  groupId: string;
  /** Null once the sender's account is gone (the message stays). */
  senderId: string | null;
  /** The sender's display name; empty when it is unknown or the sender is a former member. */
  senderName: string;
  body: string;
  /** The id the sender's browser made for this message; (groupId, clientId) is unique. */
  clientId: string;
  createdAt: Date;
  /** True for a message that was deleted. Only `send` (a retry) and `softDelete` can return one. */
  deleted: boolean;
  /**
   * This message's place in the chat (creation time in microseconds, then id), opaque. Pass it as
   * `after` to get the messages that come later, or as `before` to get the ones that came earlier.
   */
  cursor: string;
};

export type NewMessage = {
  groupId: string;
  senderId: string;
  clientId: string;
  /** Stored as given: the caller trims and cleans it (the database refuses an empty or 2000+ one). */
  body: string;
};

/** Messages oldest first. `hasMore` is whether more exist beyond them, in the direction asked (see each method). */
export type MessagePage = { messages: MessageRecord[]; hasMore: boolean };

/**
 * The chat of each group. A message that is not in a live group (deleted or unknown) is not found
 * by any method; the store does not know who may see what, so callers check membership first.
 * Deleted messages are never listed or found.
 */
export interface MessageStore {
  /**
   * Saves a message. When (groupId, clientId) is taken already, nothing is saved and the EXISTING
   * message comes back with created false, even when it was deleted (`deleted` is then true and it
   * is not brought back), and whoever sent it: the caller decides what a mismatch means. Throws when
   * the group does not exist or is deleted, the sender has no account, an id is not a uuid, or the
   * body breaks the rules in src/shared/messages.ts (the database refuses them too: 1 to 2000
   * characters after trimming spaces, no NUL character).
   */
  send(input: NewMessage): Promise<{ message: MessageRecord; created: boolean }>;
  /** The newest `limit` (clamped to 1..50) messages, oldest first; `hasMore` is whether older ones exist. */
  listLatest(groupId: string, limit: number): Promise<MessagePage>;
  /**
   * Messages strictly after `cursor`, oldest first, at most `limit`; `hasMore` is whether still
   * newer ones exist (poll again). A cursor that is not one made by this store is treated as no
   * cursor: the answer is then listLatest's (and `hasMore` means older ones exist).
   */
  listAfter(groupId: string, cursor: string, limit: number): Promise<MessagePage>;
  /**
   * The `limit` messages just before `cursor`, oldest first; `hasMore` is whether older ones
   * exist. A cursor that is not one made by this store is treated as no cursor: listLatest's answer.
   */
  listBefore(groupId: string, cursor: string, limit: number): Promise<MessagePage>;
  /** One message that is not deleted, in this group. Null for a malformed id, another group's message, a deleted one. */
  findById(groupId: string, id: string): Promise<MessageRecord | null>;
  /** Marks the message deleted (the row stays) and returns it. Null when not found or deleted already. */
  softDelete(groupId: string, id: string): Promise<MessageRecord | null>;
}
