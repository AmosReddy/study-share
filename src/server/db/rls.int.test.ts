import postgres from "postgres";
import { afterAll, describe, expect, test } from "vitest";

// Runs against a real Postgres. Locally it is skipped unless TEST_DATABASE_URL
// is set. In CI it must never be skipped, so a missing URL fails loudly.
const url = process.env.TEST_DATABASE_URL;
if (!url && process.env.CI) {
  throw new Error("TEST_DATABASE_URL must be set in CI");
}

describe.skipIf(!url)("database", () => {
  const sql = postgres(url ?? "postgres://unused", { max: 1 });
  afterAll(() => sql.end());

  test("every table in public has Row Level Security enabled", async () => {
    const rows = await sql`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  test("the profiles table exists", async () => {
    const [row] = await sql`select to_regclass('public.profiles')::text as t`;
    expect(row.t).toBe("profiles");
  });
});
