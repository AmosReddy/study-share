import { connection } from "next/server";
import { getFakeAuthStore } from "@/server/adapters/fake-auth-provider";

/**
 * Test mode only: makes the fake auth provider's next sign-out fail once, so browser tests can
 * check what a failed log-out looks like. POST /api/test/reset clears it. In any other mode it
 * does not exist.
 */
export async function POST() {
  await connection();
  if (process.env.SERVICES_MODE !== "fake") return new Response("Not found", { status: 404 });
  getFakeAuthStore().failNextSignOut = true;
  return new Response(null, { status: 204 });
}
