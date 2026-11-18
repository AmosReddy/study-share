import "server-only";
import { connection, type NextRequest } from "next/server";
import { oneCursor } from "@/server/chat/cursor-param";
import { requireDirectChatDeps } from "@/server/chat/direct-request-deps";
import { loadDirectChat } from "@/server/chat/direct-use-cases";

/*
  What a private chat's messages route (GET /groups/<id>/chat/private/<chatId>/messages) does. The
  conversation page polls this address every few seconds, and loads earlier messages from it. Each
  request applies the participant rule (see src/server/chat/direct-use-cases.ts), so a person who
  is removed while the page is open stops getting messages at the next poll.

  - A signed-out visitor is sent to log in, like every other page (requireDirectChatDeps redirects).
  - Anyone who is not one of the chat's two people, in the group named by the address (a stranger,
    a removed member, the group's owner, a member of another group, another group's chat id, an
    unknown or deleted group, a malformed id), gets the same bare 404.
  - ?after=<cursor> asks for newer messages, ?before=<cursor> for the page just older; neither
    gives the latest page. Each may appear once, as a short cursor-shaped text, and not both: a
    request that does not fit is a 400 (the same for everyone, so it says nothing about the chat).
  - A page that shows the newest messages also moves the caller's read position (so the unread
    dots clear), as loadDirectChat does.
  - Nothing is cached anywhere: every answer carries Cache-Control: no-store.
*/

const NO_STORE = { "Cache-Control": "no-store" } as const;
const TEXT = { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } as const;

const notFound = () => new Response("Not found", { status: 404, headers: TEXT });
const badRequest = () => new Response("Bad request", { status: 400, headers: TEXT });

export async function serveDirectMessages(
  params: Promise<{ id: string; chatId: string }>,
  request: Pick<NextRequest, "nextUrl">,
): Promise<Response> {
  // Route handlers are prerendered at build time unless they wait for a real request first.
  await connection();
  const { id, chatId } = await params;
  const deps = await requireDirectChatDeps(id);

  // Read only now, after connection(): the request's address is runtime data.
  const searchParams = request.nextUrl.searchParams;
  const after = oneCursor(searchParams, "after");
  const before = oneCursor(searchParams, "before");
  if (after === null || before === null || (after !== undefined && before !== undefined)) return badRequest();

  let page;
  try {
    page = await loadDirectChat(deps, id, chatId, { after, before }, { withName: false });
  } catch {
    // A store outage, not "not found". Nothing from the error is shown.
    console.error("Could not load the private chat.");
    return new Response("Please try again in a moment.", { status: 503, headers: { ...TEXT, "Retry-After": "5" } });
  }
  if (!page) return notFound();
  return Response.json(page, { headers: NO_STORE });
}
