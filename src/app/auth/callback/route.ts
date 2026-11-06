import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { getAuthProvider } from "@/server/services";
import { TERMS_VERSION } from "@/shared/legal";
import { safeNextPath } from "@/shared/safe-next-path";

/** Where Google sign-in returns: finish it, then go on, through /welcome if the terms are not accepted yet. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code") ?? "";
  const next = safeNextPath(params.get("next"));

  const auth = await getAuthProvider();
  let signedIn = false;
  try {
    signedIn = code !== "" && (await auth.completeOAuth(code));
  } catch {
    signedIn = false;
  }
  if (!signedIn) redirect("/login?error=oauth_failed");

  // If the new session cannot be read back yet, /welcome checks again and moves on when it can.
  const user = await auth.getUser().catch(() => null);
  if (user?.termsVersion === TERMS_VERSION) redirect(next);
  redirect(`/welcome?next=${encodeURIComponent(next)}`);
}
