import "server-only";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { GROUP_LIMITS, type GroupRole, type JoinMode, type MemberStatus } from "@/shared/groups";
import type { GroupRecord, GroupStore } from "@/server/ports/group-store";

/**
 * `execute` for single statements, `transaction` for the steps that lock, count and write.
 * Generic over the schema only so the app's typed database (getDb) fits; no schema is used.
 */
type Executor<S extends Record<string, unknown>> = Pick<PostgresJsDatabase<S>, "execute" | "transaction">;

type GroupRow = {
  id: string;
  name: string;
  description: string;
  join_mode: JoinMode;
  password_hash: string | null;
  invite_token: string;
  invite_code: string;
  created_ms: number;
};

/** The columns a GroupRecord is made from. The driver hands timestamps over as text, so the time
 * comes back as epoch milliseconds instead (the same conversion on every path keeps them equal). */
const GROUP_COLUMNS = sql.raw(
  "id, name, description, join_mode, password_hash, invite_token, invite_code, " +
    "(extract(epoch from created_at) * 1000)::float8 as created_ms",
);

function toRecord(row: GroupRow): GroupRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    joinMode: row.join_mode,
    passwordHash: row.password_hash,
    inviteToken: row.invite_token,
    inviteCode: row.invite_code,
    createdAt: new Date(Number(row.created_ms)),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id that is not a uuid names nothing; checking first keeps Postgres from raising on the cast. */
function isUuid(id: string): boolean {
  return UUID.test(id);
}

/** True when the error (or one it wraps: drizzle wraps the driver's) is a unique violation. */
function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

/*
  Advisory lock keys. Every transaction that takes both takes the group's first and then the
  person's (addMember); createGroup takes only the person's; leave, removeMember,
  transferOwnership and softDeleteGroup take only the group's. So no transaction ever holds a
  person lock while waiting for a group lock, and two transactions cannot wait on each other.
*/
/** The lock-then-count steps rely on READ COMMITTED (each statement sees what committed before
 * it started), so it is stated rather than left to the server's default. */
const LOCKING_TX = { isolationLevel: "read committed" } as const;

const groupLockKey = (groupId: string) => `group-members:${groupId.toLowerCase()}`;
const personLockKey = (userId: string) => `group-person:${userId.toLowerCase()}`;

/** Takes the group's lock (released when the transaction ends). A statement of its own, so the
 * statements after it start after the lock is held and see what the earlier holder committed. */
type Tx = Parameters<Parameters<Executor<Record<string, unknown>>["transaction"]>[0]>[0];
const lockGroup = (tx: Tx, groupId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${groupLockKey(groupId)}, 0))`);

/** The all-zero uuid: no account has it, so it stands in for an id that is not a uuid and
 * matches no membership (the foreign key to auth.users keeps it out of group_members). */
const NO_ONE = "00000000-0000-0000-0000-000000000000";

/**
 * The SQL GroupStore, on public.groups and public.group_members (RLS on, no policies; the app
 * connects as the tables' owner). The limits are kept with transaction-scoped advisory locks:
 * addMember locks the group before counting its members and then the person before counting
 * their groups, and createGroup locks the person before counting their groups, so of two
 * requests at the same instant the second counts after the first has written. Each lock is a
 * statement of its own, before the counting statement, because a statement's snapshot is taken
 * when it starts (READ COMMITTED) and must not predate the lock. The unique index allowing one
 * active owner per group and the primary key are backstops, not the mechanism.
 * Every read skips groups whose deleted_at is set.
 */
export function createGroupStore<S extends Record<string, unknown> = Record<string, never>>(db: Executor<S>): GroupStore {
  return {
    async createGroup(input) {
      if (!isUuid(input.ownerId)) throw new Error("createGroup needs the owner's user id.");
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${personLockKey(input.ownerId)}, 0))`);
        const [{ group_count }] = await tx.execute<{ group_count: number }>(sql`
          select count(*)::int as group_count
          from public.group_members m
          join public.groups g on g.id = m.group_id
          where m.user_id = ${input.ownerId} and m.status = 'active' and g.deleted_at is null`);
        if (group_count >= GROUP_LIMITS.maxGroupsPerPerson) return { ok: false, reason: "too_many_groups" } as const;

        // A taken token or code makes the insert do nothing (no error, so the transaction stays
        // usable), and then no owner row is written either.
        const rows = await tx.execute<GroupRow>(sql`
          with g as (
            insert into public.groups (name, description, join_mode, password_hash, invite_token, invite_code)
            values (${input.name}, ${input.description}, ${input.joinMode}, ${input.passwordHash},
              ${input.inviteToken}, ${input.inviteCode})
            on conflict do nothing
            returning *
          ), owner_row as (
            insert into public.group_members (group_id, user_id, role, status, joined_at)
            select id, ${input.ownerId}::uuid, 'owner', 'active', created_at from g
          )
          select ${GROUP_COLUMNS} from g`);
        if (rows.length === 0) return { ok: false, reason: "invite_taken" } as const;
        return { ok: true, group: toRecord(rows[0]) } as const;
      }, LOCKING_TX);
    },

    async findByInvite(key) {
      const match = "token" in key ? sql`invite_token = ${key.token}` : sql`invite_code = ${key.code}`;
      const rows = await db.execute<GroupRow>(sql`
        select ${GROUP_COLUMNS} from public.groups where ${match} and deleted_at is null`);
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async findById(id) {
      if (!isUuid(id)) return null;
      const rows = await db.execute<GroupRow>(sql`
        select ${GROUP_COLUMNS} from public.groups where id = ${id} and deleted_at is null`);
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async getMembership(groupId, userId) {
      if (!isUuid(groupId) || !isUuid(userId)) return null;
      const rows = await db.execute<{ role: GroupRole; status: MemberStatus }>(sql`
        select m.role, m.status
        from public.group_members m
        join public.groups g on g.id = m.group_id
        where m.group_id = ${groupId} and m.user_id = ${userId} and g.deleted_at is null`);
      return rows[0] ? { role: rows[0].role, status: rows[0].status } : null;
    },

    async listGroupsFor(userId) {
      if (!isUuid(userId)) return [];
      // "C" compares the bytes, as the fake compares strings, so both order names the same way.
      const rows = await db.execute<{ id: string; name: string }>(sql`
        select g.id, g.name
        from public.group_members m
        join public.groups g on g.id = m.group_id
        where m.user_id = ${userId} and m.status = 'active' and g.deleted_at is null
        order by g.name collate "C", g.id`);
      return rows.map((r) => ({ id: r.id, name: r.name }));
    },

    async addMember(groupId, userId) {
      if (!isUuid(groupId)) return "group_gone";
      if (!isUuid(userId)) throw new Error("addMember needs a user id.");
      return db.transaction(async (tx) => {
        // Group first, then person: the one order every transaction here uses (see the keys above).
        await lockGroup(tx, groupId);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${personLockKey(userId)}, 0))`);
        const [state] = await tx.execute<{ group_ok: boolean; status: MemberStatus | null; member_count: number; group_count: number }>(sql`
          select
            exists (select 1 from public.groups where id = ${groupId} and deleted_at is null) as group_ok,
            (select status from public.group_members where group_id = ${groupId} and user_id = ${userId}) as status,
            (select count(*)::int from public.group_members where group_id = ${groupId} and status = 'active') as member_count,
            (select count(*)::int
              from public.group_members m
              join public.groups g on g.id = m.group_id
              where m.user_id = ${userId} and m.status = 'active' and g.deleted_at is null) as group_count`);
        if (!state.group_ok) return "group_gone";
        if (state.status === "removed") return "removed";
        if (state.status === "active") return "already_member";
        if (state.member_count >= GROUP_LIMITS.maxMembers) return "full";
        if (state.group_count >= GROUP_LIMITS.maxGroupsPerPerson) return "too_many_groups";
        // A row can only be left over here as 'pending'; joining replaces it, as in the fake.
        await tx.execute(sql`
          insert into public.group_members (group_id, user_id, role, status)
          values (${groupId}, ${userId}, 'member', 'active')
          on conflict (group_id, user_id) do update
            set role = 'member', status = 'active', joined_at = now()
            where group_members.status <> 'removed'`);
        return "joined";
      }, LOCKING_TX);
    },

    async leave(groupId, userId) {
      if (!isUuid(groupId) || !isUuid(userId)) return "not_member";
      return db.transaction(async (tx) => {
        // The group's lock first, so a leave cannot interleave with a join, a removal or a hand-over.
        await lockGroup(tx, groupId);
        // One statement: both parts see the row as it was, and the delete skips the owner and a
        // removed person (leaving must not clear a removal). A deleted group has nothing to leave.
        const [row] = await tx.execute<{ role: GroupRole | null; status: MemberStatus | null; deleted: boolean }>(sql`
          with live as (
            select 1 from public.groups where id = ${groupId}::uuid and deleted_at is null
          ), m as (
            select role, status from public.group_members
            where group_id = ${groupId}::uuid and user_id = ${userId}::uuid and exists (select 1 from live)
          ), d as (
            delete from public.group_members
            where group_id = ${groupId}::uuid and user_id = ${userId}::uuid and role <> 'owner' and status <> 'removed'
              and exists (select 1 from live)
            returning 1
          )
          select (select role from m) as role, (select status from m) as status, exists (select 1 from d) as deleted`);
        if (row.deleted) return "left";
        if (row.role === "owner" && row.status !== "removed") return "owner";
        return "not_member";
      }, LOCKING_TX);
    },

    async removeMember(groupId, userId) {
      if (!isUuid(groupId) || !isUuid(userId)) return false;
      return db.transaction(async (tx) => {
        await lockGroup(tx, groupId);
        const rows = await tx.execute(sql`
          update public.group_members m set status = 'removed'
          where m.group_id = ${groupId}::uuid and m.user_id = ${userId}::uuid and m.role <> 'owner'
            and exists (select 1 from public.groups g where g.id = m.group_id and g.deleted_at is null)
          returning 1`);
        return rows.length > 0;
      }, LOCKING_TX);
    },

    async transferOwnership(groupId, fromUserId, toUserId) {
      if (!isUuid(groupId)) return "group_gone";
      // An id that is not a uuid names no one, so it matches no membership below.
      const from = isUuid(fromUserId) ? fromUserId : NO_ONE;
      const to = isUuid(toUserId) ? toUserId : NO_ONE;
      return db.transaction(async (tx) => {
        await lockGroup(tx, groupId);
        const [state] = await tx.execute<{ group_ok: boolean; from_owner: boolean; to_active: boolean }>(sql`
          select
            exists (select 1 from public.groups where id = ${groupId}::uuid and deleted_at is null) as group_ok,
            exists (select 1 from public.group_members
              where group_id = ${groupId}::uuid and user_id = ${from}::uuid and role = 'owner' and status = 'active') as from_owner,
            exists (select 1 from public.group_members
              where group_id = ${groupId}::uuid and user_id = ${to}::uuid and status = 'active') as to_active`);
        if (!state.group_ok) return "group_gone";
        if (!state.from_owner) return "not_owner";
        if (fromUserId.toLowerCase() === toUserId.toLowerCase()) return "same_person";
        if (!state.to_active) return "not_member";
        // Demote first: the unique index allows one active owner and is checked per statement.
        // Both run in this transaction under the group's lock, so nothing sees two owners or none.
        await tx.execute(sql`
          update public.group_members set role = 'member'
          where group_id = ${groupId}::uuid and user_id = ${from}::uuid and role = 'owner' and status = 'active'`);
        await tx.execute(sql`
          update public.group_members set role = 'owner'
          where group_id = ${groupId}::uuid and user_id = ${to}::uuid and status = 'active'`);
        return "ok";
      }, LOCKING_TX);
    },

    async softDeleteGroup(groupId) {
      if (!isUuid(groupId)) return false;
      return db.transaction(async (tx) => {
        // Under the group's lock, so a join that already checked the group finishes first.
        await lockGroup(tx, groupId);
        const rows = await tx.execute(sql`
          update public.groups set deleted_at = now()
          where id = ${groupId}::uuid and deleted_at is null
          returning 1`);
        return rows.length > 0;
      }, LOCKING_TX);
    },

    async listMembers(groupId) {
      if (!isUuid(groupId)) return [];
      const rows = await db.execute<{ user_id: string; display_name: string; role: GroupRole; joined_ms: number }>(sql`
        select m.user_id, coalesce(p.display_name, '') as display_name, m.role,
          (extract(epoch from m.joined_at) * 1000)::float8 as joined_ms
        from public.group_members m
        join public.groups g on g.id = m.group_id
        left join public.profiles p on p.id = m.user_id
        where m.group_id = ${groupId} and m.status = 'active' and g.deleted_at is null
        order by (m.role = 'owner') desc, m.joined_at, m.user_id`);
      return rows.map((r) => ({
        userId: r.user_id,
        displayName: r.display_name,
        role: r.role,
        joinedAt: new Date(Number(r.joined_ms)),
      }));
    },

    async updateDetails(groupId, d) {
      if (!isUuid(groupId)) return false;
      const rows = await db.execute(sql`
        update public.groups set name = ${d.name}, description = ${d.description}
        where id = ${groupId} and deleted_at is null
        returning 1`);
      return rows.length > 0;
    },

    async updateJoin(groupId, j) {
      if (!isUuid(groupId)) return false;
      const rows = await db.execute(sql`
        update public.groups set join_mode = ${j.joinMode}, password_hash = ${j.passwordHash}
        where id = ${groupId} and deleted_at is null
        returning 1`);
      return rows.length > 0;
    },

    async replaceInvite(groupId, i) {
      if (!isUuid(groupId)) return "group_gone";
      try {
        const rows = await db.execute(sql`
          update public.groups set invite_token = ${i.inviteToken}, invite_code = ${i.inviteCode}
          where id = ${groupId} and deleted_at is null
          returning 1`);
        return rows.length > 0 ? "ok" : "group_gone";
      } catch (error) {
        // The unique constraints decide: another group (deleted ones too) holds the token or code.
        if (isUniqueViolation(error)) return "invite_taken";
        throw error;
      }
    },
  };
}
