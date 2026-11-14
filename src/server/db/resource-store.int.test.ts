import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, test } from "vitest";
import { runResourceStoreContract, type ResourceStoreContext } from "@/server/adapters/resource-store.contract";
import { GROUP_CODE_ALPHABET, GROUP_LIMITS } from "@/shared/groups";
import { createGroupStore } from "./group-store";
import { createResourceStore } from "./resource-store";
import { testDatabaseUrl } from "./test-database-url";

/*
  Runs against a real Postgres (Supabase dev, or the plain-Postgres stand-in in CI); skipped
  locally without TEST_DATABASE_URL, and the helper refuses a production URL.

  Like the group store's suite, these tests commit for real (no rolled-back transaction): each
  test makes its own people with unique .invalid addresses and groups, and a `finally` deletes the
  groups (which deletes their files) and then the people, so nothing is left behind even when a
  test fails.
*/
const url = testDatabaseUrl();

type Ctx = ResourceStoreContext & { client: postgres.Sql };

async function withStore(run: (ctx: Ctx) => Promise<void>): Promise<void> {
  const client = postgres(url ?? "postgres://unused", { max: 5, prepare: false, onnotice: () => {} });
  const db = drizzle(client);
  const store = createResourceStore(db);
  const groups = createGroupStore(db);
  const userIds: string[] = [];
  const groupIds: string[] = [];

  const newUser = async (name?: string) => {
    const id = randomUUID();
    const meta = name === undefined ? {} : { display_name: name };
    await client`
      insert into auth.users (id, email, raw_user_meta_data)
      values (${id}, ${`resource-${id}@example.invalid`}, ${JSON.stringify(meta)}::jsonb)`;
    userIds.push(id);
    return id;
  };

  const newGroup = async (ownerId: string) => {
    // Random keys, so a rerun or another worker on the same database never collides.
    const bytes = crypto.getRandomValues(new Uint8Array(GROUP_LIMITS.codeLength));
    const inviteCode = Array.from(bytes, (b) => GROUP_CODE_ALPHABET[b % GROUP_CODE_ALPHABET.length]).join("");
    const result = await groups.createGroup({
      ownerId,
      name: "Files",
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

describe.skipIf(!url)("SQL resource store", { timeout: 120_000 }, () => {
  runResourceStoreContract((run) => withStore(run));

  test("the table has Row Level Security on", () =>
    withStore(async ({ client }) => {
      const rows = await client<{ relname: string; relrowsecurity: boolean }[]>`
        select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'resources'`;
      expect(rows.map((r) => [r.relname, r.relrowsecurity])).toEqual([["resources", true]]);
    }));

  test("the table refuses values outside the rules, naming the rule", () =>
    withStore(async ({ client, newUser, newGroup }) => {
      const owner = await newUser();
      const groupId = await newGroup(owner);
      const insert = (over: { type?: string; status?: string; size?: number; title?: string; subject?: string; fileName?: string }) =>
        client`
          insert into public.resources (group_id, uploader_id, title, subject, type, file_key, file_name, content_type, size_bytes, status)
          values (${groupId}, ${owner}, ${over.title ?? "T"}, ${over.subject ?? ""}, ${over.type ?? "notes"},
            ${`key-${randomUUID()}`}, ${over.fileName ?? "a.pdf"}, 'application/pdf', ${over.size ?? 1}, ${over.status ?? "ready"})`;

      expect(await rejection(insert({ type: "video" }))).toMatchObject({ code: "23514", constraint_name: "resources_type_check" });
      expect(await rejection(insert({ status: "gone" }))).toMatchObject({ code: "23514", constraint_name: "resources_status_check" });
      expect(await rejection(insert({ size: 0 }))).toMatchObject({ code: "23514", constraint_name: "resources_size_check" });
      expect(await rejection(insert({ title: "   " }))).toMatchObject({ code: "23514", constraint_name: "resources_title_length_check" });
      expect(await rejection(insert({ title: "x".repeat(121) }))).toMatchObject({
        code: "23514",
        constraint_name: "resources_title_length_check",
      });
      expect(await rejection(insert({ subject: "x".repeat(61) }))).toMatchObject({
        code: "23514",
        constraint_name: "resources_subject_length_check",
      });
      expect(await rejection(insert({ fileName: "" }))).toMatchObject({
        code: "23514",
        constraint_name: "resources_file_name_length_check",
      });
      expect(await rejection(insert({ fileName: "x".repeat(201) }))).toMatchObject({
        code: "23514",
        constraint_name: "resources_file_name_length_check",
      });
      // The defaults: no subject given means empty, and a new row is 'uploading'.
      const [row] = await client<{ subject: string; status: string }[]>`
        insert into public.resources (group_id, title, type, file_key, file_name, content_type, size_bytes)
        values (${groupId}, 'T', 'other', ${`key-${randomUUID()}`}, 'a.pdf', 'application/pdf', 1)
        returning subject, status`;
      expect(row).toEqual({ subject: "", status: "uploading" });
    }));

  test("deleting a group removes its files, and deleting an account only clears the uploader", () =>
    withStore(async ({ store, client, newUser, newGroup, deleteUser }) => {
      const owner = await newUser("Owner");
      const leaver = await newUser("Leaver");
      const groupId = await newGroup(owner);
      const fileId = randomUUID();
      await store.createPending({
        id: fileId,
        groupId,
        uploaderId: leaver,
        title: "T",
        subject: "",
        type: "notes",
        fileKey: `key-${fileId}`,
        fileName: "a.pdf",
        contentType: "application/pdf",
        sizeBytes: 1,
      });
      await deleteUser(leaver);
      const [kept] = await client<{ uploader_id: string | null }[]>`select uploader_id from public.resources where id = ${fileId}`;
      expect(kept.uploader_id).toBeNull();

      await client`delete from public.groups where id = ${groupId}`;
      const [{ count }] = await client<{ count: number }[]>`select count(*)::int as count from public.resources where id = ${fileId}`;
      expect(count).toBe(0);
    }));

  test("the list keeps its place between files made within one millisecond", () =>
    withStore(async ({ store, client, newUser, newGroup }) => {
      const owner = await newUser();
      const groupId = await newGroup(owner);
      // Three files whose times differ only in microseconds: a cursor in whole milliseconds
      // would skip the middle one.
      const stamps = ["2030-01-01 00:00:00.000100+00", "2030-01-01 00:00:00.000900+00", "2030-01-01 00:00:00.000500+00"];
      const titles = ["low", "high", "middle"];
      for (const [i, stamp] of stamps.entries()) {
        await client`
          insert into public.resources (group_id, uploader_id, title, type, file_key, file_name, content_type, size_bytes, status, created_at)
          values (${groupId}, ${owner}, ${titles[i]}, 'notes', ${`key-${randomUUID()}`}, 'a.pdf', 'application/pdf', 1, 'ready', ${stamp}::timestamptz)`;
      }
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let n = 0; n < 5; n++) {
        const page = await store.list(groupId, { limit: 1, cursor });
        seen.push(...page.items.map((r) => r.title));
        if (page.nextCursor === null) break;
        cursor = page.nextCursor;
      }
      expect(seen).toEqual(["high", "middle", "low"]);
    }));

  test("files made at the same instant are still paged in a total order", () =>
    withStore(async ({ store, client, newUser, newGroup }) => {
      const owner = await newUser();
      const groupId = await newGroup(owner);
      for (let n = 0; n < 7; n++) {
        await client`
          insert into public.resources (group_id, uploader_id, title, type, file_key, file_name, content_type, size_bytes, status, created_at)
          values (${groupId}, ${owner}, ${`Same ${n}`}, 'notes', ${`key-${randomUUID()}`}, 'a.pdf', 'application/pdf', 1, 'ready',
            '2030-01-01 00:00:00+00'::timestamptz)`;
      }
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let n = 0; n < 10; n++) {
        const page = await store.list(groupId, { limit: 3, cursor });
        seen.push(...page.items.map((r) => r.id));
        if (page.nextCursor === null) break;
        cursor = page.nextCursor;
      }
      expect(seen).toHaveLength(7);
      expect(new Set(seen).size).toBe(7);
      expect(seen).toEqual([...seen].sort().reverse());
    }));
});
