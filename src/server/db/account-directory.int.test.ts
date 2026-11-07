import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, test } from "vitest";
import { createAccountDirectory } from "./account-directory";
import { testDatabaseUrl } from "./test-database-url";

// Runs against a real Postgres (Supabase, or the plain-Postgres stand-in in CI). Every test runs
// in a transaction that is rolled back, except the concurrency test, which needs committed rows
// and removes them in `finally`. Addresses are random and end in .invalid.
const url = testDatabaseUrl();

class Rollback extends Error {}

describe.skipIf(!url)("account directory", () => {
  const client = postgres(url ?? "postgres://unused", { max: 1, prepare: false, onnotice: () => {} });
  const db = drizzle(client);

  afterAll(async () => {
    await client.end();
  });

  type Executor = Pick<typeof db, "execute">;
  type Identity = { provider: "email" | "google"; verified?: boolean | null };

  /** Runs `fn` in a transaction that is always rolled back, so nothing persists. */
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

  const newAddress = () => `dir-${randomUUID()}@example.invalid`;

  async function createUser(
    tx: Executor,
    o: { email: string; confirmed: boolean; password?: string | null; identities?: Identity[] },
  ) {
    const id = randomUUID();
    await tx.execute(sql`
      insert into auth.users (id, email, encrypted_password, email_confirmed_at)
      values (${id}, ${o.email}, ${o.password ?? null}, ${o.confirmed ? sql`now()` : sql`null`})`);
    for (const identity of o.identities ?? []) {
      // verified: true or false is written as such; null leaves the field out.
      const data: Record<string, unknown> = { sub: id, email: o.email };
      if (identity.verified !== null) data.email_verified = identity.verified ?? false;
      await tx.execute(sql`
        insert into auth.identities (provider_id, user_id, provider, identity_data)
        values (${id}, ${id}, ${identity.provider}, ${JSON.stringify(data)}::jsonb)`);
    }
    return id;
  }

  async function userExists(tx: Executor, id: string) {
    const rows = await tx.execute<{ id: string }>(sql`select id from auth.users where id = ${id}`);
    return rows.length === 1;
  }

  async function identityProviders(tx: Executor, userId: string) {
    const rows = await tx.execute<{ provider: string; verified: string | null }>(sql`
      select provider, identity_data->>'email_verified' as verified
      from auth.identities where user_id = ${userId} order by provider`);
    return rows.map((r) => `${r.provider}:${r.verified}`);
  }

  describe("describeEmail", () => {
    test("says none for an address nobody signed up with", () =>
      rolledBack(async (tx) => {
        expect(await createAccountDirectory(tx).describeEmail(newAddress())).toEqual({ kind: "none" });
      }));

    test("says pending for an unconfirmed sign-up", () =>
      rolledBack(async (tx) => {
        const email = newAddress();
        const userId = await createUser(tx, {
          email,
          confirmed: false,
          password: "hash",
          identities: [{ provider: "email", verified: false }],
        });
        expect(await createAccountDirectory(tx).describeEmail(email)).toEqual({ kind: "pending", userId });
      }));

    test("says confirmed with the email provider and a password", () =>
      rolledBack(async (tx) => {
        const email = newAddress();
        const userId = await createUser(tx, {
          email,
          confirmed: true,
          password: "hash",
          identities: [{ provider: "email", verified: true }],
        });
        expect(await createAccountDirectory(tx).describeEmail(email)).toEqual({
          kind: "confirmed",
          userId,
          providers: ["email"],
          hasPassword: true,
        });
      }));

    test("says confirmed with only Google and no password (empty or missing)", () =>
      rolledBack(async (tx) => {
        const directory = createAccountDirectory(tx);
        for (const password of ["", null]) {
          const email = newAddress();
          const userId = await createUser(tx, {
            email,
            confirmed: true,
            password,
            identities: [{ provider: "google", verified: true }],
          });
          expect(await directory.describeEmail(email)).toEqual({
            kind: "confirmed",
            userId,
            providers: ["google"],
            hasPassword: false,
          });
        }
      }));

    test("lists both providers, sorted, for a Google user who also has an email identity and a password", () =>
      rolledBack(async (tx) => {
        const email = newAddress();
        const userId = await createUser(tx, {
          email,
          confirmed: true,
          password: "hash",
          identities: [
            { provider: "google", verified: true },
            { provider: "email", verified: true },
          ],
        });
        expect(await createAccountDirectory(tx).describeEmail(email)).toEqual({
          kind: "confirmed",
          userId,
          providers: ["email", "google"],
          hasPassword: true,
        });
      }));

    test("a confirmed account with no identities has no providers", () =>
      rolledBack(async (tx) => {
        const email = newAddress();
        const userId = await createUser(tx, { email, confirmed: true, password: "hash" });
        expect(await createAccountDirectory(tx).describeEmail(email)).toEqual({
          kind: "confirmed",
          userId,
          providers: [],
          hasPassword: true,
        });
      }));

    test("ignores case and surrounding spaces in the address", () =>
      rolledBack(async (tx) => {
        const email = newAddress();
        const userId = await createUser(tx, { email, confirmed: false, password: "hash" });
        const directory = createAccountDirectory(tx);
        expect(await directory.describeEmail(`  ${email.toUpperCase()} `)).toEqual({ kind: "pending", userId });
        expect(await directory.describeEmail(email.toUpperCase())).toEqual({ kind: "pending", userId });
      }));

    test("finds a stored address that has capital letters", () =>
      rolledBack(async (tx) => {
        const email = newAddress();
        const userId = await createUser(tx, { email: email.toUpperCase(), confirmed: false });
        expect(await createAccountDirectory(tx).describeEmail(email)).toEqual({ kind: "pending", userId });
      }));

    test("does not match a different address that only contains this one", () =>
      rolledBack(async (tx) => {
        const email = newAddress();
        await createUser(tx, { email: `x${email}`, confirmed: true });
        expect(await createAccountDirectory(tx).describeEmail(email)).toEqual({ kind: "none" });
      }));
  });

  describe("removePendingSignup", () => {
    test("deletes an unconfirmed user (and its identity) and returns true", () =>
      rolledBack(async (tx) => {
        const email = newAddress();
        const userId = await createUser(tx, {
          email,
          confirmed: false,
          password: "hash",
          identities: [{ provider: "email", verified: false }],
        });
        expect(await createAccountDirectory(tx).removePendingSignup(`  ${email.toUpperCase()}`)).toBe(true);
        expect(await userExists(tx, userId)).toBe(false);
        expect(await identityProviders(tx, userId)).toEqual([]);
      }));

    test("returns false and deletes nothing for a confirmed user", () =>
      rolledBack(async (tx) => {
        const email = newAddress();
        const userId = await createUser(tx, {
          email,
          confirmed: true,
          password: "hash",
          identities: [{ provider: "email", verified: true }],
        });
        expect(await createAccountDirectory(tx).removePendingSignup(email)).toBe(false);
        expect(await userExists(tx, userId)).toBe(true);
        expect(await identityProviders(tx, userId)).toEqual(["email:true"]);
      }));

    test("returns false for an address nobody signed up with", () =>
      rolledBack(async (tx) => {
        expect(await createAccountDirectory(tx).removePendingSignup(newAddress())).toBe(false);
      }));

    test("two simultaneous calls delete exactly once", async () => {
      const email = newAddress();
      const clientA = postgres(url as string, { max: 1, prepare: false, onnotice: () => {} });
      const clientB = postgres(url as string, { max: 1, prepare: false, onnotice: () => {} });
      try {
        // Committed on purpose: the two connections must see the same row.
        const userId = await createUser(db, {
          email,
          confirmed: false,
          password: "hash",
          identities: [{ provider: "email", verified: false }],
        });
        const results = await Promise.all([
          createAccountDirectory(drizzle(clientA)).removePendingSignup(email),
          createAccountDirectory(drizzle(clientB)).removePendingSignup(email),
        ]);
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(await userExists(db, userId)).toBe(false);
      } finally {
        await db.execute(sql`delete from auth.users where email = ${email}`);
        await clientA.end();
        await clientB.end();
      }
    });
  });

  describe("repairAfterGoogle", () => {
    test("removes an unverified email identity and reports it", () =>
      rolledBack(async (tx) => {
        const userId = await createUser(tx, {
          email: newAddress(),
          confirmed: true,
          identities: [
            { provider: "email", verified: false },
            { provider: "google", verified: true },
          ],
        });
        expect(await createAccountDirectory(tx).repairAfterGoogle(userId)).toEqual({ hadPendingEmailSignup: true });
        expect(await identityProviders(tx, userId)).toEqual(["google:true"]);
        expect(await userExists(tx, userId)).toBe(true);
      }));

    test("treats an email identity with no email_verified field as unverified", () =>
      rolledBack(async (tx) => {
        const userId = await createUser(tx, {
          email: newAddress(),
          confirmed: true,
          identities: [{ provider: "email", verified: null }],
        });
        expect(await createAccountDirectory(tx).repairAfterGoogle(userId)).toEqual({ hadPendingEmailSignup: true });
        expect(await identityProviders(tx, userId)).toEqual([]);
      }));

    test("reports false when there is no email identity", () =>
      rolledBack(async (tx) => {
        const userId = await createUser(tx, {
          email: newAddress(),
          confirmed: true,
          identities: [{ provider: "google", verified: true }],
        });
        expect(await createAccountDirectory(tx).repairAfterGoogle(userId)).toEqual({ hadPendingEmailSignup: false });
        expect(await identityProviders(tx, userId)).toEqual(["google:true"]);
      }));

    test("never touches a verified email identity", () =>
      rolledBack(async (tx) => {
        const userId = await createUser(tx, {
          email: newAddress(),
          confirmed: true,
          identities: [
            { provider: "email", verified: true },
            { provider: "google", verified: true },
          ],
        });
        expect(await createAccountDirectory(tx).repairAfterGoogle(userId)).toEqual({ hadPendingEmailSignup: false });
        expect(await identityProviders(tx, userId)).toEqual(["email:true", "google:true"]);
      }));

    test("never touches a Google identity, even one marked unverified, or another user's identity", () =>
      rolledBack(async (tx) => {
        const userId = await createUser(tx, {
          email: newAddress(),
          confirmed: true,
          identities: [{ provider: "google", verified: false }],
        });
        const otherId = await createUser(tx, {
          email: newAddress(),
          confirmed: false,
          identities: [{ provider: "email", verified: false }],
        });
        expect(await createAccountDirectory(tx).repairAfterGoogle(userId)).toEqual({ hadPendingEmailSignup: false });
        expect(await identityProviders(tx, userId)).toEqual(["google:false"]);
        expect(await identityProviders(tx, otherId)).toEqual(["email:false"]);
      }));
  });
});
