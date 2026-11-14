import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, test } from "vitest";
import { runMessageStoreContract, type MessageStoreContext } from "@/server/adapters/message-store.contract";
import { GROUP_CODE_ALPHABET, GROUP_LIMITS } from "@/shared/groups";
import { createGroupStore } from "./group-store";
import { createMessageStore } from "./message-store";
import { testDatabaseUrl } from "./test-database-url";

/*
  Runs against a real Postgres (Supabase dev, or the plain-Postgres stand-in in CI); skipped
  locally without TEST_DATABASE_URL, and the helper refuses a production URL.

  Like the resource store's suite, these tests commit for real (no rolled-back transaction): each
  test makes its own people with unique .invalid addresses and groups, and a `finally` deletes the
  groups (which deletes their messages) and then the people, so nothing is left behind even when a
  test fails.
*/
const url = testDatabaseUrl();

type Ctx = MessageStoreContext & { client: postgres.Sql };

async function withStore(run: (ctx: Ctx) => Promise<void>): Promise<void> {
  const client = postgres(url ?? "postgres://unused", { max: 5, prepare: false, onnotice: () => {} });
  const db = drizzle(client);
  const store = createMessageStore(db);
  const groups = createGroupStore(db);
  const userIds: string[] = [];
  const groupIds: string[] = [];

  const newUser = async (name?: string) => {
    const id = randomUUID();
    const meta = name === undefined ? {} : { display_name: name };
    await client`
      insert into auth.users (id, email, raw_user_meta_data)
      values (${id}, ${`message-${id}@example.invalid`}, ${JSON.stringify(meta)}::jsonb)`;
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
      newUser,
      newGroup,
      deleteGroup: async (groupId) => {
        if (!(await groups.softDeleteGroup(groupId))) throw new Error("softDeleteGroup found no group");
      },
      deleteUser: async (userId) => {
        await client`delete from auth.users where id = ${userId}`;
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

describe.skipIf(!url)("SQL message store", { timeout: 120_000 }, () => {
  runMessageStoreContract((run) => withStore(run));

  test("the table has Row Level Security on and no policies", () =>
    withStore(async ({ client }) => {
      const rows = await client<{ relname: string; relrowsecurity: boolean }[]>`
        select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'messages'`;
      expect(rows.map((r) => [r.relname, r.relrowsecurity])).toEqual([["messages", true]]);
      const policies = await client<{ policyname: string }[]>`
        select policyname from pg_policies where schemaname = 'public' and tablename = 'messages'`;
      expect(policies).toEqual([]);
    }));

  test("the table refuses a body outside the rules and a repeated client id, naming the rule", () =>
    withStore(async ({ client, newUser, newGroup }) => {
      const owner = await newUser();
      const groupId = await newGroup(owner);
      const insert = (body: string, clientId: string = randomUUID()) =>
        client`insert into public.messages (group_id, sender_id, client_id, body) values (${groupId}, ${owner}, ${clientId}, ${body})`;

      expect(await rejection(insert(""))).toMatchObject({ code: "23514", constraint_name: "messages_body_length_check" });
      expect(await rejection(insert("   "))).toMatchObject({ code: "23514", constraint_name: "messages_body_length_check" });
      expect(await rejection(insert("x".repeat(2001)))).toMatchObject({
        code: "23514",
        constraint_name: "messages_body_length_check",
      });
      await insert("x".repeat(2000));
      const clientId = randomUUID();
      await insert("one", clientId);
      expect(await rejection(insert("two", clientId))).toMatchObject({
        code: "23505",
        constraint_name: "messages_group_client_unique",
      });
      // The default: a new row is not deleted.
      const [row] = await client<{ deleted_at: string | null }[]>`select deleted_at from public.messages where client_id = ${clientId}`;
      expect(row.deleted_at).toBeNull();
    }));

  test("deleting a group removes its messages, and deleting an account only clears the sender", () =>
    withStore(async ({ store, client, newUser, newGroup, deleteUser }) => {
      const owner = await newUser("Owner");
      const leaver = await newUser("Leaver");
      const groupId = await newGroup(owner);
      const { message } = await store.send({ groupId, senderId: leaver, clientId: randomUUID(), body: "bye" });
      await deleteUser(leaver);
      const [kept] = await client<{ sender_id: string | null }[]>`select sender_id from public.messages where id = ${message.id}`;
      expect(kept.sender_id).toBeNull();

      await client`delete from public.groups where id = ${groupId}`;
      const [{ count }] = await client<{ count: number }[]>`select count(*)::int as count from public.messages where id = ${message.id}`;
      expect(count).toBe(0);
    }));

  test("the chat keeps its place between messages made within one millisecond", () =>
    withStore(async ({ store, client, newUser, newGroup }) => {
      const owner = await newUser();
      const groupId = await newGroup(owner);
      // Three messages whose times differ only in microseconds: a cursor in whole milliseconds
      // would skip or repeat the middle one.
      const stamps = ["2030-01-01 00:00:00.000100+00", "2030-01-01 00:00:00.000900+00", "2030-01-01 00:00:00.000500+00"];
      const bodies = ["low", "high", "middle"];
      for (const [i, stamp] of stamps.entries()) {
        await client`
          insert into public.messages (group_id, sender_id, client_id, body, created_at)
          values (${groupId}, ${owner}, ${randomUUID()}, ${bodies[i]}, ${stamp}::timestamptz)`;
      }
      const latest = await store.listLatest(groupId, 10);
      expect(latest.messages.map((m) => m.body)).toEqual(["low", "middle", "high"]);

      // Backward, one at a time, from the newest.
      const walk: string[] = [];
      let before = latest.messages[2].cursor;
      for (let n = 0; n < 5; n++) {
        const page = await store.listBefore(groupId, before, 1);
        if (page.messages.length === 0) break;
        walk.push(page.messages[0].body);
        before = page.messages[0].cursor;
      }
      expect(walk).toEqual(["middle", "low"]);

      const fromLow = await store.listAfter(groupId, latest.messages[0].cursor, 1);
      expect(fromLow.messages.map((m) => m.body)).toEqual(["middle"]);
      expect(fromLow.hasMore).toBe(true);
      const fromMiddle = await store.listAfter(groupId, fromLow.messages[0].cursor, 1);
      expect(fromMiddle.messages.map((m) => m.body)).toEqual(["high"]);
      expect(fromMiddle.hasMore).toBe(false);
    }));

  test("messages made at the same instant are still paged in a total order, both ways", () =>
    withStore(async ({ store, client, newUser, newGroup }) => {
      const owner = await newUser();
      const groupId = await newGroup(owner);
      for (let n = 0; n < 7; n++) {
        await client`
          insert into public.messages (group_id, sender_id, client_id, body, created_at)
          values (${groupId}, ${owner}, ${randomUUID()}, ${`Same ${n}`}, '2030-01-01 00:00:00+00'::timestamptz)`;
      }
      const whole = await store.listLatest(groupId, 50);
      const order = whole.messages.map((m) => m.id);
      expect(order).toHaveLength(7);
      // Ties are broken by id, ascending, oldest first.
      expect(order).toEqual([...order].sort());

      // Backward, 3 at a time.
      const back: string[] = [];
      let page = await store.listLatest(groupId, 3);
      back.unshift(...page.messages.map((m) => m.id));
      for (let n = 0; n < 10 && page.hasMore; n++) {
        page = await store.listBefore(groupId, page.messages[0].cursor, 3);
        back.unshift(...page.messages.map((m) => m.id));
      }
      expect(back).toEqual(order);

      // Forward, 3 at a time, from the oldest message.
      const forward: string[] = [whole.messages[0].id];
      let cursor = whole.messages[0].cursor;
      for (let n = 0; n < 10; n++) {
        const next = await store.listAfter(groupId, cursor, 3);
        forward.push(...next.messages.map((m) => m.id));
        if (!next.hasMore) break;
        cursor = next.messages[next.messages.length - 1].cursor;
      }
      expect(forward).toEqual(order);
    }));

  test("the cursor holds the exact microseconds of the stored time", () =>
    withStore(async ({ store, client, newUser, newGroup }) => {
      const owner = await newUser();
      const groupId = await newGroup(owner);
      const [row] = await client<{ id: string }[]>`
        insert into public.messages (group_id, sender_id, client_id, body, created_at)
        values (${groupId}, ${owner}, ${randomUUID()}, 'precise', '2030-01-01 00:00:00.123457+00'::timestamptz)
        returning id`;
      const [message] = (await store.listLatest(groupId, 1)).messages;
      expect(message.id).toBe(row.id);
      const decoded = Buffer.from(message.cursor, "base64url").toString("utf8");
      expect(decoded).toBe(`1893456000123457:${row.id}`);
      // Nothing is "after" or "before" itself.
      expect((await store.listAfter(groupId, message.cursor, 10)).messages).toEqual([]);
      expect((await store.listBefore(groupId, message.cursor, 10)).messages).toEqual([]);
    }));

  test("a send that repeats an earlier client id returns the stored row, even from a second connection", () =>
    withStore(async ({ store, newUser, newGroup }) => {
      const owner = await newUser("Owner");
      const groupId = await newGroup(owner);
      const clientId = randomUUID();
      const sends = await Promise.all(
        Array.from({ length: 8 }, (_, i) => store.send({ groupId, senderId: owner, clientId, body: `try ${i}` })),
      );
      expect(sends.filter((s) => s.created)).toHaveLength(1);
      expect(new Set(sends.map((s) => s.message.id)).size).toBe(1);
      const created = sends.find((s) => s.created);
      expect(sends.every((s) => s.message.body === created?.message.body)).toBe(true);
    }));
});
