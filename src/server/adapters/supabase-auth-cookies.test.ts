import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { authCookieOptions, siteUsesHttps } from "./supabase-auth-cookies";
import { createSupabaseAuthProvider } from "./supabase-auth-provider";
import { refreshSupabaseSession } from "./supabase-session-proxy";

/*
  The session cookies hold the access and refresh tokens, so they must be
  httpOnly (no script can read them), Secure on https sites, and written with the
  same options by the adapter and by the proxy. These tests run the real
  @supabase/ssr client; only the network (global fetch) is replaced.
*/

const SUPABASE_URL = "https://abcdefgh.supabase.co";
const COOKIE = "sb-abcdefgh-auth-token";

const b64url = (value: string) => Buffer.from(value).toString("base64url");
const jwt = (sub: string) =>
  `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({ sub, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }),
  )}.c2lnbmF0dXJl`;

const user = { id: "user-1", aud: "authenticated", email: "ada@example.com", app_metadata: {}, user_metadata: {} };
const sessionBody = () => ({
  access_token: jwt("user-1"),
  refresh_token: "new-refresh-token",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: "bearer",
  user,
});

/** Stands in for the Supabase Auth server. */
function fakeAuthServer() {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname.endsWith("/token")) return json(sessionBody());
    if (url.pathname.endsWith("/user")) return json(user);
    if (url.pathname.endsWith("/logout")) return new Response(null, { status: 204 });
    return json({ message: "not found" }, 404);
  });
}

/** A stored session whose access token has expired, so the next check refreshes it. */
const expiredSessionCookie = () =>
  `base64-${b64url(JSON.stringify({ ...sessionBody(), refresh_token: "old-refresh-token", expires_at: 1 }))}`;

type Written = { name: string; value: string; options?: Record<string, unknown> };

function makeJar(initial: Record<string, string> = {}) {
  const jar = new Map(Object.entries(initial));
  const writes: Written[] = [];
  return {
    writes,
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (items: { name: string; value: string; options?: object }[]) => {
        for (const item of items) {
          writes.push(item as Written);
          if (item.value) jar.set(item.name, item.value);
          else jar.delete(item.name);
        }
      },
    },
  };
}

beforeEach(() => vi.stubGlobal("fetch", fakeAuthServer()));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("authCookieOptions (the single definition)", () => {
  test("is httpOnly, lax and site-wide, with Secure as given", () => {
    expect(authCookieOptions(true)).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    expect(authCookieOptions(false)).toEqual({ httpOnly: true, secure: false, sameSite: "lax", path: "/" });
  });

  test("Secure follows the site address: https yes, http (localhost) no", () => {
    expect(siteUsesHttps({ NEXT_PUBLIC_SITE_URL: "https://study.example" })).toBe(true);
    expect(siteUsesHttps({ VERCEL_URL: "app-git-x.vercel.app" })).toBe(true);
    expect(siteUsesHttps({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000" })).toBe(false);
    expect(siteUsesHttps({})).toBe(false);
  });
});

describe("cookies written by the adapter", () => {
  const signIn = async (secureCookies: boolean | undefined) => {
    const { writes, cookies } = makeJar();
    const provider = createSupabaseAuthProvider({ url: SUPABASE_URL, anonKey: "anon", cookies, secureCookies });
    expect(await provider.signInWithPassword({ email: "ada@example.com", password: "pw-123456" })).toEqual({ ok: true });
    return { writes, cookies, provider };
  };

  test.each([true, false])("sign-in writes the session with authCookieOptions(secure=%s)", async (secure) => {
    const { writes } = await signIn(secure);
    const session = writes.filter((w) => w.name.startsWith(COOKIE) && w.value);
    expect(session.length).toBeGreaterThan(0);
    for (const w of session) expect(w.options).toMatchObject(authCookieOptions(secure));
  });

  test("by default Secure is decided from the site address", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://study.example");
    const { writes } = await signIn(undefined);
    for (const w of writes) expect(w.options).toMatchObject(authCookieOptions(true));
  });

  test("sign-out removes the cookies with the same options", async () => {
    const { writes, provider } = await signIn(true);
    writes.length = 0;
    await provider.signOut();
    const removals = writes.filter((w) => w.name.startsWith(COOKIE) && !w.value);
    expect(removals.length).toBeGreaterThan(0);
    for (const w of removals) expect(w.options).toMatchObject({ ...authCookieOptions(true), maxAge: 0 });
  });
});

describe("cookies written by the proxy", () => {
  test.each([
    ["https://study.example", true],
    ["http://localhost:3000", false],
  ] as const)("site %s: refreshed cookies carry authCookieOptions(%s) and the cache headers", async (site, secure) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SERVICES_MODE", "real");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", site);
    const request = new NextRequest("http://localhost:3000/", { headers: { cookie: `${COOKIE}=${expiredSessionCookie()}` } });

    const response = await refreshSupabaseSession(request);

    const written = response.cookies.get(COOKIE);
    expect(written?.value).toMatch(/^base64-/);
    expect(written?.value).not.toBe(expiredSessionCookie());
    expect(written).toMatchObject({ httpOnly: true, secure, sameSite: "lax", path: "/" });
    // Request cookies carry only name and value; the page rendered next sees the new value.
    expect(request.cookies.get(COOKIE)?.value).toBe(written?.value);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });
});
