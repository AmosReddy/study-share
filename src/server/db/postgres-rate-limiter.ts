import "server-only";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { RateLimiter } from "@/server/ports/rate-limiter";
import type * as schema from "./schema";

const DAY_SECONDS = 24 * 60 * 60;
// Share of hits that also sweep expired rows, so the table does not grow forever.
const CLEANUP_CHANCE = 0.05;

/**
 * Fixed-window limiter kept in the database, so the count is shared by every
 * server instance and survives restarts. A window starts at the first hit after
 * the previous window ended. `now` returns milliseconds and decides every window
 * boundary (not the database clock), so tests can move time.
 *
 * Hits are serialised per key with a transaction-scoped advisory lock, because
 * the first hit of a window picks that window's start time and two simultaneous
 * first hits must not each start their own window. The count itself is a single
 * atomic upsert.
 */
export function createPostgresRateLimiter(
  db: PostgresJsDatabase<typeof schema>,
  now: () => number = Date.now,
): RateLimiter {
  return {
    async hit({ key, limit, windowSeconds }) {
      const t = now();
      const nowIso = new Date(t).toISOString();

      const { startMs, hits } = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
        const rows = await tx.execute<{ start_ms: string; hits: number }>(sql`
          insert into rate_limits (key, window_start, hits)
          select ${key}, coalesce(
            (select max(window_start) from rate_limits
              where key = ${key}
                and window_start > ${nowIso}::timestamptz - make_interval(secs => ${windowSeconds}::double precision)),
            ${nowIso}::timestamptz
          ), 1
          on conflict (key, window_start) do update set hits = rate_limits.hits + 1
          returning (extract(epoch from window_start) * 1000)::bigint as start_ms, hits`);
        return { startMs: Number(rows[0].start_ms), hits: Number(rows[0].hits) };
      });

      if (Math.random() < CLEANUP_CHANCE) {
        const cutoff = new Date(t - Math.max(DAY_SECONDS, windowSeconds) * 1000).toISOString();
        await db.execute(sql`delete from rate_limits where window_start < ${cutoff}::timestamptz`);
      }

      if (hits <= limit) return { allowed: true, retryAfterSeconds: 0 };
      const retryAfterSeconds = Math.max(1, Math.ceil((startMs + windowSeconds * 1000 - t) / 1000));
      return { allowed: false, retryAfterSeconds };
    },
  };
}
