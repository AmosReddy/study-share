import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getAuthProvider } from "@/server/services";
import type { AuthUser } from "@/server/ports/auth-provider";
import { TERMS_VERSION } from "@/shared/legal";
import { safeNextPath } from "@/shared/safe-next-path";

/*
  The provider's displayName and termsVersion come from the user's own metadata,
  which they can edit. Treat both as unvalidated: the terms gate below is the only
  decision that uses them, and nothing here grants access to anything.
*/

/** An empty display name shows as the part of the email before the @. */
export function withDisplayName(user: AuthUser): AuthUser {
  if (user.displayName.trim() !== "") return user;
  return { ...user, displayName: user.email.split("@")[0] };
}

/**
 * Where a person must go before they may see `path`, or null when they may stay.
 * Signed out goes to login; with `requireTerms`, anyone who has not accepted the
 * current terms version goes to /welcome. The path to return to is made safe first.
 */
export function authRedirectTarget(
  user: AuthUser | null,
  path: string,
  options: { requireTerms?: boolean } = {},
): string | null {
  const next = encodeURIComponent(safeNextPath(path));
  if (!user) return `/login?next=${next}`;
  if (options.requireTerms && user.termsVersion !== TERMS_VERSION) return `/welcome?next=${next}`;
  return null;
}

/** The signed-in person, or null. Cached for one request so layouts and pages share one lookup. */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  // Making the provider and reading the person both check the token's expiry against the clock
  // (Date.now()), which Next.js refuses while it prerenders a page's shell with the session cookies
  // for a link's prefetch. getAuthProvider waits for a real request (connection()) before it makes
  // the Supabase client, so everything after it runs at request time. See the comment there. This
  // is the one place every signed-in page and the login/sign-up pages go through.
  const auth = await getAuthProvider();
  const user = await auth.getUser();
  return user ? withDisplayName(user) : null;
});

export async function requireUser(next: string): Promise<AuthUser> {
  const user = await getCurrentUser();
  const target = authRedirectTarget(user, next);
  if (target || !user) redirect(target ?? "/login");
  return user;
}

export async function requireAcceptedTerms(next: string): Promise<AuthUser> {
  const user = await getCurrentUser();
  const target = authRedirectTarget(user, next, { requireTerms: true });
  if (target || !user) redirect(target ?? "/login");
  return user;
}
