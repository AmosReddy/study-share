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
