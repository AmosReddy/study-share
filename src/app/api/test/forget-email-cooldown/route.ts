import { connection, type NextRequest } from "next/server";
import { forgetEmailSendCooldown } from "@/server/services";

/**
 * Test mode only: clears the one-email-a-minute cooldown of `?email=`, so a browser test can
 * send a second email to an address straight away. In any other mode it does not exist.
 */
export async function POST(request: NextRequest) {
  await connection();
  if (process.env.SERVICES_MODE !== "fake") return new Response("Not found", { status: 404 });
  forgetEmailSendCooldown(request.nextUrl.searchParams.get("email") ?? "");
  return new Response(null, { status: 204 });
}
