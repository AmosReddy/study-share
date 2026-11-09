import { connection } from "next/server";
import { getFakeAuthStore } from "@/server/adapters/fake-auth-provider";

/**
 * Test mode only: makes the next Google repair fail once (the fake account directory's first
 * repair check throws), so browser tests can see a failed Google sign-in end signed out with
 * the error message. POST /api/test/reset clears it. In any other mode it does not exist.
 */
export async function POST() {
  await connection();
  if (process.env.SERVICES_MODE !== "fake") return new Response("Not found", { status: 404 });
  getFakeAuthStore().failNextRepair = true;
  return new Response(null, { status: 204 });
}
