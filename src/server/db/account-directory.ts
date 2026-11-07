import "server-only";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { AccountDirectory, EmailAccountState } from "@/server/ports/account-directory";

/** Only `execute` is used, so a transaction works as well as the database (tests roll one back). */
type Executor = Pick<PostgresJsDatabase, "execute">;

/**
 * Reads and removes accounts with SQL on Supabase's auth schema (auth.users, auth.identities),
 * over the existing database connection. The Admin API has no lookup by email and no
 * conditional delete.
 *
 * Observed on a real Supabase project: an unconfirmed email sign-up has email_confirmed_at null
 * and an `email` identity whose identity_data.email_verified is false (true once the code is
 * confirmed); a Google user has a `google` identity and an empty encrypted_password; deleting an
 * auth.users row deletes its identities (and, through our trigger's foreign key, its profile).
 */
export function createAccountDirectory(db: Executor): AccountDirectory {
  return {
    async describeEmail(email) {
      const rows = await db.execute<{
        id: string;
        confirmed: boolean;
        has_password: boolean;
        has_email: boolean;
        has_google: boolean;
      }>(sql`
        select
          u.id,
          u.email_confirmed_at is not null as confirmed,
          coalesce(u.encrypted_password, '') <> '' as has_password,
          exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email') as has_email,
          exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'google') as has_google
        from auth.users u
        where lower(u.email) = lower(${email.trim()})
        order by (u.email_confirmed_at is not null) desc
        limit 1`);
      const row = rows[0];
      if (!row) return { kind: "none" } satisfies EmailAccountState;
      if (!row.confirmed) return { kind: "pending", userId: row.id };
      const providers: ("email" | "google")[] = [];
      if (row.has_email) providers.push("email");
      if (row.has_google) providers.push("google");
      return { kind: "confirmed", userId: row.id, providers, hasPassword: row.has_password };
    },

    async removePendingSignup(email) {
      // One conditional statement, so an account confirmed a moment ago is never deleted, and
      // of two simultaneous calls the second finds the row already gone.
      const rows = await db.execute(sql`
        delete from auth.users
        where lower(email) = lower(${email.trim()}) and email_confirmed_at is null
        returning id`);
      return rows.length > 0;
    },

    async repairAfterGoogle(userId) {
      // Only an unverified email identity (email_verified false or missing). A verified email
      // identity and any Google identity stay.
      const rows = await db.execute(sql`
        delete from auth.identities
        where user_id = ${userId}
          and provider = 'email'
          and coalesce(identity_data->>'email_verified', 'false') <> 'true'
        returning id`);
      return { hadPendingEmailSignup: rows.length > 0 };
    },
  };
}
