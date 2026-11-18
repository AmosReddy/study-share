import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
  Reads migration 0008 as text (no database is touched) and checks what must hold for it to be safe
  to apply to a live database before the code that uses it is merged: it only ADDS three new
  tables, indexes and constraints on them, and never changes, drops or rewrites anything that
  exists (the group chat's `messages` table included). The real behaviour is tested against
  Postgres by direct-chat-store.int.test.ts.
*/
const root = new URL("../../../drizzle/", import.meta.url);
const read = (name: string) => readFileSync(fileURLToPath(new URL(name, root)), "utf8");
const migration = read("0008_direct_chats.sql");
const statements = migration
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter((s) => s !== "");

const NEW_TABLES = ["direct_chats", "direct_messages", "direct_reads"];

describe("migration 0008_direct_chats", () => {
  it("only adds: every statement creates or alters one of the three new tables, or indexes one", () => {
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      const create = /^CREATE TABLE "(\w+)" \(/.exec(statement);
      const alter = /^ALTER TABLE "(\w+)" (ENABLE ROW LEVEL SECURITY|ADD CONSTRAINT)/.exec(statement);
      const index = /^CREATE INDEX "(\w+)" ON "(\w+)" USING btree/.exec(statement);
      const table = create?.[1] ?? alter?.[1] ?? index?.[2];
      expect(table, `unexpected statement: ${statement.slice(0, 80)}`).toBeDefined();
      expect(NEW_TABLES, `touches an existing table: ${statement.slice(0, 80)}`).toContain(table);
    }
  });

  it("never drops, deletes, updates, truncates, renames or rewrites anything", () => {
    // "ON DELETE cascade" and "ON UPDATE no action" on the new foreign keys are the only DELETE and UPDATE.
    const withoutReferentialActions = migration.replace(/ ON (DELETE|UPDATE) (cascade|set null|no action)/g, "");
    expect(withoutReferentialActions).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|RENAME|INSERT|GRANT|REVOKE|DISABLE)\b/i);
    expect(migration).not.toMatch(/ALTER TABLE "(groups|group_members|messages|resources|profiles|rate_limits)"/);
    expect(migration).not.toMatch(/\bTYPE\b|\bTRIGGER\b|\bFUNCTION\b|\bPOLICY\b/i);
  });

  it("turns Row Level Security on for every new table and adds no policy", () => {
    for (const table of NEW_TABLES) expect(migration).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    expect(migration).not.toMatch(/CREATE POLICY/i);
  });

  it("creates the tables before anything refers to them", () => {
    const firstAlterOrIndex = statements.findIndex((s) => !s.startsWith("CREATE TABLE"));
    const lastCreate = statements.map((s) => s.startsWith("CREATE TABLE")).lastIndexOf(true);
    // Each table's RLS statement follows its own CREATE; every foreign key and index comes after all three.
    for (const [i, statement] of statements.entries()) {
      if (/ADD CONSTRAINT|CREATE INDEX/.test(statement)) expect(i).toBeGreaterThan(lastCreate);
    }
    expect(firstAlterOrIndex).toBeGreaterThan(0);
  });

  it("links every participant to an account with on delete cascade, and the chats to their group and chat with cascade", () => {
    const link = (table: string, name: string, column: string, target: string) =>
      `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}") REFERENCES ${target} ON DELETE cascade ON UPDATE no action;`;
    const users = '"auth"."users"("id")';
    expect(migration).toContain(link("direct_chats", "direct_chats_user_low_users_id_fk", "user_low", users));
    expect(migration).toContain(link("direct_chats", "direct_chats_user_high_users_id_fk", "user_high", users));
    expect(migration).toContain(link("direct_chats", "direct_chats_group_id_groups_id_fk", "group_id", '"public"."groups"("id")'));
    expect(migration).toContain(link("direct_messages", "direct_messages_chat_id_direct_chats_id_fk", "chat_id", '"public"."direct_chats"("id")'));
    expect(migration).toContain(link("direct_reads", "direct_reads_chat_id_direct_chats_id_fk", "chat_id", '"public"."direct_chats"("id")'));
    expect(migration).toContain(link("direct_reads", "direct_reads_user_id_users_id_fk", "user_id", users));
    // Like the group chat: a message outlives its sender's account (and the chat cannot, so this is only a safety net).
    expect(migration).toContain(
      'ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;',
    );
  });

  it("has the rules the store depends on: pair order, one chat per pair, one message per client id, the body length", () => {
    expect(migration).toContain('CONSTRAINT "direct_chats_pair_order_check" CHECK (user_low < user_high)');
    expect(migration).toContain('CONSTRAINT "direct_chats_pair_unique" UNIQUE("group_id","user_low","user_high")');
    expect(migration).toContain('CONSTRAINT "direct_messages_chat_client_unique" UNIQUE("chat_id","client_id")');
    expect(migration).toContain('CONSTRAINT "direct_messages_body_length_check" CHECK (char_length(btrim(body)) between 1 and 2000)');
    expect(migration).toContain('PRIMARY KEY("chat_id","user_id")');
    expect(migration).toContain('CREATE INDEX "direct_messages_chat_created_idx" ON "direct_messages" USING btree ("chat_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST)');
    expect(migration).toContain('USING btree ("group_id","user_low")');
    expect(migration).toContain('USING btree ("group_id","user_high")');
  });

  it("is the next migration in the journal, on top of 0007", () => {
    const journal = JSON.parse(read("meta/_journal.json")) as { entries: { idx: number; tag: string }[] };
    expect(journal.entries.map((e) => e.tag).slice(-2)).toEqual(["0007_form_config", "0008_direct_chats"]);
    expect(journal.entries.map((e) => e.idx)).toEqual(journal.entries.map((_, i) => i));
    const snapshot = JSON.parse(read("meta/0008_snapshot.json")) as { id: string; prevId: string };
    const previous = JSON.parse(read("meta/0007_snapshot.json")) as { id: string };
    expect(snapshot.prevId).toBe(previous.id);
  });
});
