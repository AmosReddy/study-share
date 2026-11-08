import { connection, type NextRequest } from "next/server";
import { findFakeUserByEmail, getFakeAuthStore } from "@/server/adapters/fake-auth-provider";

/**
 * Test mode only: sets the accepted terms version of the fake account with `?email=` to
 * `?version=`, so browser tests can model a person who accepted an older version of the terms
 * (they must then accept the current one on /welcome). 404 when there is no such account, and
 * in any other mode it does not exist.
 */
export async function POST(request: NextRequest) {
  await connection();
  if (process.env.SERVICES_MODE !== "fake") return new Response("Not found", { status: 404 });
  const params = request.nextUrl.searchParams;
  const user = findFakeUserByEmail(getFakeAuthStore(), params.get("email") ?? "");
  const version = params.get("version") ?? "";
  if (!user || version === "") return new Response("Not found", { status: 404 });
  user.termsVersion = version;
  return new Response(null, { status: 204 });
}
