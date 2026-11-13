import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
  postgres (postgres.js) 4.0.0 hangs forever behind Supabase's transaction pooler (Supavisor, port
  6543) as soon as two queries are in flight on one connection: the database shows the second
  query "active" and waiting to read from the client (ClientRead), and every later query on that
  connection queues behind it. The app keeps one connection per server instance (max: 1), and a
  group page runs several queries at once, so pages never finished loading, and Vercel stopped
  them after 300 seconds ("Task timed out"). The same queries through the direct connection, or
  with postgres 3.4.9 through the pooler, all succeed (checked on 2026-11-13 against the dev
  project). CI's Postgres has no pooler, so the database tests cannot catch this: this guard does.
  Before moving to a new major version, check parallel queries through the transaction pooler.
*/
describe("database driver", () => {
  it("is postgres.js 3.x, which works behind Supabase's transaction pooler", () => {
    // The package does not export its package.json, so read the installed copy directly.
    const manifest = JSON.parse(readFileSync("node_modules/postgres/package.json", "utf8")) as { version: string };
    expect(manifest.version.split(".")[0]).toBe("3");
  });

  it("is declared as 3.x in package.json, so an update cannot jump to 4", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies.postgres).toMatch(/^\^?3\./);
  });
});
