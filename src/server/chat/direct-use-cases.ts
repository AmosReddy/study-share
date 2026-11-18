import { can, type Action } from "@/server/permissions";
import type { GroupRecord, Membership } from "@/server/ports/group-store";
import type { DirectChatStore, DirectMessageRecord } from "@/server/ports/direct-chat-store";
import { overLimit, parse } from "@/server/use-case-kit";
import { decodeResourceCursor } from "@/server/resource-cursor";
import { chatKeyFor, findMemberByChatKey } from "@/server/groups/chat-key";
import { actionContext, memberContext, type GroupDeps, type MemberEntry } from "@/server/groups/use-cases";
import { CHAT_MESSAGES } from "@/shared/chat-messages";
import type { MessageView } from "@/shared/chat-types";
import { DIRECT_CHAT_MESSAGES } from "@/shared/direct-chat-messages";
import type { DirectChatPage, PrivateChatRow, PrivateUnread } from "@/shared/direct-chat-types";
import { uuidSchema } from "@/shared/groups";
import { sendMessageSchema } from "@/shared/message-schemas";
import { CHAT_LIMITS } from "@/shared/messages";
import { DIRECT_OPEN_USER_LIMIT, DIRECT_SEND_USER_LIMIT, directOpenKey, directSendKey } from "./direct-rate-limit-policy";
import type { ChatQuery, ChatResult } from "./use-cases";

/*
  Private chat use-cases: open a chat with another member, list a person's chats, load one (the
  latest page, newer messages for polling, or an earlier page), send a message, delete your own
  message, and the unread dots. Plain functions over ports, so they run in unit tests with the
  fakes. They mirror the group chat's (src/server/chat/use-cases.ts) with a participant rule on top.

  THE RULE, applied by every function that takes a chat id (directAccess below):
  - The caller is an ACTIVE member of a LIVE group (groups.getMembership and can()), AND
  - the chat belongs to the group in the ADDRESS (findChat is asked for that group, so a chat id
    of another group finds nothing), AND
  - the caller is one of the chat's two people.
  Anything else (a stranger, a removed or departed member, the group's owner when not one of the
  two, a member of another group, an unknown or deleted group, a malformed id, a chat of another
  group or pair) gets the same answer: `notFound` (null for a read), so nothing says whether a
  chat exists.
  - Reading needs only that. Writing and deleting your own message also need the OTHER person to
    still be an active member; otherwise the chat is read-only and the answer is `readOnly`
    (the caller may read, so telling them why leaks nothing).
  - The owner has NO power here: `message.delete.any` is never asked. Deleting is for the sender
    only, decided from the record's senderId.
  - These functions never touch the group chat's message store (it is not even in their deps).

  A person is never named by account id in anything returned or logged: the list gives chat ids
  and names, and a member is told apart in the Members list by a one-way `chatKey` (see
  src/server/groups/chat-key.ts). Failures log a fixed sentence and answer with a fixed message.
*/

export type DirectChatDeps = GroupDeps & {
  direct: DirectChatStore;
  /** The service-role key, which chat keys are made with. Never returned, logged or sent anywhere. */
  secret: string;
};

export type { DirectChatPage, PrivateChatRow, PrivateUnread };

/** A private chat action's answer: the usual result, `notFound` for everything that must look missing, or `readOnly` for a chat the person may read but not write to. */
export type DirectResult<T = void> = ChatResult<T> | { ok: false; readOnly: true; formError: string };

const NOT_FOUND = { ok: false, notFound: true, formError: DIRECT_CHAT_MESSAGES.notFound } as const;
const COULD_NOT_SAVE = { ok: false, formError: CHAT_MESSAGES.couldNotSave } as const;
const READ_ONLY = { ok: false, readOnly: true, formError: DIRECT_CHAT_MESSAGES.readOnly } as const;

/** What privateUnread answers when there is nothing to show (made fresh each time: callers may change it). */
const noUnread = (): PrivateUnread => ({ any: false, fromChatKeys: [] });

/** A name for a person, or the fixed "Former member" when it is not known. */
const nameOrFormer = (name: string) => (name.trim() === "" ? DIRECT_CHAT_MESSAGES.formerMember : name);

type Access = {
  group: GroupRecord;
  membership: Membership;
  chat: { id: string; participants: [string, string] };
  /** The other person's id, for the server only. */
  otherId: string;
  /** The other person is still an active member of the group: the chat can be written to. */
  otherActive: boolean;
  otherName: string;
};

/**
 * Applies the participant rule for `action` (chat.view to read and delete, chat.send to write).
 * Null for everyone who fails it. A store failure THROWS: reads let it through, and actions catch
 * it (see `guarded`), so an outage never turns into "not found".
 */
async function directAccess(deps: DirectChatDeps, groupId: string, chatId: string, action: Action): Promise<Access | null> {
  const context = await memberContext(deps, groupId);
  if (!context?.membership || !can(deps.user, action, { membership: context.membership })) return null;
  const id = uuidSchema.safeParse(chatId);
  if (!id.success) return null;
  // Asked for THIS group: a chat of another group is not found.
  const chat = await deps.direct.findChat(context.group.id, id.data);
  if (!chat) return null;
  const me = deps.user.id.toLowerCase();
  const [low, high] = chat.participants.map((p) => p.toLowerCase());
  if (me !== low && me !== high) return null;
  const otherId = me === low ? high : low;

  const members = await deps.groups.listMembers(context.group.id);
  const other = members.find((m) => m.userId.toLowerCase() === otherId);
  let otherName = other?.displayName ?? "";
  if (!other) {
    // Someone who has left: their name is on the chat's list entry (which exists once they have written or been written to).
    const summaries = await deps.direct.listChatsFor(context.group.id, me);
    otherName = summaries.find((s) => s.chatId === chat.id)?.otherName ?? "";
  }
  return {
    group: context.group,
    membership: context.membership,
    chat: { id: chat.id, participants: chat.participants },
    otherId,
    otherActive: other !== undefined,
    otherName: nameOrFormer(otherName),
  };
}

/** directAccess for actions: a store failure logs `logLine` (a fixed sentence) and comes back as `failed`. */
async function guarded(
  deps: DirectChatDeps,
  groupId: string,
  chatId: string,
  action: Action,
  logLine: string,
): Promise<{ failed: true } | { failed: false; access: Access | null }> {
  try {
    return { failed: false, access: await directAccess(deps, groupId, chatId, action) };
  } catch {
    console.error(logLine);
    return { failed: true };
  }
}

const isSender = (deps: DirectChatDeps, record: DirectMessageRecord) =>
  record.senderId !== null && record.senderId.toLowerCase() === deps.user.id.toLowerCase();

/** `canWrite`: the other person is still in the group, so the sender may delete their own message. */
function viewOf(deps: DirectChatDeps, canWrite: boolean, record: DirectMessageRecord): MessageView {
  const mine = isSender(deps, record);
  return {
    id: record.id,
    clientId: record.clientId,
    body: record.body,
    senderName: nameOrFormer(record.senderName),
    mine,
    canDelete: mine && canWrite,
    createdAt: record.createdAt.toISOString(),
    cursor: record.cursor,
  };
}

/**
 * Opens (makes, when it is new) the person's private chat with the member that `chatKey` names,
 * and answers its id. Needs an active member of a live group; the key must name ANOTHER ACTIVE
 * member of THIS group (a garbled key, your own, another group's, someone who left or was removed,
 * a stranger's: all `notFound`). At most 30 openings an hour per person. Nothing is visible to the
 * other person until a message is written (empty chats are not listed).
 */
export async function openDirectChat(deps: DirectChatDeps, groupId: string, chatKey: unknown): Promise<ChatResult<{ chatId: string }>> {
  const found = await actionContext(deps, groupId, "Could not check the group.");
  if (found.failed) return COULD_NOT_SAVE;
  const context = found.context;
  if (!context?.membership || !can(deps.user, "chat.send", { membership: context.membership })) return NOT_FOUND;

  const refused = await overLimit(
    deps.limiter,
    [{ key: directOpenKey(deps.user.id), limit: DIRECT_OPEN_USER_LIMIT }],
    DIRECT_CHAT_MESSAGES.tooManyChats,
  );
  if (refused) return refused;

  try {
    const members = await deps.groups.listMembers(context.group.id);
    const target = findMemberByChatKey(
      deps.secret,
      context.group.id,
      members.map((m) => m.userId),
      typeof chatKey === "string" ? chatKey : "",
    );
    if (target === null || target.toLowerCase() === deps.user.id.toLowerCase()) return NOT_FOUND;
    const { chatId } = await deps.direct.openChat(context.group.id, deps.user.id, target);
    return { ok: true, data: { chatId } };
  } catch {
    console.error("Could not open a private chat.");
    return COULD_NOT_SAVE;
  }
}

/**
 * The person's private chats in the group, newest first: only chats with a message that is not
 * deleted, and chats whose other person has left stay (read-only). Null for anyone who may not
 * use the group's chat. A store failure throws.
 */
export async function listPrivateChats(deps: DirectChatDeps, groupId: string): Promise<{ chats: PrivateChatRow[] } | null> {
  const context = await memberContext(deps, groupId);
  if (!context?.membership || !can(deps.user, "chat.view", { membership: context.membership })) return null;
  const [summaries, members] = await Promise.all([
    deps.direct.listChatsFor(context.group.id, deps.user.id),
    deps.groups.listMembers(context.group.id),
  ]);
  const active = new Set(members.map((m) => m.userId.toLowerCase()));
  return {
    chats: summaries.map((s) => ({
      chatId: s.chatId,
      name: nameOrFormer(s.otherName),
      otherGone: !active.has(s.otherUserId.toLowerCase()),
      // One line: breaks and runs of spaces in the message become single spaces.
      preview: s.lastBody.replace(/\s+/g, " ").trim(),
      lastAt: s.lastAt.toISOString(),
      unread: s.unread,
    })),
  };
}

/** A query value that is a non-empty string, or undefined. */
const cursorText = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);

/**
 * One page of a private conversation, for a participant. No `query`: the latest 50 messages.
 * `after`: the messages newer than that cursor (the poll). `before`: the page just older. A cursor
 * that is not one is treated as none, so the latest page comes back. When the page shows the
 * NEWEST messages (the latest page, or a poll with news) the caller's read position moves up to
 * the newest of them (forward only; an earlier page never moves it). Null for anyone who is not
 * a participant of this chat in this group. A store failure throws, except that a failure to
 * record the read position is only logged.
 */
export async function loadDirectChat(
  deps: DirectChatDeps,
  groupId: string,
  chatId: string,
  query: ChatQuery = {},
): Promise<DirectChatPage | null> {
  const access = await directAccess(deps, groupId, chatId, "chat.view");
  if (!access) return null;

  const after = cursorText(query.after);
  const before = after === undefined ? cursorText(query.before) : undefined;
  const size = CHAT_LIMITS.pageSize;
  const page =
    after !== undefined
      ? await deps.direct.listAfter(access.chat.id, after, size)
      : before !== undefined
        ? await deps.direct.listBefore(access.chat.id, before, size)
        : await deps.direct.listLatest(access.chat.id, size);

  const messages = page.messages.map((record) => viewOf(deps, access.otherActive, record));
  const newest = messages[messages.length - 1];
  let cursor: string | null;
  if (before !== undefined) cursor = null;
  else if (newest) cursor = newest.cursor;
  else cursor = after !== undefined && decodeResourceCursor(after) ? after : null;

  if (before === undefined && newest) {
    try {
      await deps.direct.markRead(access.chat.id, deps.user.id, newest.cursor);
    } catch {
      console.error("Could not mark a private chat as read.");
    }
  }

  return {
    messages,
    hasMore: page.hasMore,
    cursor,
    canSend: access.otherActive,
    otherName: access.otherName,
    otherGone: !access.otherActive,
  };
}

/**
 * Sends a message in a private chat: the caller must be a participant AND the other person must
 * still be an active member (else `readOnly`). The text is cleaned and limited exactly like a group
 * message; field errors are keyed `body` and `clientId`. 20 sends a minute per person (its own
 * limit, apart from the group chat's). Sending the same `clientId` again answers with the first
 * message and saves nothing new; a client id that belongs to the other person's message, or to a
 * message that has since been deleted, is refused.
 */
export async function sendDirectMessage(deps: DirectChatDeps, groupId: string, chatId: string, raw: unknown): Promise<DirectResult<MessageView>> {
  const checked = await guarded(deps, groupId, chatId, "chat.send", "Could not check the private chat.");
  if (checked.failed) return COULD_NOT_SAVE;
  const access = checked.access;
  if (!access) return NOT_FOUND;
  if (!access.otherActive) return READ_ONLY;

  const parsed = parse(sendMessageSchema, raw, CHAT_MESSAGES.badForm);
  if ("failure" in parsed) return parsed.failure;
  const { body, clientId } = parsed.data;

  const refused = await overLimit(deps.limiter, [{ key: directSendKey(deps.user.id), limit: DIRECT_SEND_USER_LIMIT }], CHAT_MESSAGES.tooMany);
  if (refused) return refused;

  try {
    const { message, created } = await deps.direct.send({ chatId: access.chat.id, senderId: deps.user.id, clientId, body });
    if (!created) {
      // A repeat of this person's own send is fine and answers with the first message. Anything
      // else (the other person's message under this client id, or one that has been deleted) is not.
      if (message.deleted) return { ok: false, formError: CHAT_MESSAGES.messageRemoved };
      if (!isSender(deps, message)) return COULD_NOT_SAVE;
    }
    return { ok: true, data: viewOf(deps, true, message) };
  } catch {
    console.error("Could not save a private message.");
    return COULD_NOT_SAVE;
  }
}

/**
 * Deletes the caller's OWN message in a private chat, while the other person is still in the group
 * (else `readOnly`). The message is looked up in the chat named by the address, so another chat's
 * message id finds nothing. The other person's message, one that is gone already and a malformed
 * id all answer `notFound`. Nobody else can delete it: not the group's owner either.
 */
export async function deleteDirectMessage(deps: DirectChatDeps, groupId: string, chatId: string, messageId: string): Promise<DirectResult> {
  const checked = await guarded(deps, groupId, chatId, "chat.view", "Could not check the private chat.");
  if (checked.failed) return COULD_NOT_SAVE;
  const access = checked.access;
  if (!access) return NOT_FOUND;
  if (!access.otherActive) return READ_ONLY;
  const id = uuidSchema.safeParse(messageId);
  if (!id.success) return NOT_FOUND;

  try {
    const record = await deps.direct.findMessageById(access.chat.id, id.data);
    if (!record || !isSender(deps, record)) return NOT_FOUND;
    const removed = await deps.direct.softDelete(access.chat.id, record.id);
    return removed ? { ok: true, data: undefined } : NOT_FOUND;
  } catch {
    console.error("Could not delete a private message.");
    return COULD_NOT_SAVE;
  }
}

/**
 * For the unread dots: whether the person has any private message they have not seen in this
 * group, and the `chatKey`s of the ACTIVE members who sent them (the Members list's rows). A
 * message from someone who has left still makes `any` true (the chat is in the Private list) but
 * has no key. Empty for anyone who may not use the group's chat. A dot is a nicety, so a store
 * failure logs a fixed line and answers empty instead of breaking the page that asked.
 */
export async function privateUnread(deps: DirectChatDeps, groupId: string): Promise<PrivateUnread> {
  try {
    const context = await memberContext(deps, groupId);
    if (!context?.membership || !can(deps.user, "chat.view", { membership: context.membership })) return noUnread();
    const summary = await deps.direct.unreadSummary(context.group.id, deps.user.id);
    if (!summary.any) return noUnread();
    const members = await deps.groups.listMembers(context.group.id);
    const active = new Set(members.map((m) => m.userId.toLowerCase()));
    return {
      any: true,
      fromChatKeys: summary.fromUserIds.filter((id) => active.has(id.toLowerCase())).map((id) => chatKeyFor(deps.secret, context.group.id, id)),
    };
  } catch {
    console.error("Could not check for unread private messages.");
    return noUnread();
  }
}

/** A row of the Members list with the code for starting a private chat. `chatKey` is null on your own row. */
export type MemberWithChatKey = MemberEntry & { chatKey: string | null };

/**
 * The Members list (the same rows and rules as listGroupMembers: active members, ids only for the
 * owner) with each OTHER member's `chatKey`. Null for anyone who may not see the list. A store
 * failure throws.
 */
export async function listMembersWithChatKeys(deps: DirectChatDeps, groupId: string): Promise<MemberWithChatKey[] | null> {
  const context = await memberContext(deps, groupId);
  if (!context?.membership || !can(deps.user, "group.members.view", { membership: context.membership })) return null;
  const withIds = can(deps.user, "group.members.remove", { membership: context.membership });
  const rows = await deps.groups.listMembers(context.group.id);
  return rows.map(({ userId, ...row }) => {
    const isYou = userId === deps.user.id;
    return {
      ...row,
      isYou,
      ...(withIds ? { userId } : {}),
      chatKey: isYou ? null : chatKeyFor(deps.secret, context.group.id, userId),
    };
  });
}
