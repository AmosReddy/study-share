import "server-only";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { ResourceStatus, ResourceType } from "@/shared/resources";
import type { ResourceRecord, ResourceStore } from "@/server/ports/resource-store";
import { clampResourceLimit, decodeResourceCursor, encodeResourceCursor } from "@/server/resource-cursor";

/**
 * Single statements only: no lock is needed because every method touches one row (or reads).
 * Generic over the schema only so the app's typed database (getDb) fits; no schema is used.
 */
type Executor<S extends Record<string, unknown>> = Pick<PostgresJsDatabase<S>, "execute">;

type ResourceRow = {
  id: string;
  group_id: string;
  uploader_id: string | null;
  uploader_name: string;
  title: string;
  subject: string;
  type: ResourceType;
  file_key: string;
  file_name: string;
  content_type: string;
  size_bytes: string | number;
  status: ResourceStatus;
  created_ms: number;
  created_us: string | number;
};

/** The columns a ResourceRecord is made from, for a source named `r` joined to `p` (see
 * WITH_UPLOADER). Times come back as numbers because the driver hands timestamps over as text:
 * milliseconds for the record, microseconds for the list cursor. */
const RESOURCE_COLUMNS = sql.raw(
  "r.id, r.group_id, r.uploader_id, coalesce(p.display_name, '') as uploader_name, r.title, r.subject, " +
    "r.type, r.file_key, r.file_name, r.content_type, r.size_bytes, r.status, " +
    "(extract(epoch from r.created_at) * 1000)::float8 as created_ms, " +
    "round(extract(epoch from r.created_at) * 1000000)::bigint as created_us",
);

/** The uploader's name, when the account still has a profile. */
const WITH_UPLOADER = sql.raw("left join public.profiles p on p.id = r.uploader_id");

/** The file's group exists and is not deleted; `r` is the resource. */
const GROUP_IS_LIVE = sql.raw("exists (select 1 from public.groups g where g.id = r.group_id and g.deleted_at is null)");

function toRecord(row: ResourceRow): ResourceRecord {
  return {
    id: row.id,
    groupId: row.group_id,
    uploaderId: row.uploader_id,
    uploaderName: row.uploader_name,
    title: row.title,
    subject: row.subject,
    type: row.type,
    fileKey: row.file_key,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    status: row.status,
    createdAt: new Date(Number(row.created_ms)),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id that is not a uuid names nothing; checking first keeps Postgres from raising on the cast. */
function isUuid(id: string): boolean {
  return UUID.test(id);
}

/** Postgres cannot store a NUL character in text, so no file has one, and comparing with one would throw. */
const hasNul = (text: string) => text.includes("\u0000");

/** Makes `%`, `_` and `\` plain characters in a LIKE pattern (the backslash is the escape character). */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The SQL ResourceStore, on public.resources (RLS on, no policies; the app connects as the
 * table's owner). Every read joins groups and skips files of deleted groups, and skips files whose
 * deleted_at is set. The uploader's name comes from public.profiles (empty once the account is
 * gone, when uploader_id has been cleared).
 */
export function createResourceStore<S extends Record<string, unknown> = Record<string, never>>(db: Executor<S>): ResourceStore {
  return {
    async createPending(input) {
      if (!isUuid(input.id) || !isUuid(input.groupId) || !isUuid(input.uploaderId)) {
        throw new Error("createPending needs uuids for the file, the group and the uploader.");
      }
      // The insert selects from the live group, so a deleted or unknown group inserts nothing.
      const rows = await db.execute<ResourceRow>(sql`
        with r as (
          insert into public.resources
            (id, group_id, uploader_id, title, subject, type, file_key, file_name, content_type, size_bytes, status)
          select ${input.id}::uuid, g.id, ${input.uploaderId}::uuid, ${input.title}, ${input.subject}, ${input.type},
            ${input.fileKey}, ${input.fileName}, ${input.contentType}, ${input.sizeBytes}::bigint, 'uploading'
          from public.groups g
          where g.id = ${input.groupId}::uuid and g.deleted_at is null
          returning *
        )
        select ${RESOURCE_COLUMNS} from r ${WITH_UPLOADER}`);
      if (rows.length === 0) throw new Error("createPending: the group does not exist or is deleted.");
      return toRecord(rows[0]);
    },

    async markReady(id, groupId) {
      if (!isUuid(id) || !isUuid(groupId)) return null;
      // `changed` is the row just made ready; the second branch sees the snapshot from before the
      // update, so it finds only a file that was ready already (a retry).
      const rows = await db.execute<ResourceRow>(sql`
        with changed as (
          update public.resources x set status = 'ready'
          where x.id = ${id}::uuid and x.group_id = ${groupId}::uuid and x.status = 'uploading' and x.deleted_at is null
            and exists (select 1 from public.groups g where g.id = x.group_id and g.deleted_at is null)
          returning x.*
        ), r as (
          select * from changed
          union all
          select x.* from public.resources x
          where x.id = ${id}::uuid and x.group_id = ${groupId}::uuid and x.status = 'ready' and x.deleted_at is null
            and exists (select 1 from public.groups g where g.id = x.group_id and g.deleted_at is null)
        )
        select ${RESOURCE_COLUMNS} from r ${WITH_UPLOADER}`);
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async findById(groupId, id) {
      if (!isUuid(groupId) || !isUuid(id)) return null;
      const rows = await db.execute<ResourceRow>(sql`
        select ${RESOURCE_COLUMNS}
        from public.resources r ${WITH_UPLOADER}
        where r.id = ${id}::uuid and r.group_id = ${groupId}::uuid and r.deleted_at is null and ${GROUP_IS_LIVE}`);
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async list(groupId, query) {
      const none = { items: [], nextCursor: null };
      if (!isUuid(groupId)) return none;
      const limit = clampResourceLimit(query.limit);
      const search = query.search?.trim() ?? "";
      if (hasNul(search) || (query.subject !== undefined && hasNul(query.subject))) return none;

      const filters = [sql`r.group_id = ${groupId}::uuid`, sql`r.status = 'ready'`, sql`r.deleted_at is null`, GROUP_IS_LIVE];
      if (search !== "") {
        const pattern = `%${escapeLike(search)}%`;
        // chr(92) is the backslash, written that way so no string-literal rule can change it.
        filters.push(
          sql`(r.title ilike ${pattern} escape chr(92) or r.subject ilike ${pattern} escape chr(92) or r.file_name ilike ${pattern} escape chr(92))`,
        );
      }
      if (query.type !== undefined) filters.push(sql`r.type = ${query.type}`);
      if (query.subject !== undefined) filters.push(sql`lower(r.subject) = lower(${query.subject})`);
      const cursor = decodeResourceCursor(query.cursor);
      if (cursor) {
        // Exact microseconds from the epoch, so the comparison is on the stored time itself.
        filters.push(
          sql`(r.created_at, r.id) < (timestamptz 'epoch' + ${String(cursor.micros)}::bigint * interval '1 microsecond', ${cursor.id}::uuid)`,
        );
      }

      // One more than asked for tells whether there is a next page.
      const rows = await db.execute<ResourceRow>(sql`
        select ${RESOURCE_COLUMNS}
        from public.resources r ${WITH_UPLOADER}
        where ${sql.join(filters, sql` and `)}
        order by r.created_at desc, r.id desc
        limit ${limit + 1}`);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map(toRecord),
        nextCursor: rows.length > limit ? encodeResourceCursor({ micros: Number(last.created_us), id: last.id }) : null,
      };
    },

    async listSubjects(groupId) {
      if (!isUuid(groupId)) return [];
      // Grouped by the lower-case form so "Maths" and "maths" are one subject; "C" compares the
      // bytes, as the fake compares strings, so both order and pick the same way.
      const rows = await db.execute<{ subject: string }>(sql`
        select min(r.subject collate "C") as subject
        from public.resources r
        where r.group_id = ${groupId}::uuid and r.status = 'ready' and r.deleted_at is null and r.subject <> ''
          and ${GROUP_IS_LIVE}
        group by lower(r.subject)
        order by lower(r.subject) collate "C"`);
      return rows.map((r) => r.subject);
    },

    async update(groupId, id, d) {
      if (!isUuid(groupId) || !isUuid(id)) return null;
      const rows = await db.execute<ResourceRow>(sql`
        with r as (
          update public.resources x set title = ${d.title}, subject = ${d.subject}, type = ${d.type}
          where x.id = ${id}::uuid and x.group_id = ${groupId}::uuid and x.deleted_at is null
            and exists (select 1 from public.groups g where g.id = x.group_id and g.deleted_at is null)
          returning x.*
        )
        select ${RESOURCE_COLUMNS} from r ${WITH_UPLOADER}`);
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async softDelete(groupId, id) {
      if (!isUuid(groupId) || !isUuid(id)) return null;
      const rows = await db.execute<ResourceRow>(sql`
        with r as (
          update public.resources x set deleted_at = now()
          where x.id = ${id}::uuid and x.group_id = ${groupId}::uuid and x.deleted_at is null
            and exists (select 1 from public.groups g where g.id = x.group_id and g.deleted_at is null)
          returning x.*
        )
        select ${RESOURCE_COLUMNS} from r ${WITH_UPLOADER}`);
      return rows[0] ? toRecord(rows[0]) : null;
    },
  };
}
