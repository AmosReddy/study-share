import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, test } from "vitest";
import { runGroupStoreContract, type GroupStoreContext } from "@/server/adapters/group-store.contract";
import { GROUP_CODE_ALPHABET, GROUP_LIMITS } from "@/shared/groups";
import type { GroupStore } from "@/server/ports/group-store";
import { createGroupStore } from "./group-store";
import { testDatabaseUrl } from "./test-database-url";

/*
  Runs against a real Postgres (Supabase dev, or the plain-Postgres stand-in in CI); skipped
  locally without TEST_DATABASE_URL, and the helper refuses a production URL.

  Unlike the other database suites, these tests are NOT run inside a rolled-back transaction:
  the concurrency tests need several connections at once (a single connection would run the
  "simultaneous" calls one after the other and prove nothing). So each test gets a small pool,
  makes its own people with unique .invalid addresses, and a `finally` deletes the groups those
  people own and then the people (which removes their memberships and profiles), so nothing is
  left behind even when a test fails. Invite keys are random, so reruns never collide.
*/
const url = testDatabaseUrl();

type Ctx = GroupStoreContext & { client: postgres.Sql };

async function withStore(run: (ctx: Ctx) => Promise<void>): Promise<void> {
  const client = postgres(url ?? "postgres://unused", { max: 5, prepare: false, onnotice: () => {} });
  const store = createGroupStore(drizzle(client));
  const userIds: string[] = [];

  const newUser = async (name?: string) => {
    const id = randomUUID();
    const meta = name === undefined ? {} : { display_name: name };
    await client`
      insert into auth.users (id, email, raw_user_meta_data)
      values (${id}, ${`group-${id}@example.invalid`}, ${JSON.stringify(meta)}::jsonb)`;
    userIds.push(id);
    return id;
  };

  const newUsers = async (count: number) => {
    const rows = await client<{ id: string }[]>`
      insert into auth.users (id, email)
      select id, 'group-' || id || '@example.invalid'
      from (select gen_random_uuid() as id from generate_series(1, ${count}::int)) s
      returning id`;
    const ids = rows.map((r) => r.id);
    userIds.push(...ids);
    return ids;
  };

  try {
    await run({ store, newUser, newUsers, client });
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
    if (userIds.length > 0) {
      await attempt(
        () => client`
          delete from public.groups where id in (
            select group_id from public.group_members where role = 'owner' and user_id in ${client(userIds)})`,
      );
      await attempt(() => client`delete from auth.users where id in ${client(userIds)}`);
    }
    await attempt(() => client.end());
    if (errors.length > 0) throw errors[0];
  }
}

function randomKeys() {
  const bytes = crypto.getRandomValues(new Uint8Array(GROUP_LIMITS.codeLength));
  const inviteCode = Array.from(bytes, (b) => GROUP_CODE_ALPHABET[b % GROUP_CODE_ALPHABET.length]).join("");
  return { inviteToken: `token-${randomUUID()}`, inviteCode };
}

function input(ownerId: string, name = "Chemistry"): Parameters<GroupStore["createGroup"]>[0] {
  return { ownerId, name, description: "", joinMode: "link", passwordHash: null, ...randomKeys() };
}

async function makeGroup(store: GroupStore, ownerId: string, name?: string) {
  const result = await store.createGroup(input(ownerId, name));
  if (!result.ok) throw new Error(`createGroup failed: ${result.reason}`);
  return result.group;
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

describe.skipIf(!url)("SQL group store", { timeout: 120_000 }, () => {
  runGroupStoreContract((run) => withStore(run));

  test("deleted groups are invisible to every read and are not counted towards the limit", () =>
    withStore(async ({ store, client, newUser }) => {
      const owner = await newUser();
      const person = await newUser();
      const group = await makeGroup(store, owner);
      expect(await store.addMember(group.id, person)).toBe("joined");

      await client`update public.groups set deleted_at = now() where id = ${group.id}`;

      expect(await store.findByInvite({ token: group.inviteToken })).toBeNull();
      expect(await store.findByInvite({ code: group.inviteCode })).toBeNull();
      expect(await store.findById(group.id)).toBeNull();
      expect(await store.getMembership(group.id, person)).toBeNull();
      expect(await store.listMembers(group.id)).toEqual([]);
      expect(await store.listGroupsFor(owner)).toEqual([]);
      expect(await store.listGroupsFor(person)).toEqual([]);
      expect(await store.addMember(group.id, await newUser())).toBe("group_gone");

      // The owner's active membership of the deleted group does not count: 20 more are allowed.
      for (let n = 0; n < GROUP_LIMITS.maxGroupsPerPerson; n++) await makeGroup(store, owner);
      expect(await store.createGroup(input(owner))).toEqual({ ok: false, reason: "too_many_groups" });
      expect(await store.listGroupsFor(owner)).toHaveLength(GROUP_LIMITS.maxGroupsPerPerson);

      // Nor does the person's: with it they would be in 21, yet all 20 joins go through.
      for (const g of await store.listGroupsFor(owner)) expect(await store.addMember(g.id, person)).toBe("joined");
      expect(await store.listGroupsFor(person)).toHaveLength(GROUP_LIMITS.maxGroupsPerPerson);
      expect(await store.addMember((await makeGroup(store, await newUser())).id, person)).toBe("too_many_groups");
    }));

  test("parallel creates by one person never pass the group limit", () =>
    withStore(async ({ store, newUser }) => {
      const owner = await newUser();
      for (let n = 0; n < GROUP_LIMITS.maxGroupsPerPerson - 2; n++) await makeGroup(store, owner);
      const results = await Promise.all([1, 2, 3, 4].map(() => store.createGroup(input(owner))));
      expect(results.filter((r) => r.ok)).toHaveLength(2);
      expect(results.filter((r) => !r.ok && r.reason === "too_many_groups")).toHaveLength(2);
      expect(await store.listGroupsFor(owner)).toHaveLength(GROUP_LIMITS.maxGroupsPerPerson);
    }));

  test("parallel joins of different groups by one person never pass the group limit", () =>
    withStore(async ({ store, newUser }) => {
      const owner = await newUser();
      const other = await newUser();
      const person = await newUser();
      for (let n = 0; n < GROUP_LIMITS.maxGroupsPerPerson - 1; n++) {
        expect(await store.addMember((await makeGroup(store, owner)).id, person)).toBe("joined");
      }
      // One place left, and four different groups (each with its own group lock) at once.
      const targets = [];
      for (let n = 0; n < 4; n++) targets.push(await makeGroup(store, other));
      const results = await Promise.all(targets.map((g) => store.addMember(g.id, person)));
      expect([...results].sort()).toEqual(["joined", "too_many_groups", "too_many_groups", "too_many_groups"]);
      expect(await store.listGroupsFor(person)).toHaveLength(GROUP_LIMITS.maxGroupsPerPerson);
    }));

  test("crossing joins (A joins X while B joins Y, both locks taken in one order) do not deadlock", () =>
    withStore(async ({ store, newUser }) => {
      const [a, b] = [await newUser(), await newUser()];
      const x = await makeGroup(store, b);
      const y = await makeGroup(store, a);
      const results = await Promise.all([
        store.addMember(x.id, a),
        store.addMember(y.id, b),
        store.addMember(y.id, a),
        store.addMember(x.id, b),
      ]);
      expect(results).toEqual(["joined", "joined", "already_member", "already_member"]);
    }));

  test("the tables refuse values outside the rules: status, role, join mode, and a second active owner", () =>
    withStore(async ({ store, client, newUser }) => {
      const owner = await newUser();
      const group = await makeGroup(store, owner);
      const person = await newUser();

      expect(
        await rejection(client`
          insert into public.group_members (group_id, user_id, role, status)
          values (${group.id}, ${person}, 'member', 'banned')`),
      ).toMatchObject({ code: "23514", constraint_name: "group_members_status_check" });
      expect(
        await rejection(client`
          insert into public.group_members (group_id, user_id, role, status)
          values (${group.id}, ${person}, 'king', 'active')`),
      ).toMatchObject({ code: "23514", constraint_name: "group_members_role_check" });
      expect(
        await rejection(client`
          insert into public.group_members (group_id, user_id, role, status)
          values (${group.id}, ${person}, 'owner', 'active')`),
      ).toMatchObject({ code: "23505", constraint_name: "group_members_one_active_owner" });
      expect(
        await rejection(client`update public.groups set join_mode = 'password', password_hash = null where id = ${group.id}`),
      ).toMatchObject({ code: "23514", constraint_name: "groups_password_check" });
      expect(
        await rejection(client`update public.groups set join_mode = 'open', password_hash = 'x' where id = ${group.id}`),
      ).toMatchObject({ code: "23514", constraint_name: "groups_join_mode_check" });

      // Nothing above was written.
      expect(await store.getMembership(group.id, person)).toBeNull();
      expect(await store.findById(group.id)).toEqual(group);
    }));

  test("ids that are not uuids name nothing instead of failing", () =>
    withStore(async ({ store, newUser }) => {
      const person = await newUser();
      expect(await store.findById("not-a-uuid")).toBeNull();
      expect(await store.getMembership("not-a-uuid", person)).toBeNull();
      expect(await store.addMember("not-a-uuid", person)).toBe("group_gone");
      expect(await store.leave("not-a-uuid", person)).toBe("not_member");
      expect(await store.removeMember("not-a-uuid", person)).toBe(false);
      expect(await store.listMembers("not-a-uuid")).toEqual([]);
      expect(await store.listGroupsFor("not-a-uuid")).toEqual([]);
      expect(await store.replaceInvite("not-a-uuid", randomKeys())).toBe("group_gone");
    }));

  test("both tables have Row Level Security on", () =>
    withStore(async ({ client }) => {
      const rows = await client<{ relname: string; relrowsecurity: boolean }[]>`
        select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('groups', 'group_members') order by c.relname`;
      expect(rows.map((r) => [r.relname, r.relrowsecurity])).toEqual([
        ["group_members", true],
        ["groups", true],
      ]);
    }));

  test("a lock held by a stuck transaction makes a join fail within seconds instead of hanging", () =>
    withStore(async ({ store, client, newUser }) => {
      const owner = await newUser("Owner");
      const friend = await newUser("Friend");
      const groupId = (await makeGroup(store, owner, "Stuck lock")).id;
      // Another connection takes the group's lock and never lets go (a frozen instance mid-transaction).
      const holder = await client.reserve();
      try {
        await holder`begin`;
        await holder`select pg_advisory_xact_lock(hashtextextended(${`group-members:${groupId}`}, 0))`;
        const started = Date.now();
        await expect(store.addMember(groupId, friend)).rejects.toThrow();
        const waited = Date.now() - started;
        expect(waited).toBeLessThan(8000);
        expect(waited).toBeGreaterThanOrEqual(2500);
      } finally {
        await holder`rollback`.catch(() => {});
        holder.release();
      }
      // With the stuck transaction gone, joining works again.
      expect(await store.addMember(groupId, friend)).toBe("joined");
    }));
});
