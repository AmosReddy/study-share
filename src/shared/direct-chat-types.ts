import type { MessageView } from "./chat-types";

/*
  What the private chats' server code and browser code both know. Plain data only (it crosses the
  network as JSON), and never an account id: a person is told apart by the chat's id or by a
  one-way `chatKey`.
*/

/** One row of a person's Private list. */
export type PrivateChatRow = {
  chatId: string;
  /** The other person's name; "Former member" when it is not known. */
  name: string;
  /** The other person has left the group or was removed: the chat is read-only. */
  otherGone: boolean;
  /** The start of the newest message, on one line. */
  preview: string;
  /** ISO 8601 time of the newest message. */
  lastAt: string;
  /** The other person wrote something this person has not seen yet. */
  unread: boolean;
};

/** The unread dots: whether anything is unread, and the Members rows (by chatKey) to put a dot on. */
export type PrivateUnread = { any: boolean; fromChatKeys: string[] };

/** What /groups/<id>/chat/private/summary answers: the list and the dots, for polling. */
export type PrivateSummary = { chats: PrivateChatRow[]; unread: PrivateUnread };

/** One page of a private conversation (the group chat's ChatPage, with who it is with and whether the person may reply). */
export type DirectChatPage = {
  /** Oldest first. `mine` and `canDelete` follow the private rules (only your own, only while the other person is in the group). */
  messages: MessageView[];
  hasMore: boolean;
  /** Where to poll from next, as in the group chat. */
  cursor: string | null;
  /** The person may write and delete their own messages: the other person is still in the group. */
  canSend: boolean;
  otherName: string;
  otherGone: boolean;
};

/** An unread private chat as the banner names it: the conversation to open and who it is with. Never an account id. */
export type UnreadChat = { chatId: string; name: string };

/**
 * Everything the unread dots and the banner need, for the signed-in person only: whether anything
 * is unread, whose Members rows get a dot (by chatKey) and which conversations are unread.
 */
export type PrivateUnreadState = { any: boolean; fromChatKeys: string[]; chats: UnreadChat[] };

/** Nothing unread (made fresh each time: callers may change it). */
export const noUnreadState = (): PrivateUnreadState => ({ any: false, fromChatKeys: [], chats: [] });

/** The unread state a summary holds (the Private list's poll, or the server's own look). */
export function unreadStateFrom(summary: PrivateSummary): PrivateUnreadState {
  return {
    any: summary.unread.any,
    fromChatKeys: [...summary.unread.fromChatKeys],
    chats: summary.chats.filter((chat) => chat.unread).map((chat) => ({ chatId: chat.chatId, name: chat.name })),
  };
}
