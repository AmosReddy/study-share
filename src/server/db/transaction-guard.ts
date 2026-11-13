import "server-only";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

/*
  Every transaction that takes an advisory lock runs this first.

  Why: each server instance has ONE database connection (client.ts). If a transaction waits on a
  lock that never comes free (for example one still held by an instance that Vercel froze or killed
  in the middle of its own transaction), that query holds the instance's only connection and every
  other page on the instance queues behind it until Vercel's 300-second limit. The app's own
  2-second limiter timeout does not help: it stops waiting, but the query keeps running.

  These limits are LOCAL to the transaction (set_config(..., true) is SET LOCAL with parameters), so
  they also work through Supabase's transaction pooler and never leak to the next user of the
  pooled connection:
  - lock_timeout: give up waiting for a lock after 3 seconds (the transaction fails and rolls back);
  - statement_timeout: no single statement runs longer than 10 seconds;
  - idle_in_transaction_session_timeout: a transaction left open and idle (its client frozen or
    gone) is ended by Postgres after 10 seconds, which releases its locks for everyone else.
*/
export const LOCK_TIMEOUT_MS = 3000;
export const STATEMENT_TIMEOUT_MS = 10000;
export const IDLE_IN_TRANSACTION_TIMEOUT_MS = 10000;

export async function guardTransaction(tx: Pick<PostgresJsDatabase, "execute">): Promise<void> {
  await tx.execute(sql`select
    set_config('lock_timeout', ${String(LOCK_TIMEOUT_MS)}, true),
    set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true),
    set_config('idle_in_transaction_session_timeout', ${String(IDLE_IN_TRANSACTION_TIMEOUT_MS)}, true)`);
}
