import "server-only";
import { connection } from "next/server";
import { requireFileDeps } from "@/server/files/request-deps";
import { openFile } from "@/server/files/use-cases";

/*
  What the preview (…/content) and download (…/download) routes share. The file page links to these
  two addresses instead of to a storage link, because a storage link is signed for a few minutes
  and a page can stay open for hours. Each request here checks that the caller is an active member
  of the group, asks the file use-case for a fresh link, and answers with a redirect to it.

  - A signed-out visitor is sent to log in, like every other page (requireFileDeps redirects, and
    afterwards they land on the group's page). That is the pattern the repo's other server code
    follows; it also means a person whose session ended while the page was open gets the log-in
    page, not an error.
  - A non-member, a removed member and a file that is not there (or not finished, or in another
    group, or not a valid id) all get the same bare 404.
  - Nothing is cached anywhere: the redirect carries Cache-Control: no-store, so a browser or a proxy
    never replays an old link or an old answer after someone is removed.
*/

const NO_STORE = { "Cache-Control": "no-store" } as const;

const notFound = () => new Response("Not found", { status: 404, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });

export async function redirectToFile(
  params: Promise<{ id: string; fileId: string }>,
  { download }: { download: boolean },
): Promise<Response> {
  // Route handlers are prerendered at build time unless they wait for a real request first.
  await connection();
  const { id, fileId } = await params;
  const deps = await requireFileDeps(id);

  let opened;
  try {
    opened = await openFile(deps, id, fileId, { download });
  } catch {
    // openFile logged a fixed line; this is a store or storage outage, not "not found".
    return new Response("Please try again in a moment.", {
      status: 503,
      headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8", "Retry-After": "5" },
    });
  }
  // The preview address only shows files a browser can show; everything else is a download.
  if (!opened || (!download && !opened.previewable)) return notFound();
  return new Response(null, { status: 302, headers: { ...NO_STORE, Location: opened.url } });
}
