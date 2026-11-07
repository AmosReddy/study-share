import { connection, type NextRequest } from "next/server";
import { getFakeAuthStore } from "@/server/adapters/fake-auth-provider";

/**
 * Test mode only: the newest email the fake auth provider "sent" to `?email=`. In any other
 * mode it does not exist (404), so a 404 always means "not test mode". The JSON body is:
 *
 *   { code, purpose }        the newest email is a code; purpose is "signup" or "recovery"
 *   { url }                  the newest email is a link (deprecated link flow; Task 5 removes it)
 *   { url: null, code: null } nothing was sent to that address
 */
export async function GET(request: NextRequest) {
  await connection();
  if (process.env.SERVICES_MODE !== "fake") return new Response("Not found", { status: 404 });

  const email = request.nextUrl.searchParams.get("email") ?? "";
  const latest = getFakeAuthStore().outbox.latestFor(email);
  const body = !latest
    ? { url: null, code: null }
    : latest.kind === "code"
      ? { code: latest.code, purpose: latest.purpose }
      : { url: latest.url };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
