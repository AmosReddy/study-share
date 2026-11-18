import "server-only";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { ResourceStatus } from "@/shared/resources";
import type { ResourceRecord, ResourceStore } from "@/server/ports/resource-store";
import { cleanDetails, hasNul, legacyTypeKey, parseDetails } from "@/server/resource-answers";
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
  type_id: string;
  type_other: string;
  /** The details as JSON text (read with ::text so the driver's JSON handling cannot change it). */
  details: string;
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
  "r.id, r.group_id, r.uploader_id, coalesce(p.display_name, '') as uploader_name, r.title, " +
    "r.type_id, r.type_other, r.details::text as details, r.file_key, r.file_name, r.content_type, r.size_bytes, r.status, " +
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
    typeId: row.type_id,
    typeOther: row.type_other,
    details: parseDetails(row.details),
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

/** Makes `%`, `_` and `\` plain characters in a LIKE pattern (the backslash is the escape character). */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** A list of texts as a parameter: JSON text, cast through text so no driver turns the string into a JSON string. */
const jsonList = (values: string[]) => sql`${JSON.stringify(values.map((v) => v.toWellFormed()))}::text::jsonb`;

/** The texts of a list as a `text[]`, built from parameters only (an array parameter would be spread by the query builder). */
const textArray = (values: string[]) => sql`array(select jsonb_array_elements_text(${jsonList(values)}))`;

/** The details as a jsonb value, from one text parameter. */
const detailsJson = (details: Record<string, string>) => sql`${JSON.stringify(cleanDetails(details))}::text::jsonb`;

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
            (id, group_id, uploader_id, title, type, type_id, type_other, details, file_key, file_name, content_type, size_bytes, status)
          select ${input.id}::uuid, g.id, ${input.uploaderId}::uuid, ${input.title}, ${legacyTypeKey(input.typeId)},
            ${input.typeId}, ${input.typeOther}, ${detailsJson(input.details)},
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
      const text = query.search?.text.trim() ?? "";
      const details = query.details ?? [];
      // Text with a NUL character cannot be in any file, so it matches nothing (and would make Postgres throw).
      if (hasNul(text) || (query.typeId !== undefined && hasNul(query.typeId))) return none;
      if (details.some((d) => hasNul(d.fieldId) || hasNul(d.value))) return none;

      const filters = [sql`r.group_id = ${groupId}::uuid`, sql`r.status = 'ready'`, sql`r.deleted_at is null`, GROUP_IS_LIVE];
      if (text !== "") {
        const pattern = `%${escapeLike(text)}%`;
        // Ids with a NUL character match no file, so they are left out instead of failing the query.
        const typeIds = (query.search?.typeIds ?? []).filter((id) => !hasNul(id));
        const optionIds = (query.search?.optionIds ?? []).filter((id) => !hasNul(id));
        const textFieldIds = (query.search?.textFieldIds ?? []).filter((id) => !hasNul(id));
        // chr(92) is the backslash, written that way so no string-literal rule can change it.
        // Every list is a parameter (JSON text turned into a text[] by the database), never part of the SQL text.
        filters.push(sql`(
          r.title ilike ${pattern} escape chr(92)
          or r.file_name ilike ${pattern} escape chr(92)
          or r.type_other ilike ${pattern} escape chr(92)
          or exists (
            select 1 from jsonb_each_text(r.details) as e
            where e.key = any(${textArray(textFieldIds)}) and e.value ilike ${pattern} escape chr(92))
          or r.type_id = any(${textArray(typeIds)})
          or exists (
            select 1 from jsonb_each_text(r.details) as e
            where e.value = any(${textArray(optionIds)}))
        )`);
      }
      if (query.typeId !== undefined) filters.push(sql`r.type_id = ${query.typeId}`);
      for (const d of details) {
        // A missing answer counts as empty, so an empty value finds the files with no answer.
        const answer = sql`coalesce(r.details ->> ${d.fieldId}::text, '')`;
        filters.push(d.kind === "dropdown" ? sql`${answer} = ${d.value}` : sql`lower(${answer}) = lower(${d.value})`);
      }
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

    async listDetailValues(groupId, fieldId) {
      if (!isUuid(groupId) || hasNul(fieldId)) return [];
      // Grouped by the lower-case form so "Maths" and "maths" are one value; "C" compares the
      // bytes, as the fake compares strings, so both order and pick the same way. The value is
      // taken once in the inner query, so the field id is a single parameter.
      const rows = await db.execute<{ value: string }>(sql`
        select min(v collate "C") as value
        from (
          select r.details ->> ${fieldId}::text as v
          from public.resources r
          where r.group_id = ${groupId}::uuid and r.status = 'ready' and r.deleted_at is null and ${GROUP_IS_LIVE}
        ) t
        where v is not null and v <> ''
        group by lower(v)
        order by lower(v) collate "C"`);
      return rows.map((r) => r.value);
    },

    async usedOptionIds(groupId, fieldIds) {
      const empty = { typeIds: [], detailValues: {} };
      if (!isUuid(groupId)) return empty;
      const live = sql`r.group_id = ${groupId}::uuid and r.status = 'ready' and r.deleted_at is null and ${GROUP_IS_LIVE}`;
      // Only the details asked about are read. An id with a NUL character cannot be a jsonb key.
      const wanted = [...new Set(fieldIds.filter((id) => !hasNul(id)))];
      const [types, values] = await Promise.all([
        db.execute<{ type_id: string }>(sql`select distinct r.type_id from public.resources r where ${live}`),
        wanted.length === 0
          ? Promise.resolve([] as { field_id: string; value: string }[])
          : db.execute<{ field_id: string; value: string }>(sql`
              select distinct e.key as field_id, e.value
              from public.resources r, jsonb_each_text(r.details) as e
              where ${live} and e.value <> '' and e.key = any(${textArray(wanted)})`),
      ]);
      // Sorted here, by UTF-16 code units, exactly as the fake sorts, so both give one order.
      const byBytes = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
      const byField = new Map<string, string[]>();
      for (const row of values) byField.set(row.field_id, [...(byField.get(row.field_id) ?? []), row.value]);
      return {
        typeIds: types.map((r) => r.type_id).sort(byBytes),
        // fromEntries makes own properties, so a detail id like "__proto__" stays plain data.
        detailValues: Object.fromEntries([...byField].sort(([a], [b]) => byBytes(a, b)).map(([id, list]) => [id, list.sort(byBytes)])),
      };
    },

    async update(groupId, id, d) {
      if (!isUuid(groupId) || !isUuid(id)) return null;
      const rows = await db.execute<ResourceRow>(sql`
        with r as (
          update public.resources x
          set title = ${d.title}, type = ${legacyTypeKey(d.typeId)}, type_id = ${d.typeId}, type_other = ${d.typeOther},
            details = ${detailsJson(d.details)}
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
