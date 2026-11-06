import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/*
  Runs in the proxy, before each page or route. It refreshes an expiring Supabase
  session and writes the new cookies onto both the request (so the page rendered
  next sees them) and the response (so the browser keeps them), along with the
  no-cache headers Supabase asks for when it sets auth cookies.

  The proxy must not import server-only code, so the three settings it needs are
  read straight from process.env rather than through getServerEnv(). It never
  fails a request: if the settings are missing or Supabase cannot be reached, the
  request simply continues and the page sees the session as it was.
*/

const REFRESH_TIMEOUT_MS = 5000;

export async function refreshSupabaseSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (process.env.SERVICES_MODE === "fake" || !url || !anonKey) return response;

  try {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items, headers) => {
          for (const { name, value } of items) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of items) response.cookies.set(name, value, options);
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        },
      },
    });
    // Verifies the token and refreshes it when it is about to expire. The result is not
    // needed here: pages and actions check the user themselves through the AuthProvider.
    // Supabase retries an unreachable server for about 25 seconds, so stop waiting sooner.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      supabase.auth.getClaims(),
      new Promise((resolve) => (timer = setTimeout(resolve, REFRESH_TIMEOUT_MS))),
    ]).finally(() => clearTimeout(timer));
  } catch {
    // Unreachable or misconfigured auth service: let the request through unchanged.
  }
  return response;
}
