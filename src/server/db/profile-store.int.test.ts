import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, test } from "vitest";
import { createProfileStore } from "./profile-store";
import { testDatabaseUrl } from "./test-database-url";

// Runs against a real Postgres (Supabase dev, or the plain-Postgres stand-in in CI). Every test
// runs in a transaction that is rolled back, so nothing persists. Addresses end in .invalid.
const url = testDatabaseUrl();

class Rollback extends Error {}

describe.skipIf(!url)("profile store", () => {
  const client = postgres(url ?? "postgres://unused", { max: 1, prepare: false, onnotice: () => {} });
  const db = drizzle(client);

  afterAll(async () => {
    await client.end();
  });

  type Executor = Pick<typeof db, "execute">;

  async function rolledBack(fn: (tx: Executor) => Promise<void>) {
    try {
      await db.transaction(async (tx) => {
        await fn(tx);
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  }

  /** A user whose sign-up metadata accepted `terms` (the trigger stamps the profile once, at insert). */
  async function createUser(tx: Executor, terms: string | null) {
    const id = randomUUID();
    const meta = terms === null ? {} : { display_name: "Someone", terms_version: terms };
    await tx.execute(sql`
      insert into auth.users (id, email, raw_user_meta_data)
      values (${id}, ${`profile-${id}@example.invalid`}, ${JSON.stringify(meta)}::jsonb)`);
    return id;
  }

  async function terms(tx: Executor, id: string) {
    const rows = await tx.execute<{
      terms_version: string | null;
      accepted_now: boolean | null;
      age_now: boolean | null;
      accepted_null: boolean;
      age_null: boolean;
    }>(sql`
      select terms_version,
        terms_accepted_at = now() as accepted_now,
        age_confirmed_at = now() as age_now,
        terms_accepted_at is null as accepted_null,
        age_confirmed_at is null as age_null
      from public.profiles where id = ${id}`);
    return rows[0];
  }

  test("records the version and stamps both times with the database's clock, replacing someone else's earlier acceptance", () =>
    rolledBack(async (tx) => {
      const id = await createUser(tx, "1999-01-01");
      // The stranger's sign-up was accepted at another time.
      await tx.execute(sql`
        update public.profiles set terms_accepted_at = '2020-01-01Z', age_confirmed_at = '2020-01-01Z' where id = ${id}`);
      expect(await createProfileStore(tx).recordTermsAcceptance(id, "2026-11-06")).toBe(true);
      expect(await terms(tx, id)).toMatchObject({ terms_version: "2026-11-06", accepted_now: true, age_now: true });
    }));

  test("records an acceptance on a profile that had none", () =>
    rolledBack(async (tx) => {
      const id = await createUser(tx, null);
      expect(await terms(tx, id)).toMatchObject({ terms_version: null, accepted_null: true, age_null: true });
      expect(await createProfileStore(tx).recordTermsAcceptance(id, "2026-11-06")).toBe(true);
      expect(await terms(tx, id)).toMatchObject({ terms_version: "2026-11-06", accepted_now: true, age_now: true });
    }));

  test("clears all three fields", () =>
    rolledBack(async (tx) => {
      const id = await createUser(tx, "2026-11-06");
      expect(await createProfileStore(tx).clearTermsAcceptance(id)).toBe(true);
      expect(await terms(tx, id)).toMatchObject({ terms_version: null, accepted_null: true, age_null: true });
    }));

  test("touches only the one profile", () =>
    rolledBack(async (tx) => {
      const mine = await createUser(tx, null);
      const other = await createUser(tx, "1999-01-01");
      await createProfileStore(tx).recordTermsAcceptance(mine, "2026-11-06");
      expect((await terms(tx, other))?.terms_version).toBe("1999-01-01");
      await createProfileStore(tx).clearTermsAcceptance(mine);
      expect((await terms(tx, other))?.terms_version).toBe("1999-01-01");
    }));

  test("an unknown user changes nothing and answers false", () =>
    rolledBack(async (tx) => {
      const profiles = createProfileStore(tx);
      expect(await profiles.recordTermsAcceptance(randomUUID(), "2026-11-06")).toBe(false);
      expect(await profiles.clearTermsAcceptance(randomUUID())).toBe(false);
    }));

  test("the version is passed as data, never as SQL", () =>
    rolledBack(async (tx) => {
      const id = await createUser(tx, null);
      const sneaky = "v1'; delete from public.profiles; --";
      expect(await createProfileStore(tx).recordTermsAcceptance(id, sneaky)).toBe(true);
      expect((await terms(tx, id))?.terms_version).toBe(sneaky);
    }));

  test("a later sign-in metadata change does not undo the app's record (the trigger only fills empty fields)", () =>
    rolledBack(async (tx) => {
      const id = await createUser(tx, "1999-01-01");
      await createProfileStore(tx).recordTermsAcceptance(id, "2026-11-06");
      await tx.execute(sql`
        update auth.users set raw_user_meta_data = ${JSON.stringify({ terms_version: "1999-01-01" })}::jsonb where id = ${id}`);
      expect((await terms(tx, id))?.terms_version).toBe("2026-11-06");
    }));

  test("the connection may update profiles despite Row Level Security: it owns the table or bypasses RLS", () =>
    rolledBack(async (tx) => {
      const rows = await tx.execute<{ rls: boolean; forced: boolean; owner: boolean; bypass: boolean; can_update: boolean }>(sql`
        select c.relrowsecurity as rls,
          c.relforcerowsecurity as forced,
          pg_has_role(current_user, c.relowner, 'USAGE') as owner,
          r.rolbypassrls or r.rolsuper as bypass,
          has_table_privilege(current_user, 'public.profiles', 'UPDATE') as can_update
        from pg_class c, pg_roles r
        where c.oid = 'public.profiles'::regclass and r.rolname = current_user`);
      const row = rows[0];
      // RLS is on (no public access), and this role still writes: as the owner or a role that bypasses it.
      expect(row.rls).toBe(true);
      expect(row.can_update).toBe(true);
      // Owners skip RLS unless it is forced on the table.
      expect(row.bypass || (row.owner && !row.forced)).toBe(true);
    }));
});
