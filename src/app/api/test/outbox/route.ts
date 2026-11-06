import { connection, type NextRequest } from "next/server";
import { getFakeAuthStore } from "@/server/adapters/fake-auth-provider";

/**
 * Test mode only: the newest link "emailed" to an address by the fake auth provider,
 * as `{ url }`. In any other mode it does not exist.
 */
export async function GET(request: NextRequest) {
  await connection();
  if (process.env.SERVICES_MODE !== "fake") return new Response("Not found", { status: 404 });

  const email = request.nextUrl.searchParams.get("email") ?? "";
  const entry = getFakeAuthStore().outbox.lastFor(email);
  if (!entry) return Response.json({ error: "No email for that address." }, { status: 404 });
  return Response.json({ url: entry.url }, { headers: { "Cache-Control": "no-store" } });
}
