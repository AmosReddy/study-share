import "server-only";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type {
  DirectChatStore,
  DirectChatSummary,
  DirectMessagePage,
  DirectMessageRecord,
} from "@/server/ports/direct-chat-store";
import { clampResourceLimit, decodeResourceCursor, encodeResourceCursor } from "@/server/resource-cursor";

/**
 * Single statements only, so each method is atomic with no explicit lock. Generic over the schema
 * only so the app's typed database (getDb) fits; no schema is used.
 */
type Executor<S extends Record<string, unknown>> = Pick<PostgresJsDatabase<S>, "execute">;

type MessageRow = {
  id: string;
  chat_id: string;
  sender_id: string | null;
  sender_name: string;
  body: string;
  client_id: string;
  created_ms: number;
  created_us: string | number;
  deleted: boolean;
};

/**
 * The columns a DirectMessageRecord is made from, for a source named `r` joined to `p` (see
 * WITH_SENDER). Times come back as numbers because the driver hands timestamps over as text:
 * milliseconds for the record, microseconds for the cursor.
 */
const MESSAGE_COLUMNS = sql.raw(
  "r.id, r.chat_id, r.sender_id, coalesce(p.display_name, '') as sender_name, r.body, r.client_id, " +
    "(extract(epoch from r.created_at) * 1000)::float8 as created_ms, " +
    "round(extract(epoch from r.created_at) * 1000000)::bigint as created_us, " +
    "(r.deleted_at is not null) as deleted",
);

/** The sender's name, when the account still has a profile. */
const WITH_SENDER = sql.raw("left join public.profiles p on p.id = r.sender_id");

/** The message's chat exists and its group is not deleted; `r` is the message. */
const CHAT_IS_LIVE = sql.raw(
  "exists (select 1 from public.direct_chats c join public.groups g on g.id = c.group_id where c.id = r.chat_id and g.deleted_at is null)",
);

/**
 * Both people of the chat aliased `chat` are ACTIVE members of its group. The membership rows are locked FOR SHARE
 * while the statement runs, so a removal that commits first is seen (the row is re-read) and one
 * that comes second waits until the message is saved: a message cannot land after a removal.
 */
const bothActive = (chat: string, lock = true) => {
  const share = lock ? " for share of gm" : "";
  return sql.raw(
    `exists (select 1 from public.group_members gm where gm.group_id = ${chat}.group_id and gm.user_id = ${chat}.user_low and gm.status = 'active'${share}) ` +
      `and exists (select 1 from public.group_members gm where gm.group_id = ${chat}.group_id and gm.user_id = ${chat}.user_high and gm.status = 'active'${share})`,
  );
};

function toRecord(row: MessageRow): DirectMessageRecord {
  return {
    id: row.id,
    chatId: row.chat_id,
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

/** How much of the newest message the list shows, in characters (Postgres' left() counts characters, not bytes). */
const SUMMARY_LENGTH = 80;

/**
 * The SQL DirectChatStore, on public.direct_chats, direct_messages and direct_reads (RLS on, no
 * policies; the app connects as the tables' owner). It never reads public.messages, the group
 * chat's table. Every read joins the chat's group and skips chats of deleted groups, and messages
 * whose deleted_at is set. Everything a person's id is compared with is a bound parameter.
 */
export function createDirectChatStore<S extends Record<string, unknown> = Record<string, never>>(db: Executor<S>): DirectChatStore {
  /** The newest-first query with an optional position filter; one more than `limit` tells whether there is more. */
  async function newestFirst(chatId: string, limit: number, before?: { micros: number; id: string }) {
    const filters = [sql`r.chat_id = ${chatId}::uuid`, sql`r.deleted_at is null`, CHAT_IS_LIVE];
    if (before) filters.push(sql`(r.created_at, r.id) < ${position(before)}`);
    const rows = await db.execute<MessageRow>(sql`
      select ${MESSAGE_COLUMNS}
      from public.direct_messages r ${WITH_SENDER}
      where ${sql.join(filters, sql` and `)}
      order by r.created_at desc, r.id desc
      limit ${limit + 1}`);
    return {
      messages: rows.slice(0, limit).map(toRecord).reverse(),
      hasMore: rows.length > limit,
    } satisfies DirectMessagePage;
  }

  async function latest(chatId: string, limit: number): Promise<DirectMessagePage> {
    if (!isUuid(chatId)) return { messages: [], hasMore: false };
    return newestFirst(chatId, clampResourceLimit(limit));
  }

  /** The row for (chat, client id) as it is now, for a send that lost a race. Only for a live chat the sender is in. */
  async function existing(chatId: string, senderId: string, clientId: string): Promise<DirectMessageRecord | null> {
    const rows = await db.execute<MessageRow>(sql`
      select ${MESSAGE_COLUMNS}
      from public.direct_messages r ${WITH_SENDER}
      where r.chat_id = ${chatId}::uuid and r.client_id = ${clientId}::uuid and ${CHAT_IS_LIVE}
        and exists (
          select 1 from public.direct_chats c
          where c.id = r.chat_id and (c.user_low = ${senderId}::uuid or c.user_high = ${senderId}::uuid)
            and ${bothActive("c", false)}
        )`);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  /** The chat of this pair in this group, when the group is live. */
  async function pairChat(groupId: string, low: string, high: string): Promise<string | null> {
    const rows = await db.execute<{ id: string }>(sql`
      select c.id from public.direct_chats c join public.groups g on g.id = c.group_id
      where c.group_id = ${groupId}::uuid and c.user_low = ${low}::uuid and c.user_high = ${high}::uuid and g.deleted_at is null`);
    return rows[0]?.id ?? null;
  }

  return {
    async openChat(groupId, userX, userY) {
      if (!isUuid(groupId) || !isUuid(userX) || !isUuid(userY)) throw new Error("openChat needs uuids for the group and both people.");
      const x = userX.toLowerCase();
      const y = userY.toLowerCase();
      if (x === y) throw new Error("openChat: a chat needs two different people.");
      // Lower-case hex text sorts like the uuid type does (byte by byte), so this is the order the check constraint wants.
      const [low, high] = x < y ? [x, y] : [y, x];

      // The insert selects from the live group, so a deleted or unknown group inserts nothing. On a
      // repeat, `ins` is empty and the second branch finds the chat that was made before.
      const rows = await db.execute<{ id: string; created: boolean }>(sql`
        with ins as (
          insert into public.direct_chats (group_id, user_low, user_high)
          select g.id, ${low}::uuid, ${high}::uuid
          from public.groups g
          where g.id = ${groupId}::uuid and g.deleted_at is null
          on conflict (group_id, user_low, user_high) do nothing
          returning id
        )
        select id, true as created from ins
        union all
        select c.id, false as created from public.direct_chats c join public.groups g on g.id = c.group_id
        where c.group_id = ${groupId}::uuid and c.user_low = ${low}::uuid and c.user_high = ${high}::uuid
          and g.deleted_at is null and not exists (select 1 from ins)`);
      if (rows[0]) return { chatId: rows[0].id, created: rows[0].created };

      // Nothing came back: the group is gone, or two opens raced and the other one's row was not
      // visible to this statement. Look again (that one made it, so this call did not).
      const found = await pairChat(groupId, low, high);
      if (found) return { chatId: found, created: false };
      throw new Error("openChat: the group does not exist or is deleted.");
    },

    async findPairChat(groupId, userX, userY) {
      if (!isUuid(groupId) || !isUuid(userX) || !isUuid(userY)) return null;
      const x = userX.toLowerCase();
      const y = userY.toLowerCase();
      if (x === y) return null;
      const [low, high] = x < y ? [x, y] : [y, x];
      const found = await pairChat(groupId, low, high);
      return found ? { chatId: found } : null;
    },

    async findChat(groupId, chatId) {
      if (!isUuid(groupId) || !isUuid(chatId)) return null;
      const rows = await db.execute<{ id: string; user_low: string; user_high: string }>(sql`
        select c.id, c.user_low, c.user_high
        from public.direct_chats c join public.groups g on g.id = c.group_id
        where c.id = ${chatId}::uuid and c.group_id = ${groupId}::uuid and g.deleted_at is null`);
      const row = rows[0];
      return row ? { id: row.id, participants: [row.user_low, row.user_high] } : null;
    },

    async listChatsFor(groupId, userId) {
      if (!isUuid(groupId) || !isUuid(userId)) return [];
      // The inner lateral join on the newest message that is not deleted is what hides chats with none.
      const rows = await db.execute<{
        chat_id: string;
        other_user_id: string;
        other_name: string;
        last_body: string;
        last_ms: number;
        unread: boolean;
      }>(sql`
        select c.id as chat_id, o.other_id as other_user_id, coalesce(p.display_name, '') as other_name,
          left(l.body, ${SUMMARY_LENGTH}::int) as last_body,
          (extract(epoch from l.created_at) * 1000)::float8 as last_ms,
          exists (
            select 1 from public.direct_messages m
            where m.chat_id = c.id and m.deleted_at is null and m.sender_id is distinct from ${userId}::uuid
              and (rd.read_created_at is null or (m.created_at, m.id) > (rd.read_created_at, rd.read_message_id))
          ) as unread
        from public.direct_chats c
        join public.groups g on g.id = c.group_id and g.deleted_at is null
        cross join lateral (
          select case when c.user_low = ${userId}::uuid then c.user_high else c.user_low end as other_id
        ) o
        join lateral (
          select m.body, m.created_at, m.id from public.direct_messages m
          where m.chat_id = c.id and m.deleted_at is null
          order by m.created_at desc, m.id desc limit 1
        ) l on true
        left join public.profiles p on p.id = o.other_id
        left join public.direct_reads rd on rd.chat_id = c.id and rd.user_id = ${userId}::uuid
        where c.group_id = ${groupId}::uuid and (c.user_low = ${userId}::uuid or c.user_high = ${userId}::uuid)
        order by l.created_at desc, l.id desc`);
      return rows.map(
        (row): DirectChatSummary => ({
          chatId: row.chat_id,
          otherUserId: row.other_user_id,
          otherName: row.other_name,
          lastBody: row.last_body,
          lastAt: new Date(Number(row.last_ms)),
          unread: row.unread,
        }),
      );
    },

    async send(input) {
      if (!isUuid(input.chatId) || !isUuid(input.senderId) || !isUuid(input.clientId)) {
        throw new Error("send needs uuids for the chat, the sender and the client id.");
      }
      // Postgres cannot store a NUL character in text, and the driver would throw an obscure error.
      if (input.body.includes("\u0000")) throw new Error("send: text cannot hold a NUL character.");

      // `c` is the chat when its group is live, the sender is one of its two people AND both of them
      // are still active members of the group (the membership is locked for the statement); with no
      // such chat nothing is inserted and nothing is returned, not even for a repeat. On a repeat,
      // `ins` is empty and the second branch finds the row that was saved before (this statement's
      // snapshot is from before the insert, so it never sees a row `ins` just made).
      const rows = await db.execute<MessageRow & { created: boolean }>(sql`
        with c as (
          select ch.id from public.direct_chats ch join public.groups g on g.id = ch.group_id
          where ch.id = ${input.chatId}::uuid and g.deleted_at is null
            and (ch.user_low = ${input.senderId}::uuid or ch.user_high = ${input.senderId}::uuid)
            and ${bothActive("ch")}
        ), ins as (
          insert into public.direct_messages (chat_id, sender_id, client_id, body)
          select c.id, ${input.senderId}::uuid, ${input.clientId}::uuid, ${input.body} from c
          on conflict (chat_id, client_id) do nothing
          returning *
        ), r as (
          select ins.*, true as created from ins
          union all
          select m.*, false as created from public.direct_messages m
          where m.chat_id = ${input.chatId}::uuid and m.client_id = ${input.clientId}::uuid
            and exists (select 1 from c) and not exists (select 1 from ins)
        )
        select ${MESSAGE_COLUMNS}, r.created from r ${WITH_SENDER}`);
      if (rows[0]) return { message: toRecord(rows[0]), created: rows[0].created };

      // Nothing came back: the chat or its group is gone, the sender is not in the chat, a person of it
      // is no longer a member, or two
      // sends with one client id raced and the other one's row was not visible to this statement.
      const found = await existing(input.chatId, input.senderId, input.clientId);
      if (found) return { message: found, created: false };
      throw new Error("send: the chat does not exist, its group is deleted, the sender is not in it, or a person of it is no longer a member.");
    },

    listLatest: latest,

    async listAfter(chatId, cursorText, limit) {
      if (!isUuid(chatId)) return { messages: [], hasMore: false };
      const cursor = decodeResourceCursor(cursorText);
      if (!cursor) return latest(chatId, limit);
      const size = clampResourceLimit(limit);
      const rows = await db.execute<MessageRow>(sql`
        select ${MESSAGE_COLUMNS}
        from public.direct_messages r ${WITH_SENDER}
        where r.chat_id = ${chatId}::uuid and r.deleted_at is null and ${CHAT_IS_LIVE}
          and (r.created_at, r.id) > ${position(cursor)}
        order by r.created_at asc, r.id asc
        limit ${size + 1}`);
      return { messages: rows.slice(0, size).map(toRecord), hasMore: rows.length > size };
    },

    async listBefore(chatId, cursorText, limit) {
      if (!isUuid(chatId)) return { messages: [], hasMore: false };
      const cursor = decodeResourceCursor(cursorText);
      if (!cursor) return latest(chatId, limit);
      return newestFirst(chatId, clampResourceLimit(limit), cursor);
    },

    async findMessageById(chatId, id) {
      if (!isUuid(chatId) || !isUuid(id)) return null;
      const rows = await db.execute<MessageRow>(sql`
        select ${MESSAGE_COLUMNS}
        from public.direct_messages r ${WITH_SENDER}
        where r.id = ${id}::uuid and r.chat_id = ${chatId}::uuid and r.deleted_at is null and ${CHAT_IS_LIVE}`);
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async softDelete(chatId, id) {
      if (!isUuid(chatId) || !isUuid(id)) return null;
      const rows = await db.execute<MessageRow>(sql`
        with r as (
          update public.direct_messages x set deleted_at = now()
          where x.id = ${id}::uuid and x.chat_id = ${chatId}::uuid and x.deleted_at is null
            and exists (
              select 1 from public.direct_chats c join public.groups g on g.id = c.group_id
              where c.id = x.chat_id and g.deleted_at is null
            )
          returning x.*
        )
        select ${MESSAGE_COLUMNS} from r ${WITH_SENDER}`);
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async markRead(chatId, userId, cursorText) {
      if (!isUuid(chatId) || !isUuid(userId)) return;
      const cursor = decodeResourceCursor(cursorText);
      if (!cursor) return;
      // Only for a live chat the person is in. An existing position is replaced only by a LATER one.
      await db.execute(sql`
        insert into public.direct_reads (chat_id, user_id, read_created_at, read_message_id)
        select c.id, ${userId}::uuid,
          timestamptz 'epoch' + ${String(cursor.micros)}::bigint * interval '1 microsecond', ${cursor.id}::uuid
        from public.direct_chats c join public.groups g on g.id = c.group_id
        where c.id = ${chatId}::uuid and g.deleted_at is null
          and (c.user_low = ${userId}::uuid or c.user_high = ${userId}::uuid)
        on conflict (chat_id, user_id) do update
          set read_created_at = excluded.read_created_at, read_message_id = excluded.read_message_id
          where (direct_reads.read_created_at, direct_reads.read_message_id) < (excluded.read_created_at, excluded.read_message_id)`);
    },

    async unreadSummary(groupId, userId) {
      if (!isUuid(groupId) || !isUuid(userId)) return { any: false, fromUserIds: [] };
      const rows = await db.execute<{ other_id: string }>(sql`
        select distinct (case when c.user_low = ${userId}::uuid then c.user_high else c.user_low end)::text as other_id
        from public.direct_chats c
        join public.groups g on g.id = c.group_id and g.deleted_at is null
        left join public.direct_reads rd on rd.chat_id = c.id and rd.user_id = ${userId}::uuid
        where c.group_id = ${groupId}::uuid and (c.user_low = ${userId}::uuid or c.user_high = ${userId}::uuid)
          and exists (
            select 1 from public.direct_messages m
            where m.chat_id = c.id and m.deleted_at is null and m.sender_id is distinct from ${userId}::uuid
              and (rd.read_created_at is null or (m.created_at, m.id) > (rd.read_created_at, rd.read_message_id))
          )`);
      const fromUserIds = rows.map((row) => row.other_id);
      return { any: fromUserIds.length > 0, fromUserIds };
    },
  };
}
