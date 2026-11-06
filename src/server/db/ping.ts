import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "./client";

/** Throws if the database cannot be reached. Keeps database vendor code inside src/server/db. */
export async function pingDatabase(): Promise<void> {
  await getDb().execute(sql`select 1`);
}
