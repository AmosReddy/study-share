/**
 * Chat limits, in one place. The body limit matches the messages table's check constraint
 * (migration 0006); the page size is how many messages one request returns.
 */
export const CHAT_LIMITS = {
  /** Most characters (code points) in one message, after trimming. */
  maxBody: 2000,
  /** Messages in one page of the chat. */
  pageSize: 50,
} as const;
