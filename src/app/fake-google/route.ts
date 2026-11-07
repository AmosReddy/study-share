import { connection, type NextRequest } from "next/server";
import { fakeGoogleReturnUrl } from "@/server/auth/redirect-target";
import { getSiteUrl } from "@/server/site-url";

/**
 * Test mode only: stands in for Google's sign-in screen. Like Google, it sends the
 * person back to `redirect_to` with the code added, and only to this site.
 * In any other mode it does not exist.
 */
export async function GET(request: NextRequest) {
  await connection();
  if (process.env.SERVICES_MODE !== "fake") return new Response("Not found", { status: 404 });

  const params = request.nextUrl.searchParams;
  const target = fakeGoogleReturnUrl(params.get("redirect_to"), params.get("code"), getSiteUrl());
  if (!target) return new Response("Not found", { status: 404 });
  return Response.redirect(target, 303);
}
