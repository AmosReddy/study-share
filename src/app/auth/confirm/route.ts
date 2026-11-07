import { connection, type NextRequest } from "next/server";
import { CONFIRM_PAGE_HEADERS, renderConfirmPage } from "@/server/auth/confirm-page";
import { readEmailLink, verifyEmailLink } from "@/server/auth/email-link";
import { getAuthProvider } from "@/server/services";

/*
  Where email links land: sign-up confirmation (`type=email`) and password reset (`type=recovery`).
  GET never uses the token: it shows a small page with a Continue button, because mail scanners
  (Outlook Safe Links and others) open links and would otherwise use up the single-use token.
  POST (the Continue button) checks the token and redirects. 303 makes the browser follow with GET.
*/

const seeOther = (path: string) => new Response(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store" } });

export async function GET(request: NextRequest) {
  // Settings and cookies are only read for a real request, never while the build prerenders.
  await connection();
  const read = readEmailLink(request.nextUrl.searchParams);
  if ("failure" in read) return seeOther(read.failure);
  return new Response(renderConfirmPage(read.link), { status: 200, headers: CONFIRM_PAGE_HEADERS });
}

export async function POST(request: NextRequest) {
  await connection();
  const form = await request.formData().catch(() => new FormData());
  const read = readEmailLink(form);
  if ("failure" in read) return seeOther(read.failure);
  return seeOther(await verifyEmailLink(getAuthProvider, read.link));
}
