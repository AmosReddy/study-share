import "server-only";
import { headers } from "next/headers";
import { connection } from "next/server";
import { getCurrentUser, requireAcceptedTerms } from "@/server/auth/session";
import { clientIp } from "@/server/request-ip";
import { getGroupStore, getRateLimiter } from "@/server/services";
import { getSiteUrl } from "@/server/site-url";
import type { GroupDeps, PreviewDeps } from "./use-cases";

/**
 * The group use-cases' dependencies for a page or action that needs a signed-in person who has
 * accepted the terms: anyone else is redirected to log in or to /welcome and returned to `next`.
 * The session (cookies) and headers are read before any setting.
 */
export async function requireGroupDeps(next: string): Promise<GroupDeps> {
  const user = await requireAcceptedTerms(next);
  const requestHeaders = await headers();
  return {
    groups: getGroupStore(),
    limiter: getRateLimiter(),
    siteUrl: getSiteUrl(),
    ip: clientIp(requestHeaders.get("x-forwarded-for")),
    user: { id: user.id, displayName: user.displayName },
  };
}

/**
 * For the invite page, which signed-out people can open: no redirect and no terms check. `user` is
 * null when nobody is signed in.
 */
export async function previewDeps(): Promise<PreviewDeps> {
  const [user, requestHeaders] = await Promise.all([getCurrentUser(), headers()]);
  // A preview counts against the rate limits (and reads the clock), so it only ever runs for a
  // real request: never while Next prerenders the page's shell with the session, as it does for
  // a prefetch.
  await connection();
  return {
    groups: getGroupStore(),
    limiter: getRateLimiter(),
    siteUrl: getSiteUrl(),
    ip: clientIp(requestHeaders.get("x-forwarded-for")),
    user: user ? { id: user.id, displayName: user.displayName } : null,
  };
}
