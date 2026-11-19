import "server-only";
import { cache } from "react";
import { withDirectChat } from "@/server/chat/direct-request-deps";
import { loadPrivateSummary, type DirectChatDeps } from "@/server/chat/direct-use-cases";
import { getServerEnv } from "@/server/env";
import { viewerTokenFor } from "@/server/groups/chat-key";
import { noUnreadState, unreadStateFrom, type PrivateUnreadState } from "@/shared/direct-chat-types";
import { loadGroupPage } from "./load-group";

/**
 * An opaque tag for the signed-in person (never their account id) that the browser's unread-dot
 * store is keyed by, so a different account on the same tab never inherits it. "" when it cannot
 * be made, which only means the store is shared as before.
 */
export function viewerTokenOf(userId: string): string {
  try {
    return viewerTokenFor(getServerEnv().SUPABASE_SERVICE_ROLE_KEY, userId);
  } catch {
    return "";
  }
}

/** Next's own control flow (a redirect to log in, not-found) travels as an error with a NEXT_ digest: it is not a failure. */
function isNextControlFlow(error: unknown): boolean {
  const digest = typeof error === "object" && error !== null ? (error as { digest?: unknown }).digest : undefined;
  return typeof digest === "string" && digest.startsWith("NEXT_");
}

/**
 * What the person has unread in this group (dots, Members rows, banner), from their own summary.
 * A dot is a nicety: a store failure logs one fixed line and answers "nothing unread", so a page
 * that asked is never broken by it.
 */
export async function safeUnreadState(deps: DirectChatDeps, groupId: string): Promise<PrivateUnreadState> {
  try {
    const summary = await loadPrivateSummary(deps, groupId);
    return summary ? unreadStateFrom(summary) : noUnreadState();
  } catch {
    console.error("Could not check for unread private messages.");
    return noUnreadState();
  }
}

/**
 * The person's unread state for this group, for the pages that draw a dot or the banner. Cached
 * for one request, so the group layout and the page under it share one lookup. Never throws,
 * except for Next's own redirect (a session that ended), which is let through.
 */
export const loadPrivateUnread = cache(async (groupId: string): Promise<PrivateUnreadState> => {
  try {
    const page = await loadGroupPage(groupId);
    if (page) return await safeUnreadState(withDirectChat(page.deps), groupId);
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    console.error("Could not check for unread private messages.");
  }
  return noUnreadState();
});
