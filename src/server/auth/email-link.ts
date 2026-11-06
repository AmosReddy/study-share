import { describeForLog } from "@/server/describe-error";
import type { AuthProvider } from "@/server/ports/auth-provider";
import { confirmLinkTarget } from "./redirect-target";

/*
  Email links: sign-up confirmation (`type=email`) and password reset (`type=recovery`).
  Opening a link (GET) only shows a "Continue" page; the token is used when the person taps
  Continue (POST). Mail scanners such as Outlook Safe Links open links but do not submit
  forms, so they can no longer use up a single-use token before the person does.
*/

export type EmailLinkType = "email" | "recovery";
export type EmailLink = { tokenHash: string; type: EmailLinkType; next: string };

/** A sign-up link that did not work: log in, or ask for a new confirmation link. */
export const LINK_EXPIRED_LOGIN = "/login?error=link_expired";
/** A reset link that did not work: ask for a new reset link. */
export const LINK_EXPIRED_RESET = "/forgot-password?error=link_expired";

const MAX_TOKEN_LENGTH = 512;

const failurePath = (type: unknown) => (type === "recovery" ? LINK_EXPIRED_RESET : LINK_EXPIRED_LOGIN);

/**
 * Reads a link's parameters (from the query string or the posted form). Anything that cannot
 * be a real link (an unknown type, no token) gives the same expired-link screen as a failure.
 * `redirect_to` is reduced to a path and query on this site.
 */
export function readEmailLink(params: { get(name: string): unknown }): { link: EmailLink } | { failure: string } {
  const text = (name: string) => {
    const value = params.get(name);
    return typeof value === "string" ? value : "";
  };
  const type = text("type");
  const tokenHash = text("token_hash");
  if ((type !== "email" && type !== "recovery") || tokenHash === "" || tokenHash.length > MAX_TOKEN_LENGTH) {
    return { failure: failurePath(type) };
  }
  return { link: { tokenHash, type, next: confirmLinkTarget(text("redirect_to")) } };
}

/**
 * Uses the link's token. It signs the person in on this device, so the link works on a
 * different device from the one used to sign up. Returns where to go next. A failure of any
 * kind (expired, used, an outage, missing settings) is the expired-link screen; it is logged
 * without the token.
 */
export async function verifyEmailLink(getAuth: () => Promise<Pick<AuthProvider, "confirmEmailToken">>, link: EmailLink): Promise<string> {
  let confirmed = false;
  try {
    const auth = await getAuth();
    confirmed = await auth.confirmEmailToken({ tokenHash: link.tokenHash, type: link.type });
  } catch (error) {
    // Not the person's fault (settings or an outage), but they still get the neutral screen.
    console.error("Email link check failed:", describeForLog(error));
  }
  if (!confirmed) return failurePath(link.type);
  return link.type === "recovery" ? "/reset-password" : link.next;
}
