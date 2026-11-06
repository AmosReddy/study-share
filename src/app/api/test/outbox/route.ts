import { connection, type NextRequest } from "next/server";
import { getFakeAuthStore } from "@/server/adapters/fake-auth-provider";

/**
 * Test mode only: the newest link "emailed" to an address by the fake auth provider,
 * as `{ url }` (null when none). In any other mode it does not exist.
 */
export async function GET(request: NextRequest) {
  await connection();
  if (process.env.SERVICES_MODE !== "fake") return new Response("Not found", { status: 404 });

  const email = request.nextUrl.searchParams.get("email") ?? "";
  // `url` is null when nothing was sent to that address, so a 404 always means "not test mode".
  const url = getFakeAuthStore().outbox.lastFor(email)?.url ?? null;
  return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
}
