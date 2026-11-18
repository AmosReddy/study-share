import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_FORM_CONFIG, parseFormConfig } from "@/shared/form-config";
import { groups } from "./schema";

/*
  Reads migration 0007 as text (no database is touched) and checks the parts that must not drift:
  the column default must be the default configuration, and the statements must come in an order
  that is safe on a database that already has data. The real behaviour is tested against Postgres
  by resource-store.int.test.ts.
*/
const root = new URL("../../../drizzle/", import.meta.url);
const migration = readFileSync(fileURLToPath(new URL("0007_form_config.sql", root)), "utf8");
const statements = migration.split("--> statement-breakpoint").map((s) => s.trim());

/** Index of the first statement that contains the text; fails the test when there is none. */
function at(text: string): number {
  const index = statements.findIndex((s) => s.includes(text));
  expect(index, `no statement contains: ${text}`).toBeGreaterThanOrEqual(0);
  return index;
}

describe("migration 0007_form_config", () => {
  it("gives groups.form_config a column default equal to DEFAULT_FORM_CONFIG", () => {
    const match = /ADD COLUMN IF NOT EXISTS "form_config" jsonb DEFAULT '(.+?)'::jsonb NOT NULL/.exec(migration);
    expect(match, "the form_config column with its default").not.toBeNull();
    const json = match?.[1] ?? "";
    expect(JSON.parse(json)).toStrictEqual(JSON.parse(JSON.stringify(DEFAULT_FORM_CONFIG)));
    // The same text, not just the same value, so what the database stores is what the app writes.
    expect(json).toBe(JSON.stringify(DEFAULT_FORM_CONFIG));
    // And it is a configuration the app accepts as it is (not the fallback for a damaged one).
    expect(parseFormConfig(JSON.parse(json))).toEqual(DEFAULT_FORM_CONFIG);
  });

  it("matches the default in schema.ts, so drizzle-kit sees no difference", () => {
    expect(groups.formConfig.default).toEqual(DEFAULT_FORM_CONFIG);
    expect(groups.formConfig.notNull).toBe(true);
  });

  it("adds the columns, then backfills, and only then sets type_id NOT NULL", () => {
    const addTypeId = at('ADD COLUMN IF NOT EXISTS "type_id" text;');
    const backfillType = at('SET "type_id" = "type" WHERE "type_id" IS NULL');
    const backfillDetails = at("jsonb_build_object('subject', \"subject\")");
    const notNull = at('ALTER COLUMN "type_id" SET NOT NULL');
    expect(addTypeId).toBeLessThan(backfillType);
    expect(backfillType).toBeLessThan(notNull);
    expect(backfillDetails).toBeLessThan(notNull);
    // type_id is added without NOT NULL: a NOT NULL column with no default cannot be added to a table with rows.
    expect(statements[addTypeId]).not.toMatch(/NOT NULL/);
  });

  it("only backfills rows that need it, so a second run changes nothing", () => {
    expect(statements[at('SET "type_id" = "type"')]).toMatch(/WHERE "type_id" IS NULL/);
    expect(statements[at("jsonb_build_object('subject', \"subject\")")]).toMatch(/WHERE "subject" <> '' AND "details" = '\{\}'::jsonb/);
  });

  it("creates the before-insert rule before the backfill, so no insert can slip in between", () => {
    const trigger = at("CREATE TRIGGER");
    expect(statements[trigger]).toMatch(/BEFORE INSERT ON "resources" FOR EACH ROW/);
    expect(trigger).toBeLessThan(at('SET "type_id" = "type"'));
    expect(trigger).toBeGreaterThan(at('ADD COLUMN IF NOT EXISTS "details"'));
    const fn = statements[at("CREATE OR REPLACE FUNCTION public.resources_fill_answers()")];
    expect(fn).toMatch(/new\.type_id IS NULL/);
    expect(fn).toMatch(/new\.type_id := new\.type/);
    expect(fn).toMatch(/new\.details = '\{\}'::jsonb AND new\.subject <> ''/);
    expect(fn).toMatch(/jsonb_build_object\('subject', new\.subject\)/);
  });

  it("drops the old type check without a replacement, and adds the new checks", () => {
    expect(statements[at('DROP CONSTRAINT IF EXISTS "resources_type_check"')]).not.toMatch(/ADD CONSTRAINT/);
    expect(migration).not.toMatch(/ADD CONSTRAINT "resources_type_check"/);
    expect(migration).toMatch(/ADD CONSTRAINT "resources_type_other_length_check" CHECK \(char_length\(type_other\) <= 40\)/);
    expect(migration).toMatch(/ADD CONSTRAINT "resources_type_id_length_check" CHECK \(char_length\(type_id\) between 1 and 64\)/);
    expect(migration).toMatch(/ADD CONSTRAINT "resources_details_object_check" CHECK \(jsonb_typeof\(details\) = 'object'\)/);
  });

  it("keeps the old type and subject columns and deletes no data", () => {
    expect(migration).not.toMatch(/DROP COLUMN/i);
    expect(migration).not.toMatch(/ALTER COLUMN "(type|subject)"/);
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  });

  it("is in the journal after 0006 (entry 7), and the snapshot has the new columns", () => {
    const journal = JSON.parse(readFileSync(fileURLToPath(new URL("meta/_journal.json", root)), "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    expect(journal.entries[7]).toMatchObject({ idx: 7, tag: "0007_form_config" });
    const snapshot = JSON.parse(readFileSync(fileURLToPath(new URL("meta/0007_snapshot.json", root)), "utf8")) as {
      tables: Record<string, { columns: Record<string, { notNull: boolean }> }>;
    };
    expect(snapshot.tables["public.groups"].columns.form_config.notNull).toBe(true);
    expect(snapshot.tables["public.resources"].columns.type_id.notNull).toBe(true);
    expect(Object.keys(snapshot.tables["public.resources"].columns)).toEqual(expect.arrayContaining(["type", "subject", "type_other", "details"]));
  });
});
