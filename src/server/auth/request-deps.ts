import "server-only";
import { headers } from "next/headers";
import { clientIp } from "@/server/request-ip";
import { getAccountDirectory, getAuthProvider, getRateLimiter } from "@/server/services";
import { getSiteUrl } from "@/server/site-url";
import type { PendingSignup } from "./pending-signup-cookie";
import type { Deps } from "./use-cases";

/**
 * The use-cases' dependencies for this request. `pending` is the signed pending sign-up cookie
 * (readPendingSignupCookie), passed only by the code screen's actions. Cookies and headers are
 * read before any setting (getAuthProvider reads cookies first).
 */
export async function requestDeps(pending: PendingSignup | null = null): Promise<Deps> {
  const [auth, requestHeaders] = await Promise.all([getAuthProvider(), headers()]);
  return {
    auth,
    limiter: getRateLimiter(),
    siteUrl: getSiteUrl(),
    ip: clientIp(requestHeaders.get("x-forwarded-for")),
    directory: getAccountDirectory(),
    pending,
  };
}
