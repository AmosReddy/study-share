import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getServerEnv } from "@/server/env";
import * as schema from "./schema";

let db: PostgresJsDatabase<typeof schema> | undefined;

/**
 * Created on first use, never at import time. `prepare: false` is required
 * because Supabase's transaction pooler does not support prepared statements.
 * `connect_timeout` (seconds) stops a request waiting long on a database that cannot be reached.
 */
export function getDb(): PostgresJsDatabase<typeof schema> {
  db ??= drizzle(postgres(getServerEnv().DATABASE_URL, { prepare: false, max: 1, connect_timeout: 5 }), { schema });
  return db;
}
