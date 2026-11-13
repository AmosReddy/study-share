import { expect, test, vi } from "vitest";

const { postgres } = vi.hoisted(() => ({ postgres: vi.fn(() => ({})) }));
vi.mock("postgres", () => ({ default: postgres }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: vi.fn(() => ({})) }));
vi.mock("@/server/env", () => ({ getServerEnv: () => ({ DATABASE_URL: "postgres://u:p@db.example:6543/postgres" }) }));

import { getDb } from "./client";

test("connects through the pooler without prepared statements, one connection, giving up after 5 seconds, closing idle connections", () => {
  getDb();
  expect(postgres).toHaveBeenCalledWith("postgres://u:p@db.example:6543/postgres", {
    prepare: false,
    max: 1,
    connect_timeout: 5,
    idle_timeout: 20,
    max_lifetime: 300,
  });
});
