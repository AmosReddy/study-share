import "server-only";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { ProfileStore } from "@/server/ports/profile-store";

/** Only `execute` is used, so a transaction works as well as the database (tests roll one back). */
type Executor = Pick<PostgresJsDatabase, "execute">;

/**
 * The terms fields of public.profiles, written by the app over its own database connection.
 * The profile trigger fills them only once (from the sign-up metadata, when the row is created,
 * or when they are still empty), so every later acceptance is recorded here.
 *
 * Row Level Security is on for the table with no policies; the app connects as the table's
 * owner (Supabase's `postgres` role), which RLS does not restrict (checked by the integration
 * test). Both statements are parameterised and touch the one row with this id.
 */
export function createProfileStore(db: Executor): ProfileStore {
  return {
    async recordTermsAcceptance(userId, termsVersion) {
      const rows = await db.execute(sql`
        update public.profiles
        set terms_version = ${termsVersion}, terms_accepted_at = now(), age_confirmed_at = now()
        where id = ${userId}
        returning id`);
      return rows.length > 0;
    },

    async clearTermsAcceptance(userId) {
      const rows = await db.execute(sql`
        update public.profiles
        set terms_version = null, terms_accepted_at = null, age_confirmed_at = null
        where id = ${userId}
        returning id`);
      return rows.length > 0;
    },
  };
}
