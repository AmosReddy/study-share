import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { describeForLog } from "@/server/describe-error";
import type { AuthUser } from "@/server/ports/auth-provider";
import { getAuthProvider } from "@/server/services";
import { TERMS_VERSION } from "@/shared/legal";
import { safeNextPath } from "@/shared/safe-next-path";

/** Where Google sign-in returns: finish it, then go on, through /welcome if the terms are not accepted yet. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code") ?? "";
  const next = safeNextPath(params.get("next"));

  // Errors are logged without the code; the person sees the neutral screen either way.
  let signedIn = false;
  let user: AuthUser | null = null;
  try {
    const auth = await getAuthProvider();
    signedIn = code !== "" && (await auth.completeOAuth(code));
    if (signedIn) {
      try {
        user = await auth.getUser();
      } catch (error) {
        // Signed in, but the session could not be read back: /welcome checks again.
        console.error("Reading the user after Google sign-in failed:", describeForLog(error));
      }
    }
  } catch (error) {
    console.error("Google sign-in check failed:", describeForLog(error));
    signedIn = false;
  }

  if (!signedIn) redirect("/login?error=oauth_failed");
  if (user?.termsVersion === TERMS_VERSION) redirect(next);
  redirect(`/welcome?next=${encodeURIComponent(next)}`);
}
