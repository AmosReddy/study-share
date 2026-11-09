import type { NextRequest } from "next/server";
import { refreshSupabaseSession } from "@/server/adapters/supabase-session-proxy";

/** Keeps the sign-in session fresh on every page and route request. */
export function proxy(request: NextRequest) {
  return refreshSupabaseSession(request);
}

export const config = {
  matcher: [
    // Everything except static files, image optimisation, the favicon, the manifest and images.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)",
  ],
};
