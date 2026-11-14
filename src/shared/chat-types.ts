/*
  What the chat's server code and the chat's browser code both know: the shapes of a message, a
  page of the chat and the answers of the two chat actions. Plain data only (it crosses the network
  as JSON and as a server action's answer), and never an account id.
*/

/** A message as the pages may see it: no account ids. */
export type MessageView = {
  id: string;
  /** The id the sender's browser made for it, so a browser can match its own pending message. */
  clientId: string;
  body: string;
  /** "Former member" when the sender's account is gone. */
  senderName: string;
  /** Sent by the caller. */
  mine: boolean;
  /** For the caller: the sender, or the owner. */
  canDelete: boolean;
  /** ISO 8601. */
  createdAt: string;
  /** This message's place in the chat: pass it as `after` (newer) or `before` (older). */
  cursor: string;
};

export type ChatPage = {
  /** Oldest first. */
  messages: MessageView[];
  /**
   * Whether more messages exist beyond these in the direction asked: older ones for the latest
   * page and for `before`; newer ones (ask again straight away) for `after`.
   */
  hasMore: boolean;
  /**
   * Where to poll from next: the newest message returned, or for `after` the cursor given when
   * nothing is new. Null when the chat is empty and for `before` (an earlier page does not move
   * the place the browser polls from).
   */
  cursor: string | null;
  /** The caller may delete any message (the owner). */
  canDeleteAny: boolean;
};

/** What sendMessageAction answers. `notFound` means the person can no longer see this chat. */
export type SendMessageResult =
  | { ok: true; message: MessageView }
  | { ok: false; notFound?: true; error: string };

/** What deleteMessageAction answers. `notFound` means the message is gone already or was never theirs to delete. */
export type DeleteMessageResult = { ok: true } | { ok: false; notFound?: true; error: string };
