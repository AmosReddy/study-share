import { getSiteUrl } from "../site-url";

/*
  Options for the Supabase session cookies, defined once so the auth adapter and
  the proxy always write the same cookie. The cookies hold the access and refresh
  tokens and no browser code reads them, so they are httpOnly. They are Secure
  when the site is served over https. @supabase/ssr adds its own maxAge (and
  maxAge 0 on removal), which is kept.

  This file must stay free of server-only code: the proxy imports it.
*/

export function authCookieOptions(secure: boolean) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/" };
}

/** True when this deployment's address (see getSiteUrl) is https. Local http development is not. */
export function siteUsesHttps(source: Record<string, string | undefined> = process.env): boolean {
  return new URL(getSiteUrl(source)).protocol === "https:";
}
