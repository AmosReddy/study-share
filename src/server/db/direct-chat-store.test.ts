import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { encodeResourceCursor } from "@/server/resource-cursor";
import { createDirectChatStore } from "./direct-chat-store";
import { createMessageStore } from "./message-store";

/*
  No database here: a recording stand-in for the connection shows the text of every statement the
  stores send, so two things that must always hold are checked without Postgres:
  - the private chat store never reads or writes the group chat's `messages` table, and the group
    chat's store never reads or writes a private chat table (a forgotten filter in one can then
    never show the other's rows);
  - every value (ids, text, cursors) goes in as a bound parameter, never into the statement text.
  The behaviour itself is tested against a real Postgres by direct-chat-store.int.test.ts.
*/

type Recorded = { text: string; params: unknown[] };

function recorder() {
  const statements: Recorded[] = [];
  const dialect = new PgDialect();
  const execute = async (query: SQL) => {
    const { sql, params } = dialect.sqlToQuery(query);
    statements.push({ text: sql, params });
    return [];
  };
  // Only `execute` is used by the stores; the stand-in answers every statement with no rows.
  return { db: { execute } as never, statements };
}

const GROUP = "11111111-1111-4111-8111-111111111111";
const CHAT = "22222222-2222-4222-8222-222222222222";
const ADA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RAVI = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const MESSAGE = "44444444-4444-4444-8444-444444444444";
const BODY = "hello'; drop table direct_messages; -- <script>";
const CURSOR = encodeResourceCursor({ micros: 1_893_456_000_123_457, id: MESSAGE });

/** Runs a call, ignoring the error a stand-in with no rows makes `send` and `openChat` throw. */
async function attempt(call: () => Promise<unknown>) {
  try {
    await call();
  } catch {
    // expected for send and openChat: nothing came back
  }
}

describe("the private chat store's statements", () => {
  async function everyStatement() {
    const { db, statements } = recorder();
    const store = createDirectChatStore(db);
    await attempt(() => store.openChat(GROUP, ADA, RAVI));
    await store.findChat(GROUP, CHAT);
    await store.listChatsFor(GROUP, ADA);
    await attempt(() => store.send({ chatId: CHAT, senderId: ADA, clientId: CLIENT, body: BODY }));
    await store.listLatest(CHAT, 10);
    await store.listAfter(CHAT, CURSOR, 10);
    await store.listBefore(CHAT, CURSOR, 10);
    await store.findMessageById(CHAT, MESSAGE);
    await store.softDelete(CHAT, MESSAGE);
    await store.markRead(CHAT, ADA, CURSOR);
    await store.unreadSummary(GROUP, ADA);
    return statements;
  }

  it("sends statements for every method", async () => {
    expect((await everyStatement()).length).toBeGreaterThanOrEqual(11);
  });

  it("never touches the group chat's messages table", async () => {
    for (const { text } of await everyStatement()) {
      // "direct_messages" is fine; a bare "messages" table (public.messages, from messages, join messages ...) is not.
      expect(text).not.toMatch(/(?<![A-Za-z_])messages\b/);
      expect(text).toMatch(/direct_(chats|messages|reads)/);
    }
  });

  it("keeps every id, text and cursor out of the statement text: they are bound parameters", async () => {
    const statements = await everyStatement();
    const secrets = [GROUP, CHAT, ADA, RAVI, CLIENT, MESSAGE, BODY, "1893456000123457"];
    for (const { text } of statements) for (const secret of secrets) expect(text).not.toContain(secret);
    // And they do arrive as parameters.
    const params = statements.flatMap((s) => s.params);
    for (const wanted of [GROUP, CHAT, ADA, RAVI, CLIENT, MESSAGE, BODY, "1893456000123457"]) expect(params).toContain(wanted);
  });

  it("orders the pair as the table's check wants, whichever person is named first", async () => {
    for (const [x, y] of [
      [ADA, RAVI],
      [RAVI, ADA],
      [ADA.toUpperCase(), RAVI],
    ]) {
      const { db, statements } = recorder();
      await attempt(() => createDirectChatStore(db).openChat(GROUP, x, y));
      const params = statements[0].params;
      const low = params.indexOf(ADA);
      const high = params.indexOf(RAVI);
      expect(low).toBeGreaterThanOrEqual(0);
      expect(low).toBeLessThan(high);
    }
  });

  it("refuses bad input before asking the database, and reads of bad ids find nothing without a statement", async () => {
    const { db, statements } = recorder();
    const store = createDirectChatStore(db);
    await expect(store.openChat(GROUP, ADA, ADA)).rejects.toThrow();
    await expect(store.openChat("nope", ADA, RAVI)).rejects.toThrow();
    await expect(store.send({ chatId: CHAT, senderId: ADA, clientId: CLIENT, body: "a\u0000b" })).rejects.toThrow();
    await expect(store.send({ chatId: "nope", senderId: ADA, clientId: CLIENT, body: "x" })).rejects.toThrow();
    expect(await store.findChat("nope", CHAT)).toBeNull();
    expect(await store.listChatsFor(GROUP, "nope")).toEqual([]);
    expect(await store.listLatest("nope", 5)).toEqual({ messages: [], hasMore: false });
    expect(await store.findMessageById(CHAT, "nope")).toBeNull();
    expect(await store.softDelete(CHAT, "nope")).toBeNull();
    await store.markRead(CHAT, ADA, "not-a-cursor");
    await store.markRead(CHAT, "nope", CURSOR);
    expect(await store.unreadSummary("nope", ADA)).toEqual({ any: false, fromUserIds: [] });
    expect(statements).toEqual([]);
  });
});

describe("the group chat store's statements", () => {
  it("never touch the private chat tables", async () => {
    const { db, statements } = recorder();
    const store = createMessageStore(db);
    await attempt(() => store.send({ groupId: GROUP, senderId: ADA, clientId: CLIENT, body: BODY }));
    await store.listLatest(GROUP, 10);
    await store.listAfter(GROUP, CURSOR, 10);
    await store.listBefore(GROUP, CURSOR, 10);
    await store.findById(GROUP, MESSAGE);
    await store.softDelete(GROUP, MESSAGE);
    expect(statements.length).toBeGreaterThanOrEqual(6);
    for (const { text } of statements) expect(text).not.toMatch(/direct_/);
  });
});
