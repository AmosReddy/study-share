import "server-only";
import { connection, type NextRequest } from "next/server";
import { requireChatDeps } from "@/server/chat/request-deps";
import { loadChat } from "@/server/chat/use-cases";

/*
  What the chat's messages route (GET /groups/<id>/chat/messages) does. The chat page polls this
  address every few seconds, and loads earlier messages from it. Each request checks that the
  caller is an active member of the group, so a person who is removed while the page is open stops
  getting messages at the next poll.

  - A signed-out visitor is sent to log in, like every other page (requireChatDeps redirects).
  - A non-member, a removed member, an unknown or deleted group and a malformed id all get the
    same bare 404.
  - ?after=<cursor> asks for newer messages, ?before=<cursor> for the page just older; neither
    gives the latest page. Each may appear once, as a short cursor-shaped text, and not both: a
    request that does not fit is a 400 (the same for everyone, so it says nothing about the group).
  - Nothing is cached anywhere: every answer carries Cache-Control: no-store.
*/

const NO_STORE = { "Cache-Control": "no-store" } as const;
const TEXT = { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } as const;

/** Cursors are base64url text of under 100 characters (see src/server/resource-cursor.ts). */
const MAX_CURSOR_LENGTH = 100;
const CURSOR_SHAPE = /^[A-Za-z0-9_-]+$/;

const notFound = () => new Response("Not found", { status: 404, headers: TEXT });
const badRequest = () => new Response("Bad request", { status: 400, headers: TEXT });

/** One cursor-shaped value, nothing when the parameter is absent, or null when it does not fit. */
function oneCursor(params: URLSearchParams, name: string): string | undefined | null {
  const values = params.getAll(name);
  if (values.length === 0) return undefined;
  if (values.length > 1) return null;
  const [value] = values;
  return value.length >= 1 && value.length <= MAX_CURSOR_LENGTH && CURSOR_SHAPE.test(value) ? value : null;
}

export async function serveMessages(params: Promise<{ id: string }>, request: Pick<NextRequest, "nextUrl">): Promise<Response> {
  // Route handlers are prerendered at build time unless they wait for a real request first.
  await connection();
  const { id } = await params;
  const deps = await requireChatDeps(id);

  // Read only now, after connection(): the request's address is runtime data.
  const searchParams = request.nextUrl.searchParams;
  const after = oneCursor(searchParams, "after");
  const before = oneCursor(searchParams, "before");
  if (after === null || before === null || (after !== undefined && before !== undefined)) return badRequest();

  let page;
  try {
    page = await loadChat(deps, id, { after, before });
  } catch {
    // A store outage, not "not found". Nothing from the error is shown.
    console.error("Could not load the chat.");
    return new Response("Please try again in a moment.", { status: 503, headers: { ...TEXT, "Retry-After": "5" } });
  }
  if (!page) return notFound();
  return Response.json(page, { headers: NO_STORE });
}
