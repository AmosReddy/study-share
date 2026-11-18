import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, test } from "vitest";
import { runDirectChatStoreContract, type DirectChatStoreContext } from "@/server/adapters/direct-chat-store.contract";
import { GROUP_CODE_ALPHABET, GROUP_LIMITS } from "@/shared/groups";
import { createDirectChatStore } from "./direct-chat-store";
import { createGroupStore } from "./group-store";
import { createMessageStore } from "./message-store";
import { testDatabaseUrl } from "./test-database-url";

/*
  Runs against a real Postgres (Supabase dev, or the plain-Postgres stand-in in CI); skipped
  locally without TEST_DATABASE_URL, and the helper refuses a production URL.

  Like the message store's suite, these tests commit for real (no rolled-back transaction): each
  test makes its own people with unique .invalid addresses and groups, and a `finally` deletes the
  groups (which deletes their chats, messages and read positions) and then the people, so nothing
  is left behind even when a test fails.
*/
const url = testDatabaseUrl();

type Ctx = DirectChatStoreContext & {
  client: postgres.Sql;
  messages: ReturnType<typeof createMessageStore>;
};

async function withStore(run: (ctx: Ctx) => Promise<void>): Promise<void> {
  const client = postgres(url ?? "postgres://unused", { max: 5, prepare: false, onnotice: () => {} });
  const db = drizzle(client);
  const store = createDirectChatStore(db);
  const messages = createMessageStore(db);
  const groups = createGroupStore(db);
  const userIds: string[] = [];
  const groupIds: string[] = [];

  const newUser = async (name?: string) => {
    const id = randomUUID();
    const meta = name === undefined ? {} : { display_name: name };
    await client`
      insert into auth.users (id, email, raw_user_meta_data)
      values (${id}, ${`direct-${id}@example.invalid`}, ${JSON.stringify(meta)}::jsonb)`;
    userIds.push(id);
    return id;
  };

  const newGroup = async (ownerId: string) => {
    // Random keys, so a rerun or another worker on the same database never collides.
    const bytes = crypto.getRandomValues(new Uint8Array(GROUP_LIMITS.codeLength));
    const inviteCode = Array.from(bytes, (b) => GROUP_CODE_ALPHABET[b % GROUP_CODE_ALPHABET.length]).join("");
    const result = await groups.createGroup({
      ownerId,
      name: "Chat",
      description: "",
      joinMode: "link",
      passwordHash: null,
      inviteToken: `token-${randomUUID()}`,
      inviteCode,
    });
    if (!result.ok) throw new Error(`createGroup failed: ${result.reason}`);
    groupIds.push(result.group.id);
    return result.group.id;
  };

  try {
    await run({
      store,
      messages,
      newUser,
      newGroup,
      deleteGroup: async (groupId) => {
        if (!(await groups.softDeleteGroup(groupId))) throw new Error("softDeleteGroup found no group");
      },
      deleteUser: async (userId) => {
        await client`delete from auth.users where id = ${userId}`;
      },
      join: async (groupId, userId) => {
        await groups.addMember(groupId, userId);
      },
      removeMember: async (groupId, userId) => {
        if (!(await groups.removeMember(groupId, userId))) throw new Error("removeMember refused");
      },
      client,
    });
  } finally {
    // Each clean-up step is tried even when an earlier one fails; the first failure is rethrown.
    const errors: unknown[] = [];
    const attempt = async (step: () => PromiseLike<unknown>) => {
      try {
        await step();
      } catch (error) {
        errors.push(error);
      }
    };
    if (groupIds.length > 0) await attempt(() => client`delete from public.groups where id in ${client(groupIds)}`);
    if (userIds.length > 0) await attempt(() => client`delete from auth.users where id in ${client(userIds)}`);
    await attempt(() => client.end());
    if (errors.length > 0) throw errors[0];
  }
}

/** Runs a query and returns what it was rejected with (postgres.js queries are lazy thenables). */
async function rejection(query: PromiseLike<unknown>): Promise<unknown> {
  try {
    await query;
  } catch (error) {
    return error;
  }
  throw new Error("expected the statement to be refused");
}

describe.skipIf(!url)("SQL direct chat store", { timeout: 120_000 }, () => {
  runDirectChatStoreContract((run) => withStore(run));

  test("the three tables have Row Level Security on and no policies", () =>
    withStore(async ({ client }) => {
      const rows = await client<{ relname: string; relrowsecurity: boolean }[]>`
        select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('direct_chats', 'direct_messages', 'direct_reads')
        order by c.relname`;
      expect(rows.map((r) => [r.relname, r.relrowsecurity])).toEqual([
        ["direct_chats", true],
        ["direct_messages", true],
        ["direct_reads", true],
      ]);
      const policies = await client<{ policyname: string }[]>`
        select policyname from pg_policies where schemaname = 'public' and tablename in ('direct_chats', 'direct_messages', 'direct_reads')`;
      expect(policies).toEqual([]);
    }));

  test("the chat table refuses a pair out of order, the same person twice, and a second chat for a pair", () =>
    withStore(async ({ client, newUser, newGroup }) => {
      const owner = await newUser();
      const other = await newUser();
      const groupId = await newGroup(owner);
      const [low, high] = [owner, other].sort();
      const insert = (a: string, b: string) =>
        client`insert into public.direct_chats (group_id, user_low, user_high) values (${groupId}, ${a}, ${b})`;

      expect(await rejection(insert(high, low))).toMatchObject({ code: "23514", constraint_name: "direct_chats_pair_order_check" });
      expect(await rejection(insert(low, low))).toMatchObject({ code: "23514", constraint_name: "direct_chats_pair_order_check" });
      await insert(low, high);
      expect(await rejection(insert(low, high))).toMatchObject({ code: "23505", constraint_name: "direct_chats_pair_unique" });
    }));

  test("the message table refuses a body outside the rules and a repeated client id, naming the rule", () =>
    withStore(async ({ client, store, newUser, newGroup }) => {
      const ada = await newUser();
      const ravi = await newUser();
      const groupId = await newGroup(ada);
      const { chatId } = await store.openChat(groupId, ada, ravi);
      const insert = (body: string, clientId: string = randomUUID()) =>
        client`insert into public.direct_messages (chat_id, sender_id, client_id, body) values (${chatId}, ${ada}, ${clientId}, ${body})`;

      const bodyRule = { code: "23514", constraint_name: "direct_messages_body_length_check" };
      expect(await rejection(insert(""))).toMatchObject(bodyRule);
      expect(await rejection(insert("   "))).toMatchObject(bodyRule);
      expect(await rejection(insert("x".repeat(2001)))).toMatchObject(bodyRule);
      await insert("x".repeat(2000));
      const clientId = randomUUID();
      await insert("one", clientId);
      expect(await rejection(insert("two", clientId))).toMatchObject({
        code: "23505",
        constraint_name: "direct_messages_chat_client_unique",
      });
      // The default: a new row is not deleted.
      const [row] = await client<{ deleted_at: string | null }[]>`select deleted_at from public.direct_messages where client_id = ${clientId}`;
      expect(row.deleted_at).toBeNull();
    }));

  test("deleting a group removes its chats, messages and read positions; deleting an account removes its chats too", () =>
    withStore(async ({ store, client, newUser, newGroup, deleteUser }) => {
      const owner = await newUser("Owner");
      const leaver = await newUser("Leaver");
      const groupId = await newGroup(owner);
      const { chatId } = await store.openChat(groupId, owner, leaver);
      const { message } = await store.send({ chatId, senderId: leaver, clientId: randomUUID(), body: "bye" });
      await store.markRead(chatId, owner, message.cursor);
      const rowsOf = async (chat: string) => {
        const [chats] = await client<{ n: number }[]>`select count(*)::int as n from public.direct_chats where id = ${chat}`;
        const [msgs] = await client<{ n: number }[]>`select count(*)::int as n from public.direct_messages where chat_id = ${chat}`;
        const [reads] = await client<{ n: number }[]>`select count(*)::int as n from public.direct_reads where chat_id = ${chat}`;
        return { chats: chats.n, messages: msgs.n, reads: reads.n };
      };
      expect(await rowsOf(chatId)).toEqual({ chats: 1, messages: 1, reads: 1 });

      // Both participant links cascade: the account's chats, their messages and positions go.
      await deleteUser(leaver);
      expect(await rowsOf(chatId)).toEqual({ chats: 0, messages: 0, reads: 0 });

      // And the group's.
      const second = await newUser();
      const other = await store.openChat(groupId, owner, second);
      await store.send({ chatId: other.chatId, senderId: owner, clientId: randomUUID(), body: "hi" });
      await client`delete from public.groups where id = ${groupId}`;
      expect(await rowsOf(other.chatId)).toEqual({ chats: 0, messages: 0, reads: 0 });
    }));

  test("group chat and private chats never see each other's messages", () =>
    withStore(async ({ store, messages, newUser, newGroup }) => {
      const ada = await newUser("Ada");
      const ravi = await newUser("Ravi");
      const groupId = await newGroup(ada);
      const { chatId } = await store.openChat(groupId, ada, ravi);
      // The same client id in both: they are different tables with different keys.
      const clientId = randomUUID();
      const group = await messages.send({ groupId, senderId: ada, clientId, body: "to everyone" });
      const direct = await store.send({ chatId, senderId: ada, clientId, body: "just you" });
      expect(group.created && direct.created).toBe(true);

      expect((await messages.listLatest(groupId, 10)).messages.map((m) => m.body)).toEqual(["to everyone"]);
      expect((await store.listLatest(chatId, 10)).messages.map((m) => m.body)).toEqual(["just you"]);
      // A private message's id is not a group message, and the other way round.
      expect(await messages.findById(groupId, direct.message.id)).toBeNull();
      expect(await store.findMessageById(chatId, group.message.id)).toBeNull();
      expect(await messages.softDelete(groupId, direct.message.id)).toBeNull();
      expect(await store.softDelete(chatId, group.message.id)).toBeNull();
      // Group messages never make a chat visible or unread.
      const onlyGroup = await newUser("Mina");
      const quiet = await store.openChat(groupId, ada, onlyGroup);
      await messages.send({ groupId, senderId: onlyGroup, clientId: randomUUID(), body: "group only" });
      expect((await store.listChatsFor(groupId, ada)).map((c) => c.chatId)).toEqual([chatId]);
      expect(await store.listLatest(quiet.chatId, 10)).toEqual({ messages: [], hasMore: false });
      expect(await store.unreadSummary(groupId, ada)).toEqual({ any: false, fromUserIds: [] });
    }));

  test("the chat keeps its place between messages made within one millisecond", () =>
    withStore(async ({ store, client, newUser, newGroup }) => {
      const ada = await newUser();
      const ravi = await newUser();
      const groupId = await newGroup(ada);
      const { chatId } = await store.openChat(groupId, ada, ravi);
      // Three messages whose times differ only in microseconds: a cursor in whole milliseconds
      // would skip or repeat the middle one.
      const stamps = ["2030-01-01 00:00:00.000100+00", "2030-01-01 00:00:00.000900+00", "2030-01-01 00:00:00.000500+00"];
      const bodies = ["low", "high", "middle"];
      for (const [i, stamp] of stamps.entries()) {
        await client`
          insert into public.direct_messages (chat_id, sender_id, client_id, body, created_at)
          values (${chatId}, ${ada}, ${randomUUID()}, ${bodies[i]}, ${stamp}::timestamptz)`;
      }
      const latest = await store.listLatest(chatId, 10);
      expect(latest.messages.map((m) => m.body)).toEqual(["low", "middle", "high"]);

      const walk: string[] = [];
      let before = latest.messages[2].cursor;
      for (let n = 0; n < 5; n++) {
        const page = await store.listBefore(chatId, before, 1);
        if (page.messages.length === 0) break;
        walk.push(page.messages[0].body);
        before = page.messages[0].cursor;
      }
      expect(walk).toEqual(["middle", "low"]);

      const fromLow = await store.listAfter(chatId, latest.messages[0].cursor, 1);
      expect(fromLow.messages.map((m) => m.body)).toEqual(["middle"]);
      expect(fromLow.hasMore).toBe(true);
      const fromMiddle = await store.listAfter(chatId, fromLow.messages[0].cursor, 1);
      expect(fromMiddle.messages.map((m) => m.body)).toEqual(["high"]);
      expect(fromMiddle.hasMore).toBe(false);
    }));

  test("messages made at the same instant are still paged in a total order, both ways", () =>
    withStore(async ({ store, client, newUser, newGroup }) => {
      const ada = await newUser();
      const ravi = await newUser();
      const groupId = await newGroup(ada);
      const { chatId } = await store.openChat(groupId, ada, ravi);
      for (let n = 0; n < 7; n++) {
        await client`
          insert into public.direct_messages (chat_id, sender_id, client_id, body, created_at)
          values (${chatId}, ${ada}, ${randomUUID()}, ${`Same ${n}`}, '2030-01-01 00:00:00+00'::timestamptz)`;
      }
      const whole = await store.listLatest(chatId, 50);
      const order = whole.messages.map((m) => m.id);
      expect(order).toHaveLength(7);
      // Ties are broken by id, ascending, oldest first.
      expect(order).toEqual([...order].sort());

      const back: string[] = [];
      let page = await store.listLatest(chatId, 3);
      back.unshift(...page.messages.map((m) => m.id));
      for (let n = 0; n < 10 && page.hasMore; n++) {
        page = await store.listBefore(chatId, page.messages[0].cursor, 3);
        back.unshift(...page.messages.map((m) => m.id));
      }
      expect(back).toEqual(order);

      const forward: string[] = [whole.messages[0].id];
      let cursor = whole.messages[0].cursor;
      for (let n = 0; n < 10; n++) {
        const next = await store.listAfter(chatId, cursor, 3);
        forward.push(...next.messages.map((m) => m.id));
        if (!next.hasMore) break;
        cursor = next.messages[next.messages.length - 1].cursor;
      }
      expect(forward).toEqual(order);
    }));

  test("the cursor holds the exact microseconds of the stored time", () =>
    withStore(async ({ store, client, newUser, newGroup }) => {
      const ada = await newUser();
      const ravi = await newUser();
      const groupId = await newGroup(ada);
      const { chatId } = await store.openChat(groupId, ada, ravi);
      const [row] = await client<{ id: string }[]>`
        insert into public.direct_messages (chat_id, sender_id, client_id, body, created_at)
        values (${chatId}, ${ada}, ${randomUUID()}, 'precise', '2030-01-01 00:00:00.123457+00'::timestamptz)
        returning id`;
      const [message] = (await store.listLatest(chatId, 1)).messages;
      expect(message.id).toBe(row.id);
      expect(Buffer.from(message.cursor, "base64url").toString("utf8")).toBe(`1893456000123457:${row.id}`);
      expect((await store.listAfter(chatId, message.cursor, 10)).messages).toEqual([]);
      expect((await store.listBefore(chatId, message.cursor, 10)).messages).toEqual([]);
    }));

  test("the read position is exact to the microsecond and only moves forward, also against another connection", () =>
    withStore(async ({ store, client, newUser, newGroup }) => {
      const ada = await newUser();
      const ravi = await newUser();
      const groupId = await newGroup(ada);
      const { chatId } = await store.openChat(groupId, ada, ravi);
      for (const stamp of ["2030-01-01 00:00:00.000100+00", "2030-01-01 00:00:00.000200+00", "2030-01-01 00:00:00.000300+00"]) {
        await client`
          insert into public.direct_messages (chat_id, sender_id, client_id, body, created_at)
          values (${chatId}, ${ada}, ${randomUUID()}, 'x', ${stamp}::timestamptz)`;
      }
      const [first, second, third] = (await store.listLatest(chatId, 10)).messages;
      await store.markRead(chatId, ravi, second.cursor);
      // Only the third (a microsecond newer) is unread.
      expect((await store.listChatsFor(groupId, ravi))[0].unread).toBe(true);
      // Racing marks end at the newest of them, whatever order they arrive in.
      await Promise.all([third.cursor, first.cursor, second.cursor, first.cursor].map((cursor) => store.markRead(chatId, ravi, cursor)));
      expect((await store.listChatsFor(groupId, ravi))[0].unread).toBe(false);
      const [stored] = await client<{ read_message_id: string }[]>`
        select read_message_id from public.direct_reads where chat_id = ${chatId} and user_id = ${ravi}`;
      expect(stored.read_message_id).toBe(third.id);
    }));

  test("a send that repeats an earlier client id returns the stored row, even from a second connection", () =>
    withStore(async ({ store, newUser, newGroup }) => {
      const ada = await newUser("Ada");
      const ravi = await newUser("Ravi");
      const groupId = await newGroup(ada);
      const { chatId } = await store.openChat(groupId, ada, ravi);
      const clientId = randomUUID();
      const sends = await Promise.all(Array.from({ length: 8 }, (_, i) => store.send({ chatId, senderId: ada, clientId, body: `try ${i}` })));
      expect(sends.filter((s) => s.created)).toHaveLength(1);
      expect(new Set(sends.map((s) => s.message.id)).size).toBe(1);
      const created = sends.find((s) => s.created);
      expect(sends.every((s) => s.message.body === created?.message.body)).toBe(true);
    }));

  test("two people opening the same chat from two connections get one chat", () =>
    withStore(async ({ store, client, newUser, newGroup }) => {
      const ada = await newUser();
      const ravi = await newUser();
      const groupId = await newGroup(ada);
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? store.openChat(groupId, ada, ravi) : store.openChat(groupId, ravi, ada))),
      );
      expect(new Set(results.map((r) => r.chatId)).size).toBe(1);
      const [{ n }] = await client<{ n: number }[]>`select count(*)::int as n from public.direct_chats where group_id = ${groupId}`;
      expect(n).toBe(1);
    }));
});
