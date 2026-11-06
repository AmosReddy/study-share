import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { confirmLinkTarget } from "@/server/auth/redirect-target";
import { getAuthProvider } from "@/server/services";

/**
 * Where email links land: sign-up confirmation (`type=email`) and password reset
 * (`type=recovery`). Verifying the token signs the person in on this device, so the
 * link works on a different device from the one used to sign up.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash") ?? "";
  const type = params.get("type");

  let confirmed = false;
  if (tokenHash !== "" && (type === "email" || type === "recovery")) {
    try {
      const auth = await getAuthProvider();
      confirmed = await auth.confirmEmailToken({ tokenHash, type });
    } catch {
      confirmed = false;
    }
  }

  if (!confirmed) redirect("/login?error=link_expired");
  redirect(type === "recovery" ? "/reset-password" : confirmLinkTarget(params.get("redirect_to")));
}
