import type { ChatPage, MessageView } from "@/shared/chat-types";

/*
  The chat screen's state and the rules for changing it, as plain functions so they are tested
  without a browser. Three kinds of answer arrive and are folded into one list:

  - `after`: messages newer than the cursor (the poll), added in time order.
  - `latest`: the newest page, which is the truth for the time range it covers: a message in that
    range that is not in it any more was deleted by someone else and goes. Messages outside the
    range (older ones the person loaded, or newer ones that arrived since) stay. It also catches a
    message committed slightly out of order that an `after` poll skipped.
  - `before`: an earlier page, added above.

  A message the person is sending is kept apart (`pending`) until the server's copy arrives, by the
  send answer or by a poll, whichever is first. The two are matched by clientId, so the message is
  never shown twice. Every list is deduplicated by id and by clientId.
*/

export type PendingMessage = {
  clientId: string;
  body: string;
  /** ISO 8601, the sender's own clock; only used to place it and to group it. */
  createdAt: string;
  status: "sending" | "failed";
  /** Why a failed send failed, in the server's words, when it said. */
  error?: string;
};

export type ChatState = {
  /** What the server confirmed, oldest first. */
  messages: MessageView[];
  /** Messages being sent from this browser that the server has not confirmed. */
  pending: PendingMessage[];
  /** Whether earlier messages exist beyond the oldest one held. */
  hasOlder: boolean;
  /** Where the next poll starts from; null when there is nothing to start from. */
  cursor: string | null;
  canDeleteAny: boolean;
  /** Ids deleted on this screen, so a poll that was already under way cannot bring them back. */
  removed: string[];
};

export type ChatAction =
  /** `known`: the ids of the messages held when the request was made, to tell "deleted" from "added since": only a known message missing from the page is dropped. */
  | { type: "latest"; page: ChatPage; known?: readonly string[] }
  | { type: "after"; page: ChatPage }
  | { type: "before"; page: ChatPage }
  | { type: "queue"; message: PendingMessage }
  | { type: "retry"; clientId: string }
  | { type: "sent"; message: MessageView }
  | { type: "failed"; clientId: string; error?: string }
  | { type: "discard"; clientId: string }
  | { type: "remove"; id: string };

export function initialChatState(page: ChatPage): ChatState {
  const messages = dedupe(page.messages);
  return {
    messages,
    pending: [],
    hasOlder: page.hasMore,
    cursor: messages[messages.length - 1]?.cursor ?? page.cursor,
    canDeleteAny: page.canDeleteAny,
    removed: [],
  };
}

/** The messages with later duplicates (same id, or same clientId) dropped; order kept. */
export function dedupe(messages: readonly MessageView[]): MessageView[] {
  const ids = new Set<string>();
  const clientIds = new Set<string>();
  const out: MessageView[] = [];
  for (const message of messages) {
    if (ids.has(message.id) || clientIds.has(message.clientId)) continue;
    ids.add(message.id);
    clientIds.add(message.clientId);
    out.push(message);
  }
  return out;
}

/** Adds `message` after the last held message that is not newer than it (time order; ties keep arrival order). */
function insertByTime(messages: readonly MessageView[], message: MessageView): MessageView[] {
  let at = messages.length;
  while (at > 0 && messages[at - 1].createdAt > message.createdAt) at -= 1;
  return [...messages.slice(0, at), message, ...messages.slice(at)];
}

const isHeld = (messages: readonly MessageView[], candidate: MessageView) =>
  messages.some((held) => held.id === candidate.id || held.clientId === candidate.clientId);

/** Pending messages the server has confirmed are not pending any more. */
function settle(state: ChatState): ChatState {
  const confirmed = new Set(state.messages.map((message) => message.clientId));
  const pending = state.pending.filter((message) => !confirmed.has(message.clientId));
  return pending.length === state.pending.length ? state : { ...state, pending };
}

function appendNewer(state: ChatState, page: ChatPage): ChatState {
  const removed = new Set(state.removed);
  let messages = state.messages;
  for (const message of page.messages) {
    if (removed.has(message.id) || isHeld(messages, message)) continue;
    messages = insertByTime(messages, message);
  }
  return settle({
    ...state,
    messages,
    cursor: page.cursor ?? state.cursor,
    canDeleteAny: page.canDeleteAny,
  });
}

function mergeLatest(state: ChatState, page: ChatPage, known?: readonly string[]): ChatState {
  // Only a message held when the request was made can have been deleted by the time the page was
  // read; one added since (the viewer's own send, a poll) may simply not be in the page yet. When
  // the caller does not say, everything held counts as known.
  const knownIds = new Set(known ?? state.messages.map((message) => message.id));
  const removed = new Set(state.removed);
  const window = page.messages;
  const visible = window.filter((message) => !removed.has(message.id));
  const inWindow = new Set(window.map((message) => message.id));
  const first = window[0]?.createdAt;

  const older: MessageView[] = [];
  const added: MessageView[] = [];
  for (const held of state.messages) {
    if (inWindow.has(held.id)) continue;
    if (!knownIds.has(held.id)) {
      // Not held when the request was made: keep it, in time order below.
      added.push(held);
    } else if (page.hasMore && first !== undefined && held.createdAt <= first) {
      // Older than the page, which has still older messages beyond it: nothing says it is gone.
      older.push(held);
    }
    // Otherwise it was held before the request and the newest page, which would include it, does
    // not: it was deleted (inside the page's range, newer than it, or before the start of a chat
    // that the page reaches the start of, or the chat is empty).
  }

  let messages = [...older, ...visible];
  for (const held of added) messages = insertByTime(messages, held);
  messages = dedupe(messages);
  return settle({
    ...state,
    messages,
    hasOlder: older.length > 0 ? state.hasOlder : page.hasMore,
    cursor: messages[messages.length - 1]?.cursor ?? page.cursor,
    canDeleteAny: page.canDeleteAny,
  });
}

function prependOlder(state: ChatState, page: ChatPage): ChatState {
  const removed = new Set(state.removed);
  const fresh = dedupe(page.messages).filter((message) => !removed.has(message.id) && !isHeld(state.messages, message));
  return settle({ ...state, messages: [...fresh, ...state.messages], hasOlder: page.hasMore });
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "latest":
      return mergeLatest(state, action.page, action.known);
    case "after":
      return appendNewer(state, action.page);
    case "before":
      return prependOlder(state, action.page);
    case "queue":
      if (state.pending.some((message) => message.clientId === action.message.clientId)) return state;
      return { ...state, pending: [...state.pending, action.message] };
    case "retry":
      return {
        ...state,
        pending: state.pending.map((message) =>
          message.clientId === action.clientId ? { ...message, status: "sending", error: undefined } : message,
        ),
      };
    case "sent": {
      // The send answer is the server's copy. The poll cursor does not move: a message from
      // someone else that landed before this one is still to be fetched.
      const messages = isHeld(state.messages, action.message) ? state.messages : insertByTime(state.messages, action.message);
      return settle({ ...state, messages });
    }
    case "failed":
      return {
        ...state,
        pending: state.pending.map((message) =>
          message.clientId === action.clientId ? { ...message, status: "failed", error: action.error } : message,
        ),
      };
    case "discard":
      return { ...state, pending: state.pending.filter((message) => message.clientId !== action.clientId) };
    case "remove":
      return {
        ...state,
        messages: state.messages.filter((message) => message.id !== action.id),
        removed: state.removed.includes(action.id) ? state.removed : [...state.removed, action.id],
      };
  }
}

/** One line of the list: a confirmed message or one still being sent. `key` is the clientId, so it stays when the server's copy replaces the pending one. */
export type ChatItem = {
  key: string;
  /** The server's id; absent while the message is only on this screen. */
  id?: string;
  body: string;
  senderName: string;
  mine: boolean;
  canDelete: boolean;
  createdAt: string;
  status: "sent" | "sending" | "failed";
  error?: string;
};

/** Everything to show, oldest first: the confirmed messages, then this browser's unconfirmed ones. */
export function chatItems(state: ChatState): ChatItem[] {
  const confirmed = new Set(state.messages.map((message) => message.clientId));
  const items: ChatItem[] = state.messages.map((message) => ({
    key: message.clientId,
    id: message.id,
    body: message.body,
    senderName: message.senderName,
    mine: message.mine,
    canDelete: message.canDelete,
    createdAt: message.createdAt,
    status: "sent",
  }));
  for (const message of state.pending) {
    if (confirmed.has(message.clientId)) continue;
    items.push({
      key: message.clientId,
      body: message.body,
      senderName: "",
      mine: true,
      canDelete: false,
      createdAt: message.createdAt,
      status: message.status,
      ...(message.error ? { error: message.error } : {}),
    });
  }
  return items;
}

/** Whether someone else's message is newer than `seenAt` (ISO), for the "New messages" button. */
export function hasUnseen(items: readonly ChatItem[], seenAt: string): boolean {
  return items.some((item) => !item.mine && item.status === "sent" && item.createdAt > seenAt);
}

/** The time of the newest confirmed message in the list (or "" when there is none). */
export function newestSentAt(items: readonly ChatItem[]): string {
  for (let i = items.length - 1; i >= 0; i -= 1) if (items[i].status === "sent") return items[i].createdAt;
  return "";
}
