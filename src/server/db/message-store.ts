import "server-only";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { MessagePage, MessageRecord, MessageStore } from "@/server/ports/message-store";
import { clampResourceLimit, decodeResourceCursor, encodeResourceCursor } from "@/server/resource-cursor";

/**
 * Single statements only, so each method is atomic with no explicit lock. Generic over the schema
 * only so the app's typed database (getDb) fits; no schema is used.
 */
type Executor<S extends Record<string, unknown>> = Pick<PostgresJsDatabase<S>, "execute">;

type MessageRow = {
  id: string;
  group_id: string;
  sender_id: string | null;
  sender_name: string;
  body: string;
  client_id: string;
  created_ms: number;
  created_us: string | number;
  deleted: boolean;
};

/**
 * The columns a MessageRecord is made from, for a source named `r` joined to `p` (see
 * WITH_SENDER). Times come back as numbers because the driver hands timestamps over as text:
 * milliseconds for the record, microseconds for the cursor.
 */
const MESSAGE_COLUMNS = sql.raw(
  "r.id, r.group_id, r.sender_id, coalesce(p.display_name, '') as sender_name, r.body, r.client_id, " +
    "(extract(epoch from r.created_at) * 1000)::float8 as created_ms, " +
    "round(extract(epoch from r.created_at) * 1000000)::bigint as created_us, " +
    "(r.deleted_at is not null) as deleted",
);

/** The sender's name, when the account still has a profile. */
const WITH_SENDER = sql.raw("left join public.profiles p on p.id = r.sender_id");

/** The message's group exists and is not deleted; `r` is the message. */
const GROUP_IS_LIVE = sql.raw("exists (select 1 from public.groups g where g.id = r.group_id and g.deleted_at is null)");

function toRecord(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    groupId: row.group_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    body: row.body,
    clientId: row.client_id,
    createdAt: new Date(Number(row.created_ms)),
    deleted: row.deleted,
    cursor: encodeResourceCursor({ micros: Number(row.created_us), id: row.id }),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id that is not a uuid names nothing; checking first keeps Postgres from raising on the cast. */
function isUuid(id: string): boolean {
  return UUID.test(id);
}

/** The position a cursor names, as a SQL pair to compare with (r.created_at, r.id). Exact microseconds from the epoch. */
const position = (cursor: { micros: number; id: string }) =>
  sql`(timestamptz 'epoch' + ${String(cursor.micros)}::bigint * interval '1 microsecond', ${cursor.id}::uuid)`;

/**
 * The SQL MessageStore, on public.messages (RLS on, no policies; the app connects as the table's
 * owner). Every read joins groups and skips messages of deleted groups, and messages whose
 * deleted_at is set. The sender's name comes from public.profiles (empty once the account is gone,
 * when sender_id has been cleared).
 */
export function createMessageStore<S extends Record<string, unknown> = Record<string, never>>(db: Executor<S>): MessageStore {
  /** The newest-first query with an optional position filter; one more than `limit` tells whether there is more. */
  async function newestFirst(groupId: string, limit: number, before?: { micros: number; id: string }) {
    const filters = [sql`r.group_id = ${groupId}::uuid`, sql`r.deleted_at is null`, GROUP_IS_LIVE];
    if (before) filters.push(sql`(r.created_at, r.id) < ${position(before)}`);
    const rows = await db.execute<MessageRow>(sql`
      select ${MESSAGE_COLUMNS}
      from public.messages r ${WITH_SENDER}
      where ${sql.join(filters, sql` and `)}
      order by r.created_at desc, r.id desc
      limit ${limit + 1}`);
    return {
      messages: rows.slice(0, limit).map(toRecord).reverse(),
      hasMore: rows.length > limit,
    } satisfies MessagePage;
  }

  async function latest(groupId: string, limit: number): Promise<MessagePage> {
    if (!isUuid(groupId)) return { messages: [], hasMore: false };
    return newestFirst(groupId, clampResourceLimit(limit));
  }

  /** The row for (group, client id) as it is now, for a send that lost a race or repeats. */
  async function existing(groupId: string, clientId: string): Promise<MessageRecord | null> {
    const rows = await db.execute<MessageRow>(sql`
      select ${MESSAGE_COLUMNS}
      from public.messages r ${WITH_SENDER}
      where r.group_id = ${groupId}::uuid and r.client_id = ${clientId}::uuid and ${GROUP_IS_LIVE}`);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  return {
    async send(input) {
      if (!isUuid(input.groupId) || !isUuid(input.senderId) || !isUuid(input.clientId)) {
        throw new Error("send needs uuids for the group, the sender and the client id.");
      }
      // Postgres cannot store a NUL character in text, and the driver would throw an obscure error.
      if (input.body.includes("\u0000")) throw new Error("send: text cannot hold a NUL character.");

      // The insert selects from the live group, so a deleted or unknown group inserts nothing. On a
      // repeat, `ins` is empty and the second branch finds the row that was saved before (this
      // statement's snapshot is from before the insert, so it never sees a row `ins` just made).
      const rows = await db.execute<MessageRow & { created: boolean }>(sql`
        with ins as (
          insert into public.messages (group_id, sender_id, client_id, body)
          select g.id, ${input.senderId}::uuid, ${input.clientId}::uuid, ${input.body}
          from public.groups g
          where g.id = ${input.groupId}::uuid and g.deleted_at is null
          on conflict (group_id, client_id) do nothing
          returning *
        ), r as (
          select ins.*, true as created from ins
          union all
          select m.*, false as created from public.messages m
          where m.group_id = ${input.groupId}::uuid and m.client_id = ${input.clientId}::uuid
            and exists (select 1 from public.groups g where g.id = m.group_id and g.deleted_at is null)
            and not exists (select 1 from ins)
        )
        select ${MESSAGE_COLUMNS}, r.created from r ${WITH_SENDER}`);
      if (rows[0]) return { message: toRecord(rows[0]), created: rows[0].created };

      // Nothing came back: the group is gone, or two sends with one client id raced and the other
      // one's row was not visible to this statement. Look again.
      const found = await existing(input.groupId, input.clientId);
      if (found) return { message: found, created: false };
      throw new Error("send: the group does not exist or is deleted.");
    },

    listLatest: latest,

    async listAfter(groupId, cursorText, limit) {
      if (!isUuid(groupId)) return { messages: [], hasMore: false };
      const cursor = decodeResourceCursor(cursorText);
      if (!cursor) return latest(groupId, limit);
      const size = clampResourceLimit(limit);
      const rows = await db.execute<MessageRow>(sql`
        select ${MESSAGE_COLUMNS}
        from public.messages r ${WITH_SENDER}
        where r.group_id = ${groupId}::uuid and r.deleted_at is null and ${GROUP_IS_LIVE}
          and (r.created_at, r.id) > ${position(cursor)}
        order by r.created_at asc, r.id asc
        limit ${size + 1}`);
      return { messages: rows.slice(0, size).map(toRecord), hasMore: rows.length > size };
    },

    async listBefore(groupId, cursorText, limit) {
      if (!isUuid(groupId)) return { messages: [], hasMore: false };
      const cursor = decodeResourceCursor(cursorText);
      if (!cursor) return latest(groupId, limit);
      return newestFirst(groupId, clampResourceLimit(limit), cursor);
    },

    async findById(groupId, id) {
      if (!isUuid(groupId) || !isUuid(id)) return null;
      const rows = await db.execute<MessageRow>(sql`
        select ${MESSAGE_COLUMNS}
        from public.messages r ${WITH_SENDER}
        where r.id = ${id}::uuid and r.group_id = ${groupId}::uuid and r.deleted_at is null and ${GROUP_IS_LIVE}`);
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async softDelete(groupId, id) {
      if (!isUuid(groupId) || !isUuid(id)) return null;
      const rows = await db.execute<MessageRow>(sql`
        with r as (
          update public.messages x set deleted_at = now()
          where x.id = ${id}::uuid and x.group_id = ${groupId}::uuid and x.deleted_at is null
            and exists (select 1 from public.groups g where g.id = x.group_id and g.deleted_at is null)
          returning x.*
        )
        select ${MESSAGE_COLUMNS} from r ${WITH_SENDER}`);
      return rows[0] ? toRecord(rows[0]) : null;
    },
  };
}
