import "server-only";
import { connection } from "next/server";
import { requireDirectChatDeps } from "@/server/chat/direct-request-deps";
import { listPrivateChats, privateUnread } from "@/server/chat/direct-use-cases";
import type { PrivateSummary } from "@/shared/direct-chat-types";

/*
  What the private summary route (GET /groups/<id>/chat/private/summary) does. The Private list
  polls it: the person's chats (newest first, each with its unread dot) and the unread information
  for the tabs and the Members list: `{ chats, unread: { any, fromChatKeys } }` (see
  src/shared/direct-chat-types.ts). It takes no parameters (any in the address are ignored).

  - A signed-out visitor is sent to log in (requireDirectChatDeps redirects).
  - Anyone who may not use the group's chat (a stranger, a removed member, an unknown or deleted
    group, a malformed id) gets the same bare 404. Everyone else only ever gets THEIR OWN chats.
  - Nothing is cached anywhere: every answer carries Cache-Control: no-store.
*/

const NO_STORE = { "Cache-Control": "no-store" } as const;
const TEXT = { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } as const;

export async function servePrivateSummary(params: Promise<{ id: string }>): Promise<Response> {
  // Route handlers are prerendered at build time unless they wait for a real request first.
  await connection();
  const { id } = await params;
  const deps = await requireDirectChatDeps(id);

  let list;
  try {
    list = await listPrivateChats(deps, id);
  } catch {
    // A store outage, not "not found". Nothing from the error is shown.
    console.error("Could not load the private chats.");
    return new Response("Please try again in a moment.", { status: 503, headers: { ...TEXT, "Retry-After": "5" } });
  }
  if (!list) return new Response("Not found", { status: 404, headers: TEXT });

  const summary: PrivateSummary = { chats: list.chats, unread: await privateUnread(deps, id) };
  return Response.json(summary, { headers: NO_STORE });
}
