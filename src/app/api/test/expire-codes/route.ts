import { connection } from "next/server";
import { expireAllCodes } from "@/server/adapters/fake-auth-provider";

/**
 * Test mode only: every code the fake auth provider has sent so far stops working, as if
 * their ten minutes had passed (codes sent afterwards work; POST /api/test/reset clears all
 * codes). In any other mode it does not exist.
 */
export async function POST() {
  await connection();
  if (process.env.SERVICES_MODE !== "fake") return new Response("Not found", { status: 404 });
  expireAllCodes();
  return new Response(null, { status: 204 });
}
