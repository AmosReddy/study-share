import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, test } from "vitest";
import { runRateLimiterContract } from "@/server/adapters/rate-limiter.contract";
import { createPostgresRateLimiter } from "./postgres-rate-limiter";
import * as schema from "./schema";
import { testDatabaseUrl } from "./test-database-url";

// Runs against a real Postgres. Locally it is skipped unless TEST_DATABASE_URL is set; in CI
// a missing URL fails loudly, and a production URL is always refused.
const url = testDatabaseUrl();

class Rollback extends Error {}

describe.skipIf(!url)("accounts database", () => {
  const sql = postgres(url ?? "postgres://unused", { max: 1, onnotice: () => {} });
  const limiterSql = postgres(url ?? "postgres://unused", { max: 10, prepare: false, onnotice: () => {} });
  const limiterDb = drizzle(limiterSql, { schema });
  const usedPrefixes: string[] = [];

  afterAll(async () => {
    for (const prefix of usedPrefixes) {
      await sql`delete from public.rate_limits where key like ${prefix + "%"}`;
    }
    await sql.end();
    await limiterSql.end();
  });

  type Tx = postgres.TransactionSql;

  /** Runs `fn` in a transaction that is always rolled back, so nothing persists. */
  async function rolledBack(fn: (tx: Tx) => Promise<void>) {
    try {
      await sql.begin(async (tx) => {
        await fn(tx);
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  }

  async function createUser(tx: Tx, email: string | null, meta: Record<string, unknown> | null) {
    const id = randomUUID();
    if (meta === null) {
      await tx`insert into auth.users (id, email) values (${id}, ${email})`;
    } else {
      await tx`insert into auth.users (id, email, raw_user_meta_data) values (${id}, ${email}, ${tx.json(meta as never)})`;
    }
    return id;
  }

  async function profileOf(tx: Tx, id: string) {
    const rows = await tx`select * from public.profiles where id = ${id}`;
    return rows[0];
  }

  describe("profile trigger", () => {
    test("names the profile from full_name for a Google-style sign-up", () =>
      rolledBack(async (tx) => {
        const id = await createUser(tx, "someone@example.com", { full_name: "Asha Rao", name: "Other" });
        expect((await profileOf(tx, id)).display_name).toBe("Asha Rao");
      }));

    test("prefers display_name over full_name", () =>
      rolledBack(async (tx) => {
        const id = await createUser(tx, "someone@example.com", { display_name: "Ash", full_name: "Asha Rao" });
        expect((await profileOf(tx, id)).display_name).toBe("Ash");
      }));

    test("falls back to name when there is no full_name", () =>
      rolledBack(async (tx) => {
        const id = await createUser(tx, "someone@example.com", { name: "Ravi" });
        expect((await profileOf(tx, id)).display_name).toBe("Ravi");
      }));

    test("names the profile from the email prefix when metadata has no name", () =>
      rolledBack(async (tx) => {
        const id = await createUser(tx, "student.one@example.com", null);
        expect((await profileOf(tx, id)).display_name).toBe("student.one");
      }));

    test("trims the name to 50 characters", () =>
      rolledBack(async (tx) => {
        const id = await createUser(tx, "a@example.com", { display_name: "x".repeat(80) });
        expect((await profileOf(tx, id)).display_name).toBe("x".repeat(50));
      }));

    test("leaves the terms fields empty when no terms_version is given", () =>
      rolledBack(async (tx) => {
        const p = await profileOf(tx, await createUser(tx, "a@example.com", {}));
        expect(p.terms_version).toBeNull();
        expect(p.terms_accepted_at).toBeNull();
        expect(p.age_confirmed_at).toBeNull();
      }));

    test("sets the terms fields from terms_version and ignores timestamps in metadata", () =>
      rolledBack(async (tx) => {
        const id = await createUser(tx, "a@example.com", {
          terms_version: "2026-11-01",
          terms_accepted_at: "1999-01-01T00:00:00Z",
          age_confirmed_at: "1999-01-01T00:00:00Z",
        });
        const [{ ok }] = await tx`
          select (terms_version = '2026-11-01'
            and terms_accepted_at = now()
            and age_confirmed_at = now()) as ok
          from public.profiles where id = ${id}`;
        expect(ok).toBe(true);
      }));

    test("does not overwrite the terms fields on a later metadata update", () =>
      rolledBack(async (tx) => {
        const id = await createUser(tx, "a@example.com", { terms_version: "v1" });
        await tx`update public.profiles set terms_accepted_at = '2020-01-01Z', age_confirmed_at = '2020-01-01Z' where id = ${id}`;
        await tx`update auth.users set raw_user_meta_data = ${tx.json({ terms_version: "v2" })} where id = ${id}`;
        const [row] = await tx`
          select terms_version,
            terms_accepted_at = '2020-01-01Z' as terms_kept,
            age_confirmed_at = '2020-01-01Z' as age_kept
          from public.profiles where id = ${id}`;
        expect(row).toEqual({ terms_version: "v1", terms_kept: true, age_kept: true });
      }));

    test("sets the terms fields when terms_version first appears in a later update", () =>
      rolledBack(async (tx) => {
        const id = await createUser(tx, "a@example.com", {});
        await tx`update auth.users set raw_user_meta_data = ${tx.json({ terms_version: "v1" })} where id = ${id}`;
        const [{ ok }] = await tx`
          select (terms_version = 'v1' and terms_accepted_at = now() and age_confirmed_at = now()) as ok
          from public.profiles where id = ${id}`;
        expect(ok).toBe(true);
      }));

    test("changes display_name when a display_name update arrives", () =>
      rolledBack(async (tx) => {
        const id = await createUser(tx, "a@example.com", { display_name: "Old" });
        await tx`update auth.users set raw_user_meta_data = ${tx.json({ display_name: "New" })} where id = ${id}`;
        expect((await profileOf(tx, id)).display_name).toBe("New");
      }));

    test("keeps display_name when an update carries no display_name", () =>
      rolledBack(async (tx) => {
        const id = await createUser(tx, "a@example.com", { display_name: "Keep" });
        await tx`update auth.users set raw_user_meta_data = ${tx.json({ other: 1 })} where id = ${id}`;
        expect((await profileOf(tx, id)).display_name).toBe("Keep");
      }));

    test("deleting the auth user deletes the profile", () =>
      rolledBack(async (tx) => {
        const id = await createUser(tx, "a@example.com", {});
        expect(await profileOf(tx, id)).toBeDefined();
        await tx`delete from auth.users where id = ${id}`;
        expect(await profileOf(tx, id)).toBeUndefined();
      }));

    // Metadata is user-writable, so only string values count. Anything else is absent.
    const nonStrings: [string, unknown][] = [
      ["false", false],
      ["0", 0],
      ["an object", {}],
      ["an array", []],
      ["null", null],
    ];

    test.each(nonStrings)("a non-string terms_version (%s) does not stamp terms or age", (_label, value) =>
      rolledBack(async (tx) => {
        const p = await profileOf(tx, await createUser(tx, "a@example.com", { terms_version: value }));
        expect(p.terms_version).toBeNull();
        expect(p.terms_accepted_at).toBeNull();
        expect(p.age_confirmed_at).toBeNull();
      }));

    test.each(nonStrings)("a non-string terms_version (%s) in a later update does not stamp terms or age", (_label, value) =>
      rolledBack(async (tx) => {
        const id = await createUser(tx, "a@example.com", {});
        await tx`update auth.users set raw_user_meta_data = ${tx.json({ terms_version: value } as never)} where id = ${id}`;
        const p = await profileOf(tx, id);
        expect(p.terms_version).toBeNull();
        expect(p.terms_accepted_at).toBeNull();
        expect(p.age_confirmed_at).toBeNull();
      }));

    test("a terms_version that is blank after trimming does not stamp terms or age", () =>
      rolledBack(async (tx) => {
        const p = await profileOf(tx, await createUser(tx, "a@example.com", { terms_version: "   " }));
        expect(p.terms_version).toBeNull();
        expect(p.terms_accepted_at).toBeNull();
        expect(p.age_confirmed_at).toBeNull();
      }));

    test("an over-long terms_version is stored truncated to 64 characters", () =>
      rolledBack(async (tx) => {
        const p = await profileOf(tx, await createUser(tx, "a@example.com", { terms_version: "v".repeat(500) }));
        expect(p.terms_version).toBe("v".repeat(64));
        expect(p.terms_accepted_at).not.toBeNull();
      }));

    test.each(nonStrings)("a non-string display_name (%s) falls through to full_name", (_label, value) =>
      rolledBack(async (tx) => {
        const id = await createUser(tx, "a@example.com", { display_name: value, full_name: "Asha Rao" });
        expect((await profileOf(tx, id)).display_name).toBe("Asha Rao");
      }));

    test.each(nonStrings)("a non-string full_name (%s) falls through to name", (_label, value) =>
      rolledBack(async (tx) => {
        const id = await createUser(tx, "a@example.com", { full_name: value, name: "Ravi" });
        expect((await profileOf(tx, id)).display_name).toBe("Ravi");
      }));

    test("non-string name sources fall through to the email prefix, then to 'New user'", () =>
      rolledBack(async (tx) => {
        const junk = { display_name: {}, full_name: [], name: false };
        expect((await profileOf(tx, await createUser(tx, "pre.fix@example.com", junk))).display_name).toBe("pre.fix");
        expect((await profileOf(tx, await createUser(tx, null, junk))).display_name).toBe("New user");
      }));

    test("a non-string display_name in a later update keeps the current name", () =>
      rolledBack(async (tx) => {
        const id = await createUser(tx, "a@example.com", { display_name: "Keep" });
        await tx`update auth.users set raw_user_meta_data = ${tx.json({ display_name: { a: 1 } })} where id = ${id}`;
        expect((await profileOf(tx, id)).display_name).toBe("Keep");
      }));

    test("the trigger function is security definer with a fixed search_path", async () => {
      const [row] = await sql`
        select p.prosecdef, p.proconfig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'handle_auth_user_change'`;
      expect(row.prosecdef).toBe(true);
      expect(row.proconfig).toEqual(expect.arrayContaining([expect.stringMatching(/^search_path=/)]));
    });
  });

  describe("Postgres rate limiter", () => {
    // Every limiter made by the contract gets its own key prefix, so tests do not
    // see each other's rows (the contract reuses key names and a fixed clock).
    function make(now?: () => number) {
      const prefix = `test-${randomUUID()}:`;
      usedPrefixes.push(prefix);
      const inner = createPostgresRateLimiter(limiterDb, now);
      return { prefix, hit: (i: { key: string; limit: number; windowSeconds: number }) => inner.hit({ ...i, key: prefix + i.key }) };
    }

    runRateLimiterContract((now) => make(now));

    test("rate_limits has Row Level Security on", async () => {
      const [row] = await sql`
        select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'rate_limits'`;
      expect(row.relrowsecurity).toBe(true);
    });

    test("20 parallel hits with a limit of 5 allow exactly 5", async () => {
      const limiter = make();
      const results = await Promise.all(
        Array.from({ length: 20 }, () => limiter.hit({ key: "burst", limit: 5, windowSeconds: 60 })),
      );
      expect(results.filter((r) => r.allowed)).toHaveLength(5);
      expect(results.filter((r) => !r.allowed)).toHaveLength(15);
    });
  });
});
