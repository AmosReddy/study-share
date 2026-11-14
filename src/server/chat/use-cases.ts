import { can, type Action } from "@/server/permissions";
import type { GroupRecord, Membership } from "@/server/ports/group-store";
import type { MessageRecord, MessageStore } from "@/server/ports/message-store";
import { overLimit, parse, type ActionResult } from "@/server/use-case-kit";
import { decodeResourceCursor } from "@/server/resource-cursor";
import { actionContext, memberContext, type GroupDeps } from "@/server/groups/use-cases";
import { CHAT_MESSAGES } from "@/shared/chat-messages";
import { uuidSchema } from "@/shared/groups";
import { sendMessageSchema } from "@/shared/message-schemas";
import { CHAT_LIMITS } from "@/shared/messages";
import { CHAT_SEND_USER_LIMIT } from "./rate-limit-policy";

/*
  Chat use-cases: send a message, load the chat (the latest page, newer messages for polling, or
  an earlier page) and delete a message. Plain functions over ports, so they run in unit tests
  with the fakes. There is one chat per group, text only, no editing, no replies.

  Who may do what:
  - Every one of them first checks that the caller is an ACTIVE member of a live group, through
    groups.getMembership and can(). A stranger, a removed member, an unknown or deleted group, a
    malformed id and a message that is missing, deleted or in another group all get the same
    answer (`notFound`, or null for the read), so nothing says whether a message exists.
  - Deleting your OWN message is not a role in the permissions table: it is decided here from the
    record's senderId (an active member, `chat.view`, who sent it). Only deleting other people's
    messages is a role, `message.delete.any` (the owner). Nobody edits a message.
  - A message is looked up in the group named by the ADDRESS, never by id alone, so a member of
    group B cannot touch group A's message by putting its id under B's address.

  Nothing here puts an id, a person's account id or an error's text in a message or a log line:
  failures log a fixed sentence and answer with a fixed message from src/shared/chat-messages.ts.
  The views never include an account id.
*/

export type ChatDeps = GroupDeps & {
  messages: MessageStore;
};

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

/** The address-bar query: at most one of these is used (`after` wins when both are given). */
export type ChatQuery = { after?: string; before?: string };

/** An action's answer: the usual result, or `notFound` for everything that must look like a missing message. */
export type ChatResult<T = void> = ActionResult<T> | { ok: false; notFound: true; formError: string };

const NOT_FOUND = { ok: false, notFound: true, formError: CHAT_MESSAGES.notFound } as const;
const COULD_NOT_SAVE = { ok: false, formError: CHAT_MESSAGES.couldNotSave } as const;

type ActionAccess = { ok: true; group: GroupRecord; membership: Membership } | typeof NOT_FOUND | typeof COULD_NOT_SAVE;

/**
 * The group and the caller's membership, when the caller is an active member who may do `action`.
 * A store failure while checking is logged as a fixed line and answers couldNotSave.
 */
async function actionAccess(deps: ChatDeps, groupId: string, action: Action): Promise<ActionAccess> {
  const found = await actionContext(deps, groupId, "Could not check the group.");
  if (found.failed) return COULD_NOT_SAVE;
  const context = found.context;
  if (!context?.membership || !can(deps.user, action, { membership: context.membership })) return NOT_FOUND;
  return { ok: true, group: context.group, membership: context.membership };
}

/**
 * Like actionAccess for the read: null for anyone who may not, and a store failure THROWS (the
 * route's error answer), so an outage never turns into "not found".
 */
async function readAccess(deps: ChatDeps, groupId: string, action: Action) {
  const context = await memberContext(deps, groupId);
  if (!context?.membership || !can(deps.user, action, { membership: context.membership })) return null;
  return { group: context.group, membership: context.membership };
}

const isSender = (deps: ChatDeps, record: MessageRecord) => record.senderId !== null && record.senderId === deps.user.id;

function viewOf(deps: ChatDeps, membership: Membership, record: MessageRecord): MessageView {
  const mine = isSender(deps, record);
  return {
    id: record.id,
    clientId: record.clientId,
    body: record.body,
    senderName: record.senderName.trim() === "" ? CHAT_MESSAGES.formerMember : record.senderName,
    mine,
    canDelete: mine || can(deps.user, "message.delete.any", { membership }),
    createdAt: record.createdAt.toISOString(),
    cursor: record.cursor,
  };
}

/**
 * Sends a message to the group's chat: the caller must be an active member. The text is cleaned
 * (see cleanMessageBody) and must be 1 to 2000 characters; field errors are keyed `body` and
 * `clientId`. Sending is limited to 20 a minute per person. Sending the same `clientId` again
 * (a retry after a dropped connection) saves nothing new and answers with the first message, so
 * it is safe to repeat; a client id that already belongs to someone else's message, or to a
 * message that has since been deleted, is refused.
 */
export async function sendMessage(deps: ChatDeps, groupId: string, raw: unknown): Promise<ChatResult<MessageView>> {
  const access = await actionAccess(deps, groupId, "chat.send");
  if (!access.ok) return access;

  const parsed = parse(sendMessageSchema, raw, CHAT_MESSAGES.badForm);
  if ("failure" in parsed) return parsed.failure;
  const { body, clientId } = parsed.data;

  const refused = await overLimit(
    deps.limiter,
    [{ key: `chat-send:user:${deps.user.id}`, limit: CHAT_SEND_USER_LIMIT }],
    CHAT_MESSAGES.tooMany,
  );
  if (refused) return refused;

  try {
    const { message, created } = await deps.messages.send({ groupId: access.group.id, senderId: deps.user.id, clientId, body });
    if (!created) {
      // A repeat of this person's own send is fine and answers with the first message. Anything
      // else (someone else's message under this client id, or one that has been deleted) is not.
      if (message.deleted) return { ok: false, formError: CHAT_MESSAGES.messageRemoved };
      if (!isSender(deps, message)) return COULD_NOT_SAVE;
    }
    return { ok: true, data: viewOf(deps, access.membership, message) };
  } catch {
    console.error("Could not save a chat message.");
    return COULD_NOT_SAVE;
  }
}

/** A query value that is a non-empty string, or undefined. */
const cursorText = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);

/**
 * One page of the chat for a member. No `query`: the latest 50 messages. `after`: the messages
 * newer than that cursor (the poll). `before`: the page of messages just older than it. A cursor
 * that is not one is treated as none, so the latest page comes back. Null for anyone who may not
 * read the chat. A store failure throws.
 */
export async function loadChat(deps: ChatDeps, groupId: string, query: ChatQuery = {}): Promise<ChatPage | null> {
  const access = await readAccess(deps, groupId, "chat.view");
  if (!access) return null;

  const after = cursorText(query.after);
  const before = after === undefined ? cursorText(query.before) : undefined;
  const size = CHAT_LIMITS.pageSize;
  const page =
    after !== undefined
      ? await deps.messages.listAfter(access.group.id, after, size)
      : before !== undefined
        ? await deps.messages.listBefore(access.group.id, before, size)
        : await deps.messages.listLatest(access.group.id, size);

  const messages = page.messages.map((record) => viewOf(deps, access.membership, record));
  const newest = messages[messages.length - 1];
  let cursor: string | null;
  if (before !== undefined) cursor = null;
  else if (newest) cursor = newest.cursor;
  else cursor = after !== undefined && decodeResourceCursor(after) ? after : null;

  return {
    messages,
    hasMore: page.hasMore,
    cursor,
    canDeleteAny: can(deps.user, "message.delete.any", { membership: access.membership }),
  };
}

/**
 * Deletes a message: its sender, or the owner (`message.delete.any`). The message is looked up in
 * the group named by the address, so another group's message id finds nothing. Deleting a message
 * that is gone already answers notFound, like any message that is not there.
 */
export async function deleteMessage(deps: ChatDeps, groupId: string, messageId: string): Promise<ChatResult> {
  const access = await actionAccess(deps, groupId, "chat.view");
  if (!access.ok) return access;
  const id = uuidSchema.safeParse(messageId);
  if (!id.success) return NOT_FOUND;

  try {
    const record = await deps.messages.findById(access.group.id, id.data);
    if (!record) return NOT_FOUND;
    if (!isSender(deps, record) && !can(deps.user, "message.delete.any", { membership: access.membership })) return NOT_FOUND;
    const removed = await deps.messages.softDelete(access.group.id, record.id);
    return removed ? { ok: true, data: undefined } : NOT_FOUND;
  } catch {
    console.error("Could not delete a chat message.");
    return COULD_NOT_SAVE;
  }
}
