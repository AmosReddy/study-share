import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, test } from "vitest";
import { runResourceStoreContract, type ResourceStoreContext } from "@/server/adapters/resource-store.contract";
import { DEFAULT_FORM_CONFIG } from "@/shared/form-config";
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
      const insert = (over: {
        type?: string;
        typeId?: string;
        typeOther?: string;
        details?: string;
        status?: string;
        size?: number;
        title?: string;
        subject?: string;
        fileName?: string;
      }) =>
        client`
          insert into public.resources
            (group_id, uploader_id, title, subject, type, type_id, type_other, details, file_key, file_name, content_type, size_bytes, status)
          values (${groupId}, ${owner}, ${over.title ?? "T"}, ${over.subject ?? ""}, ${over.type ?? "notes"}, ${over.typeId ?? "notes"},
            ${over.typeOther ?? ""}, ${over.details ?? "{}"}::text::jsonb,
            ${`key-${randomUUID()}`}, ${over.fileName ?? "a.pdf"}, 'application/pdf', ${over.size ?? 1}, ${over.status ?? "ready"})`;

      // The old check on `type` is gone on purpose: a custom type is stored as `other`, and the real type is type_id.
      await insert({ type: "video" });
      expect(await rejection(insert({ typeId: "" }))).toMatchObject({ code: "23514", constraint_name: "resources_type_id_length_check" });
      expect(await rejection(insert({ typeId: "x".repeat(65) }))).toMatchObject({
        code: "23514",
        constraint_name: "resources_type_id_length_check",
      });
      await insert({ typeId: "x".repeat(64), typeOther: "y".repeat(40) });
      expect(await rejection(insert({ typeOther: "y".repeat(41) }))).toMatchObject({
        code: "23514",
        constraint_name: "resources_type_other_length_check",
      });
      expect(await rejection(insert({ details: "[]" }))).toMatchObject({ code: "23514", constraint_name: "resources_details_object_check" });
      expect(await rejection(insert({ details: '"text"' }))).toMatchObject({ code: "23514", constraint_name: "resources_details_object_check" });
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
      // And so are the new columns: no Other text, no details (old code inserts rows like this one).
      const [fresh] = await client<{ type_id: string; type_other: string; details: Record<string, string> }[]>`
        select type_id, type_other, details from public.resources where group_id = ${groupId} and title = 'T' and status = 'uploading'`;
      expect(fresh).toEqual({ type_id: "other", type_other: "", details: {} });
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
        typeId: "notes",
        typeOther: "",
        details: {},
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
  test("the old type column holds the legacy key (other for a custom type), and subject stays empty", () =>
    withStore(async ({ store, client, newUser, newGroup }) => {
      const owner = await newUser();
      const groupId = await newGroup(owner);
      const make = async (typeId: string) => {
        const id = randomUUID();
        await store.createPending({
          id,
          groupId,
          uploaderId: owner,
          title: "T",
          typeId,
          typeOther: "",
          details: { subject: "Maths" },
          fileKey: `key-${id}`,
          fileName: "a.pdf",
          contentType: "application/pdf",
          sizeBytes: 1,
        });
        return id;
      };
      const columns = async (id: string) => {
        const [row] = await client<{ type: string; type_id: string; subject: string; details: string }[]>`
          select type, type_id, subject, details::text as details from public.resources where id = ${id}`;
        return { ...row, details: JSON.parse(row.details) };
      };
      for (const key of ["notes", "pyq", "study_material", "assignment", "other"]) {
        expect(await columns(await make(key))).toEqual({ type: key, type_id: key, subject: "", details: { subject: "Maths" } });
      }
      const custom = await make("k3j9x");
      expect(await columns(custom)).toEqual({ type: "other", type_id: "k3j9x", subject: "", details: { subject: "Maths" } });

      await store.update(groupId, custom, { title: "T", typeId: "pyq", typeOther: "", details: {} });
      expect(await columns(custom)).toEqual({ type: "pyq", type_id: "pyq", subject: "", details: {} });
      await store.update(groupId, custom, { title: "T", typeId: "z9", typeOther: "", details: {} });
      expect(await columns(custom)).toMatchObject({ type: "other", type_id: "z9" });
    }));

  test("details and the Other text round trip exactly, whatever characters they hold", () =>
    withStore(async ({ store, newUser, newGroup }) => {
      const owner = await newUser();
      const groupId = await newGroup(owner);
      const details = {
        subject: "Quote \" backslash \\ percent % underscore _ 'single' emoji 😀",
        "d with space": "ünï {braces} [brackets] $1 $$",
        proto_like: "plain",
      };
      const id = randomUUID();
      await store.createPending({
        id,
        groupId,
        uploaderId: owner,
        title: "T",
        typeId: "other",
        typeOther: 'Lab "manual" 😀',
        details,
        fileKey: `key-${id}`,
        fileName: "a.pdf",
        contentType: "application/pdf",
        sizeBytes: 1,
      });
      await store.markReady(id, groupId);
      expect(await store.findById(groupId, id)).toMatchObject({ typeId: "other", typeOther: 'Lab "manual" 😀', details });
      // A JSON-looking text answer stays text: it is not turned into a JSON string or an object.
      await store.update(groupId, id, { title: "T", typeId: "notes", typeOther: "", details: { subject: '{"a":1}', n: "[1,2]" } });
      expect((await store.findById(groupId, id))?.details).toEqual({ subject: '{"a":1}', n: "[1,2]" });
      const found = await store.list(groupId, { limit: 10, details: [{ fieldId: "subject", kind: "text", value: '{"A":1}' }] });
      expect(found.items).toHaveLength(1);
    }));

  /*
    The tests below are about migration 0007 itself. The first two check what `npm run db:migrate`
    produced in this database. The last replays the real migration files 0004, 0005 and 0007 (their
    text, with the schema name public swapped for a throw-away one) inside a transaction that is
    always rolled back, on rows shaped the way they were before the migration, so nothing is left
    behind and no real table is touched. Assumed: the database role may create a schema, and
    auth.users exists (it does in Supabase and in the CI stand-in).
  */
  test("a row inserted with only the old type and subject columns gets type_id and details from the database", () =>
    withStore(async ({ store, client, newUser, newGroup }) => {
      const owner = await newUser();
      const groupId = await newGroup(owner);
      const oldCode = (type: string, subject: string) =>
        client<{ id: string }[]>`
          insert into public.resources (group_id, uploader_id, title, subject, type, file_key, file_name, content_type, size_bytes, status)
          values (${groupId}, ${owner}, ${`${type}/${subject}`}, ${subject}, ${type}, ${`key-${randomUUID()}`}, 'a.pdf', 'application/pdf', 1, 'ready')
          returning id`;
      const [withSubject] = await oldCode("pyq", "Maths");
      const [withoutSubject] = await oldCode("other", "");
      const [last] = await oldCode("assignment", "Physics");

      expect(await store.findById(groupId, withSubject.id)).toMatchObject({ typeId: "pyq", typeOther: "", details: { subject: "Maths" } });
      expect(await store.findById(groupId, withoutSubject.id)).toMatchObject({ typeId: "other", typeOther: "", details: {} });
      expect(await store.findById(groupId, last.id)).toMatchObject({ typeId: "assignment", details: { subject: "Physics" } });
      // Such rows are found by the new list, filters and search like any other.
      const titles = async (query: Partial<Parameters<typeof store.list>[1]>) =>
        (await store.list(groupId, { limit: 10, ...query })).items.map((r) => r.title);
      expect(await titles({ typeId: "pyq" })).toEqual(["pyq/Maths"]);
      expect(await titles({ details: [{ fieldId: "subject", kind: "text", value: "physics" }] })).toEqual(["assignment/Physics"]);
      expect(await titles({ search: { text: "maths", typeIds: [], optionIds: [], textFieldIds: ["subject"] } })).toEqual(["pyq/Maths"]);
      expect(await store.listDetailValues(groupId, "subject")).toEqual(["Maths", "Physics"]);

      // A row that already has its answers keeps them: the rule only fills what is missing.
      const [own] = await client<{ type_id: string; details: string }[]>`
        insert into public.resources (group_id, uploader_id, title, type, type_id, details, file_key, file_name, content_type, size_bytes, status)
        values (${groupId}, ${owner}, 'own', 'other', 'k3j9x', '{"a":"b"}'::text::jsonb, ${`key-${randomUUID()}`}, 'a.pdf', 'application/pdf', 1, 'ready')
        returning type_id, details::text as details`;
      expect({ type_id: own.type_id, details: JSON.parse(own.details) }).toEqual({ type_id: "k3j9x", details: { a: "b" } });
    }));

  test("a group inserted without a form_config gets the default configuration, and the new columns cannot be null", () =>
    withStore(async ({ client }) => {
      const group = createGroupStore(drizzle(client));
      const [row] = await client<{ id: string; form_config: string }[]>`
        insert into public.groups (name, join_mode, invite_token, invite_code)
        values ('Made by old code', 'link', ${`token-${randomUUID()}`}, ${randomUUID().slice(0, 8).toUpperCase()})
        returning id, form_config::text as form_config`;
      try {
        expect(JSON.parse(row.form_config)).toEqual(DEFAULT_FORM_CONFIG);
        expect((await group.findById(row.id))?.formConfig).toEqual(DEFAULT_FORM_CONFIG);

        const columns = await client<{ table_name: string; column_name: string; is_nullable: string }[]>`
          select table_name, column_name, is_nullable from information_schema.columns
          where table_schema = 'public' and (table_name, column_name) in
            (('groups', 'form_config'), ('resources', 'type_id'), ('resources', 'type_other'), ('resources', 'details'))
          order by table_name, column_name`;
        expect(columns.map((c) => [c.table_name, c.column_name, c.is_nullable])).toEqual([
          ["groups", "form_config", "NO"],
          ["resources", "details", "NO"],
          ["resources", "type_id", "NO"],
          ["resources", "type_other", "NO"],
        ]);
        expect(await rejection(client`update public.groups set form_config = null where id = ${row.id}`)).toMatchObject({ code: "23502" });
      } finally {
        await client`delete from public.groups where id = ${row.id}`;
      }
    }));

  test("migration 0007 moves rows shaped like the old schema, and can run twice (scratch schema, rolled back)", () =>
    withStore(async ({ client }) => {
      const dir = new URL("../../../drizzle/", import.meta.url);
      const schema = `mig_${randomUUID().replaceAll("-", "")}`;
      /** One migration file as its statements, aimed at the scratch schema instead of public. */
      const statementsOf = (file: string) =>
        readFileSync(fileURLToPath(new URL(file, dir)), "utf8")
          .replaceAll('"public".', `"${schema}".`)
          .replaceAll("public.", `"${schema}".`)
          .split("--> statement-breakpoint")
          .map((statement) => statement.trim())
          .filter((statement) => statement !== "");

      class Rollback extends Error {}
      try {
        await client.begin(async (tx) => {
          await tx.unsafe(`create schema "${schema}"`);
          await tx.unsafe(`set local search_path = "${schema}", public`);
          // The tables exactly as they were before this change.
          for (const file of ["0004_groups.sql", "0005_resources.sql"]) {
            for (const statement of statementsOf(file)) await tx.unsafe(statement);
          }
          const oldTable = await tx.unsafe<{ column_name: string }[]>(
            `select column_name from information_schema.columns where table_schema = '${schema}' and table_name = 'resources'`,
          );
          expect(oldTable.map((c) => c.column_name)).not.toContain("type_id");

          // Rows as the old code wrote them.
          const [{ id: groupId }] = await tx.unsafe<{ id: string }[]>(
            `insert into "${schema}".groups (name, join_mode, invite_token, invite_code)
             values ('Old group', 'link', $1, $2) returning id`,
            [`token-${randomUUID()}`, randomUUID().slice(0, 8).toUpperCase()],
          );
          const legacy = [
            ["pyq", "Maths", "ready"],
            ["notes", "", "ready"],
            ["other", "Physics", "ready"],
            ["assignment", "  Chemistry lab  ", "uploading"],
            ["study_material", 'ünï 😀 "q" \\', "ready"],
          ];
          const oldIds: string[] = [];
          for (const [type, subject, status] of legacy) {
            const [row] = await tx.unsafe<{ id: string }[]>(
              `insert into "${schema}".resources (group_id, title, subject, type, file_key, file_name, content_type, size_bytes, status)
               values ($1, $2, $3, $4, $5, 'a.pdf', 'application/pdf', 1, $6) returning id`,
              [groupId, `${type}|${subject}`, subject, type, `key-${randomUUID()}`, status],
            );
            oldIds.push(row.id);
          }

          const migrate = async () => {
            for (const statement of statementsOf("0007_form_config.sql")) await tx.unsafe(statement);
          };
          const readFiles = () =>
            tx.unsafe<{ type: string; subject: string; status: string; type_id: string; type_other: string; details: string }[]>(
              `select type, subject, status, type_id, type_other, details::text as details from "${schema}".resources order by title`,
            );
          const expectMigrated = async () => {
            const rows = await readFiles();
            expect(rows).toHaveLength(legacy.length);
            for (const row of rows) {
              // type_id is the old type; the Other text is empty; the old columns are as they were.
              expect(row.type_id).toBe(row.type);
              expect(row.type_other).toBe("");
              const expected = legacy.find(([type, subject]) => type === row.type && subject === row.subject);
              expect(expected, `a legacy row for ${row.type}`).toBeDefined();
              expect(row.status).toBe(expected?.[2]);
              // The subject became the detail with the id subject; no subject, no detail.
              expect(JSON.parse(row.details)).toEqual(row.subject === "" ? {} : { subject: row.subject });
            }
          };

          await migrate();
          await expectMigrated();

          // The group that existed before has the default configuration.
          const readConfig = async () => {
            const [row] = await tx.unsafe<{ form_config: string }[]>(
              `select form_config::text as form_config from "${schema}".groups where id = $1`,
              [groupId],
            );
            return JSON.parse(row.form_config);
          };
          expect(await readConfig()).toEqual(DEFAULT_FORM_CONFIG);

          // Old code, after the migration: a group with no form_config, files with only type and subject.
          const [made] = await tx.unsafe<{ form_config: string }[]>(
            `insert into "${schema}".groups (name, join_mode, invite_token, invite_code)
             values ('Old code group', 'link', $1, $2) returning form_config::text as form_config`,
            [`token-${randomUUID()}`, randomUUID().slice(0, 8).toUpperCase()],
          );
          expect(JSON.parse(made.form_config)).toEqual(DEFAULT_FORM_CONFIG);
          const [after] = await tx.unsafe<{ type_id: string; type_other: string; details: string }[]>(
            `insert into "${schema}".resources (group_id, title, subject, type, file_key, file_name, content_type, size_bytes)
             values ($1, 'after', 'Biology', 'notes', $2, 'a.pdf', 'application/pdf', 1)
             returning type_id, type_other, details::text as details`,
            [groupId, `key-${randomUUID()}`],
          );
          expect({ ...after, details: JSON.parse(after.details) }).toEqual({ type_id: "notes", type_other: "", details: { subject: "Biology" } });
          const [bare] = await tx.unsafe<{ type_id: string; details: string }[]>(
            `insert into "${schema}".resources (group_id, title, type, file_key, file_name, content_type, size_bytes)
             values ($1, 'bare', 'pyq', $2, 'a.pdf', 'application/pdf', 1) returning type_id, details::text as details`,
            [groupId, `key-${randomUUID()}`],
          );
          expect({ ...bare, details: JSON.parse(bare.details) }).toEqual({ type_id: "pyq", details: {} });

          // The old check is gone (new code writes other for a custom type, and any text is allowed in
          // `type`), the new checks are there, and type_id is NOT NULL.
          const checks = await tx.unsafe<{ conname: string }[]>(
            `select conname from pg_constraint where conrelid = '"${schema}".resources'::regclass and contype = 'c' order by conname`,
          );
          const names = checks.map((c) => c.conname);
          expect(names).not.toContain("resources_type_check");
          expect(names).toEqual(
            expect.arrayContaining([
              "resources_details_object_check",
              "resources_type_id_length_check",
              "resources_type_other_length_check",
              "resources_status_check",
              "resources_subject_length_check",
            ]),
          );
          const nullable = await tx.unsafe<{ column_name: string; is_nullable: string }[]>(
            `select column_name, is_nullable from information_schema.columns
             where table_schema = '${schema}' and table_name = 'resources'
               and column_name in ('type_id', 'type_other', 'details', 'type', 'subject')
             order by column_name`,
          );
          expect(nullable.map((c) => [c.column_name, c.is_nullable])).toEqual([
            ["details", "NO"],
            ["subject", "NO"],
            ["type", "NO"],
            ["type_id", "NO"],
            ["type_other", "NO"],
          ]);
          await expect(
            tx.savepoint((sp) => sp.unsafe(`update "${schema}".resources set type_id = null where id = $1`, [oldIds[0]])),
          ).rejects.toMatchObject({ code: "23502" });
          await expect(
            tx.savepoint((sp) => sp.unsafe(`update "${schema}".resources set type_other = $2 where id = $1`, [oldIds[0], "x".repeat(41)])),
          ).rejects.toMatchObject({ code: "23514", constraint_name: "resources_type_other_length_check" });
          await tx.unsafe(`update "${schema}".resources set type = 'video' where id = $1`, [oldIds[0]]);
          await tx.unsafe(`update "${schema}".resources set type = 'pyq' where id = $1`, [oldIds[0]]);

          // Running the whole migration again changes nothing and fails nothing.
          const before = await readFiles();
          await migrate();
          expect(await readFiles()).toEqual(before);
          expect(await readConfig()).toEqual(DEFAULT_FORM_CONFIG);

          throw new Rollback();
        });
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      }
      // Nothing is left behind.
      const left = await client<{ count: number }[]>`select count(*)::int as count from pg_namespace where nspname = ${schema}`;
      expect(left[0].count).toBe(0);
    }));
});
