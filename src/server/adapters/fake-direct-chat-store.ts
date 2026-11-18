import { CHAT_LIMITS } from "@/shared/messages";
import type {
  DirectChatStore,
  DirectChatSummary,
  DirectMessagePage,
  DirectMessageRecord,
} from "../ports/direct-chat-store";
import { clampResourceLimit, decodeResourceCursor, encodeResourceCursor } from "../resource-cursor";
import { getFakeAuthStore, type FakeAuthStore } from "./fake-auth-provider";
import { isFakeGroupLive } from "./fake-group-store";

/*
  Test-mode DirectChatStore, in memory. Every method is one synchronous section, so each is atomic.
  It refuses what the database refuses (a missing group, person or chat, a body outside the limits,
  a NUL character), takes names from the fake auth store as the SQL store reads them from the
  profiles, treats a group the fake group store has deleted as gone, and treats a chat whose
  person has no account any more as gone (the database cascades it).

  Like the fake message store, creation times are kept in microseconds and never repeat or go
  backwards. Nothing here touches the group chat's fake state, and the other way round.
*/

type Chat = { id: string; groupId: string; low: string; high: string };

type Entry = {
  id: string;
  chatId: string;
  senderId: string;
  clientId: string;
  body: string;
  /** Creation time in microseconds since the epoch. */
  micros: number;
  deletedAt: Date | null;
};

type Position = { micros: number; id: string };

export type FakeDirectChatStoreState = {
  chats: Map<string, Chat>;
  /** Message id to message. Deleted messages stay, as in the database, and every read skips them. */
  messages: Map<string, Entry>;
  /** `${chatId}:${userId}` to the newest message position that person has read. */
  reads: Map<string, Position>;
  /** The latest creation time handed out, in microseconds. */
  lastMicros: number;
};

const STORE_KEY = "__studyShareFakeDirectChatStore";

/**
 * The one state for the running process, on globalThis because Next.js can bundle server actions
 * and route handlers separately, and each bundle would otherwise get its own copy.
 */
function getState(): FakeDirectChatStoreState {
  const g = globalThis as unknown as Record<string, FakeDirectChatStoreState | undefined>;
  return (g[STORE_KEY] ??= { chats: new Map(), messages: new Map(), reads: new Map(), lastMicros: 0 });
}

/** Empties the shared state in place, so stores already created see the reset. */
export function resetFakeDirectChatStore(): void {
  const state = getState();
  state.chats.clear();
  state.messages.clear();
  state.reads.clear();
  state.lastMicros = 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Characters people see (code points), as the database's char_length counts them. */
const length = (text: string) => [...text].length;

/** The database's btrim: spaces only. */
const trimSpaces = (text: string) => text.replace(/^ +| +$/g, "");

/** Order by creation time, then id, as the database orders (created_at, id). */
const comparePositions = (a: Position, b: Position) => a.micros - b.micros || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const SUMMARY_LENGTH = 80;

export function createFakeDirectChatStore(authStore: FakeAuthStore = getFakeAuthStore()): DirectChatStore {
  const state = getState();

  const toRecord = (e: Entry): DirectMessageRecord => {
    const sender = authStore.users.get(e.senderId);
    return {
      id: e.id,
      chatId: e.chatId,
      senderId: sender ? e.senderId : null,
      senderName: sender?.displayName ?? "",
      body: e.body,
      clientId: e.clientId,
      createdAt: new Date(Math.floor(e.micros / 1000)),
      deleted: e.deletedAt !== null,
      cursor: encodeResourceCursor({ micros: e.micros, id: e.id }),
    };
  };

  /** The chat when it exists, its group is live and both people still have an account. */
  const liveChat = (chatId: string): Chat | undefined => {
    if (!UUID.test(chatId)) return undefined;
    const chat = state.chats.get(chatId.toLowerCase());
    if (!chat || !isFakeGroupLive(chat.groupId) || !authStore.users.has(chat.low) || !authStore.users.has(chat.high)) return undefined;
    return chat;
  };

  const isParticipant = (chat: Chat, userId: string) => chat.low === userId || chat.high === userId;

  /** The message when it is not deleted and is in this live chat. */
  const liveEntry = (chatId: string, id: string): Entry | undefined => {
    const chat = liveChat(chatId);
    if (!chat || !UUID.test(id)) return undefined;
    const e = state.messages.get(id.toLowerCase());
    return e && !e.deletedAt && e.chatId === chat.id ? e : undefined;
  };

  /** The messages of a live chat that are not deleted, oldest first. */
  const liveIn = (chatId: string): Entry[] => {
    const chat = liveChat(chatId);
    if (!chat) return [];
    return [...state.messages.values()].filter((e) => e.chatId === chat.id && !e.deletedAt).sort(comparePositions);
  };

  const newest = (entries: Entry[], size: number): DirectMessagePage => ({
    messages: entries.slice(-size).map(toRecord),
    hasMore: entries.length > size,
  });

  const latest = (chatId: string, limit: number) => newest(liveIn(chatId), clampResourceLimit(limit));

  /** Whether `userId` has a message from the OTHER person (not deleted) past their read position. */
  const hasUnread = (chat: Chat, userId: string): boolean => {
    const read = state.reads.get(`${chat.id}:${userId}`);
    return liveIn(chat.id).some((e) => e.senderId !== userId && (!read || comparePositions(e, read) > 0));
  };

  /** The chats of a live group that this person is in, whatever they hold. */
  const chatsOf = (groupId: string, userId: string): Chat[] => {
    if (!UUID.test(groupId) || !UUID.test(userId)) return [];
    const gid = groupId.toLowerCase();
    const uid = userId.toLowerCase();
    return [...state.chats.values()].filter((c) => c.groupId === gid && isParticipant(c, uid) && liveChat(c.id));
  };

  return {
    async openChat(groupId, userX, userY) {
      if (!UUID.test(groupId) || !UUID.test(userX) || !UUID.test(userY)) throw new Error("openChat needs uuids for the group and both people.");
      const gid = groupId.toLowerCase();
      const x = userX.toLowerCase();
      const y = userY.toLowerCase();
      if (x === y) throw new Error("openChat: a chat needs two different people.");
      if (!isFakeGroupLive(gid)) throw new Error("openChat: the group does not exist or is deleted.");
      if (!authStore.users.has(x) || !authStore.users.has(y)) throw new Error("openChat: a person has no account.");
      const [low, high] = x < y ? [x, y] : [y, x];
      for (const c of state.chats.values()) if (c.groupId === gid && c.low === low && c.high === high) return { chatId: c.id };
      const chat: Chat = { id: crypto.randomUUID(), groupId: gid, low, high };
      state.chats.set(chat.id, chat);
      return { chatId: chat.id };
    },

    async findChat(groupId, chatId) {
      const chat = liveChat(chatId);
      if (!chat || !UUID.test(groupId) || chat.groupId !== groupId.toLowerCase()) return null;
      return { id: chat.id, participants: [chat.low, chat.high] };
    },

    async listChatsFor(groupId, userId) {
      const uid = userId.toLowerCase();
      const rows: { summary: DirectChatSummary; last: Position }[] = [];
      for (const chat of chatsOf(groupId, userId)) {
        const entries = liveIn(chat.id);
        const last = entries[entries.length - 1];
        if (!last) continue;
        const otherUserId = chat.low === uid ? chat.high : chat.low;
        rows.push({
          last,
          summary: {
            chatId: chat.id,
            otherUserId,
            otherName: authStore.users.get(otherUserId)?.displayName ?? "",
            lastBody: [...last.body].slice(0, SUMMARY_LENGTH).join(""),
            lastAt: new Date(Math.floor(last.micros / 1000)),
            unread: hasUnread(chat, uid),
          },
        });
      }
      return rows.sort((a, b) => comparePositions(b.last, a.last)).map((r) => r.summary);
    },

    async send(input) {
      if (!UUID.test(input.chatId) || !UUID.test(input.senderId) || !UUID.test(input.clientId)) {
        throw new Error("send needs uuids for the chat, the sender and the client id.");
      }
      const clientId = input.clientId.toLowerCase();
      const chat = liveChat(input.chatId);
      if (!chat) throw new Error("send: the chat does not exist or its group is deleted.");
      const senderId = input.senderId.toLowerCase();
      if (!isParticipant(chat, senderId)) throw new Error("send: the sender is not in this chat.");
      // Postgres cannot store a NUL character in text.
      if (input.body.includes("\u0000")) throw new Error("send: text cannot hold a NUL character.");
      const bodyLength = length(trimSpaces(input.body));
      if (bodyLength < 1 || bodyLength > CHAT_LIMITS.maxBody) throw new Error("A message must be 1 to 2000 characters.");

      for (const e of state.messages.values()) {
        // A repeat: the message that was saved before, as it is now (a deleted one is not brought back).
        if (e.chatId === chat.id && e.clientId === clientId) return { message: toRecord(e), created: false };
      }
      const micros = Math.max(Date.now() * 1000, state.lastMicros + 1);
      state.lastMicros = micros;
      const entry: Entry = { id: crypto.randomUUID(), chatId: chat.id, senderId, clientId, body: input.body, micros, deletedAt: null };
      state.messages.set(entry.id, entry);
      return { message: toRecord(entry), created: true };
    },

    listLatest: async (chatId, limit) => latest(chatId, limit),

    async listAfter(chatId, cursorText, limit) {
      const cursor = decodeResourceCursor(cursorText);
      if (!cursor) return latest(chatId, limit);
      const size = clampResourceLimit(limit);
      const later = liveIn(chatId).filter((e) => comparePositions(e, cursor) > 0);
      return { messages: later.slice(0, size).map(toRecord), hasMore: later.length > size };
    },

    async listBefore(chatId, cursorText, limit) {
      const cursor = decodeResourceCursor(cursorText);
      if (!cursor) return latest(chatId, limit);
      return newest(
        liveIn(chatId).filter((e) => comparePositions(e, cursor) < 0),
        clampResourceLimit(limit),
      );
    },

    async findMessageById(chatId, id) {
      const e = liveEntry(chatId, id);
      return e ? toRecord(e) : null;
    },

    async softDelete(chatId, id) {
      const e = liveEntry(chatId, id);
      if (!e) return null;
      e.deletedAt = new Date();
      return toRecord(e);
    },

    async markRead(chatId, userId, cursorText) {
      const cursor = decodeResourceCursor(cursorText);
      const chat = liveChat(chatId);
      if (!cursor || !chat || !UUID.test(userId)) return;
      const uid = userId.toLowerCase();
      if (!isParticipant(chat, uid)) return;
      const key = `${chat.id}:${uid}`;
      const current = state.reads.get(key);
      if (!current || comparePositions(cursor, current) > 0) state.reads.set(key, { micros: cursor.micros, id: cursor.id });
    },

    async unreadSummary(groupId, userId) {
      const uid = userId.toLowerCase();
      const from = new Set<string>();
      for (const chat of chatsOf(groupId, userId)) {
        if (hasUnread(chat, uid)) from.add(chat.low === uid ? chat.high : chat.low);
      }
      return { any: from.size > 0, fromUserIds: [...from] };
    },
  };
}
