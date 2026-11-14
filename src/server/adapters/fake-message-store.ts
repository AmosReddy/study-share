import { CHAT_LIMITS } from "@/shared/messages";
import type { MessagePage, MessageRecord, MessageStore } from "../ports/message-store";
import { clampResourceLimit, decodeResourceCursor, encodeResourceCursor } from "../resource-cursor";
import { getFakeAuthStore, type FakeAuthStore } from "./fake-auth-provider";
import { isFakeGroupLive } from "./fake-group-store";

/*
  Test-mode MessageStore, in memory. Every method is one synchronous section, so each is atomic.
  It refuses what the database refuses (a missing group or sender, a body outside the limits, a
  NUL character), takes sender names from the fake auth store as the SQL store reads them from the
  profiles, and treats a group the fake group store has deleted as gone.

  Creation times are kept in microseconds and never repeat or go backwards, so messages sent one
  after the other keep that order even within one millisecond (the database's clock has
  microseconds, so it gives the same order in practice).
*/

type Entry = {
  id: string;
  groupId: string;
  senderId: string;
  clientId: string;
  body: string;
  /** Creation time in microseconds since the epoch. */
  micros: number;
  deletedAt: Date | null;
};

export type FakeMessageStoreState = {
  /** Message id to message. Deleted messages stay, as in the database, and every read skips them. */
  messages: Map<string, Entry>;
  /** The latest creation time handed out, in microseconds. */
  lastMicros: number;
};

const STORE_KEY = "__studyShareFakeMessageStore";

/**
 * The one state for the running process, on globalThis because Next.js can bundle server actions
 * and route handlers separately, and each bundle would otherwise get its own copy.
 */
function getState(): FakeMessageStoreState {
  const g = globalThis as unknown as Record<string, FakeMessageStoreState | undefined>;
  return (g[STORE_KEY] ??= { messages: new Map(), lastMicros: 0 });
}

/** Empties the shared state in place, so stores already created see the reset. */
export function resetFakeMessageStore(): void {
  const state = getState();
  state.messages.clear();
  state.lastMicros = 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Characters people see (code points), as the database's char_length counts them. */
const length = (text: string) => [...text].length;

/** The database's btrim: spaces only. */
const trimSpaces = (text: string) => text.replace(/^ +| +$/g, "");

const compare = (a: Entry, b: Entry) => a.micros - b.micros || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function createFakeMessageStore(authStore: FakeAuthStore = getFakeAuthStore()): MessageStore {
  const state = getState();

  const toRecord = (e: Entry): MessageRecord => {
    const sender = authStore.users.get(e.senderId);
    return {
      id: e.id,
      groupId: e.groupId,
      // The database clears the sender when the account is deleted.
      senderId: sender ? e.senderId : null,
      senderName: sender?.displayName ?? "",
      body: e.body,
      clientId: e.clientId,
      createdAt: new Date(Math.floor(e.micros / 1000)),
      deleted: e.deletedAt !== null,
      cursor: encodeResourceCursor({ micros: e.micros, id: e.id }),
    };
  };

  /** The message when it is not deleted, is in this group, and the group is live. */
  const liveEntry = (groupId: string, id: string): Entry | undefined => {
    const e = state.messages.get(id.toLowerCase());
    if (!e || e.deletedAt || e.groupId !== groupId.toLowerCase() || !isFakeGroupLive(e.groupId)) return undefined;
    return e;
  };

  /** The messages of a live group that are not deleted, oldest first. */
  const liveIn = (groupId: string): Entry[] => {
    const gid = groupId.toLowerCase();
    if (!isFakeGroupLive(gid)) return [];
    return [...state.messages.values()].filter((e) => e.groupId === gid && !e.deletedAt).sort(compare);
  };

  /** The newest `size` of `entries` (oldest first), and whether older ones were left out. */
  const newest = (entries: Entry[], size: number): MessagePage => ({
    messages: entries.slice(-size).map(toRecord),
    hasMore: entries.length > size,
  });

  const latest = (groupId: string, limit: number) => newest(liveIn(groupId), clampResourceLimit(limit));

  return {
    async send(input) {
      if (!UUID.test(input.groupId) || !UUID.test(input.senderId) || !UUID.test(input.clientId)) {
        throw new Error("send needs uuids for the group, the sender and the client id.");
      }
      const groupId = input.groupId.toLowerCase();
      const clientId = input.clientId.toLowerCase();
      if (!isFakeGroupLive(groupId)) throw new Error("send: the group does not exist or is deleted.");
      const senderId = input.senderId.toLowerCase();
      if (!authStore.users.has(senderId)) throw new Error("send: the sender has no account.");
      // Postgres cannot store a NUL character in text.
      if (input.body.includes("\u0000")) throw new Error("send: text cannot hold a NUL character.");
      const bodyLength = length(trimSpaces(input.body));
      if (bodyLength < 1 || bodyLength > CHAT_LIMITS.maxBody) throw new Error("A message must be 1 to 2000 characters.");

      for (const e of state.messages.values()) {
        // A repeat: the message that was saved before, as it is now (a deleted one is not brought back).
        if (e.groupId === groupId && e.clientId === clientId) return { message: toRecord(e), created: false };
      }
      const micros = Math.max(Date.now() * 1000, state.lastMicros + 1);
      state.lastMicros = micros;
      const entry: Entry = { id: crypto.randomUUID(), groupId, senderId, clientId, body: input.body, micros, deletedAt: null };
      state.messages.set(entry.id, entry);
      return { message: toRecord(entry), created: true };
    },

    listLatest: async (groupId, limit) => latest(groupId, limit),

    async listAfter(groupId, cursorText, limit) {
      const cursor = decodeResourceCursor(cursorText);
      if (!cursor) return latest(groupId, limit);
      const size = clampResourceLimit(limit);
      const later = liveIn(groupId).filter((e) => e.micros > cursor.micros || (e.micros === cursor.micros && e.id > cursor.id));
      return { messages: later.slice(0, size).map(toRecord), hasMore: later.length > size };
    },

    async listBefore(groupId, cursorText, limit) {
      const cursor = decodeResourceCursor(cursorText);
      if (!cursor) return latest(groupId, limit);
      const earlier = liveIn(groupId).filter((e) => e.micros < cursor.micros || (e.micros === cursor.micros && e.id < cursor.id));
      return newest(earlier, clampResourceLimit(limit));
    },

    async findById(groupId, id) {
      const e = liveEntry(groupId, id);
      return e ? toRecord(e) : null;
    },

    async softDelete(groupId, id) {
      const e = liveEntry(groupId, id);
      if (!e) return null;
      e.deletedAt = new Date();
      return toRecord(e);
    },
  };
}
