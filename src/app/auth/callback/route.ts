import { redirect } from "next/navigation";
import { connection, type NextRequest } from "next/server";
import { requestDeps } from "@/server/auth/request-deps";
import { completeGoogleSignIn, GOOGLE_NOT_FINISHED } from "@/server/auth/use-cases";

/**
 * Where Google sign-in returns. The use-case finishes the sign-in, runs the pre-registration
 * repair and the terms rule (spec 4.2, 5.3) and says where to go: `next` (made safe), or
 * /welcome for an out-of-date terms version. On a failure the person is signed out and the
 * log-in page says what happened. Nothing here logs the code.
 */
export async function GET(request: NextRequest) {
  // Settings and cookies are only read for a real request, never while the build prerenders.
  await connection();
  const params = request.nextUrl.searchParams;
  const result = await completeGoogleSignIn(await requestDeps(), params.get("code") ?? "", params.get("next"));
  if (result.ok) redirect(result.data.redirectTo);
  redirect(result.formError === GOOGLE_NOT_FINISHED ? "/login?error=oauth_failed" : "/login?error=google_failed");
}
