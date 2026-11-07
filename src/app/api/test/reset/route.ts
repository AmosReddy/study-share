import { connection } from "next/server";
import { resetFakeAuthStore } from "@/server/adapters/fake-auth-provider";

/**
 * Test mode only: empties the fake auth store (users, sessions, codes and their expiry, links,
 * Google codes, outbox),
 * so browser tests that share the one fake Google account can run again on the same
 * server. In any other mode it does not exist.
 */
export async function POST() {
  await connection();
  if (process.env.SERVICES_MODE !== "fake") return new Response("Not found", { status: 404 });
  resetFakeAuthStore();
  return new Response(null, { status: 204 });
}
