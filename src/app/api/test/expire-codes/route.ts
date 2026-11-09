import { connection, type NextRequest } from "next/server";
import { expireAllCodes } from "@/server/adapters/fake-auth-provider";

/**
 * Test mode only: every code the fake auth provider has sent so far stops working, as if
 * their ten minutes had passed (codes sent afterwards work; POST /api/test/reset clears all
 * codes). With `?email=`, only that address's codes, so parallel browser tests stay apart.
 * In any other mode it does not exist.
 */
export async function POST(request?: NextRequest) {
  await connection();
  if (process.env.SERVICES_MODE !== "fake") return new Response("Not found", { status: 404 });
  const email = request?.nextUrl.searchParams.get("email");
  expireAllCodes(undefined, email ?? undefined);
  return new Response(null, { status: 204 });
}
