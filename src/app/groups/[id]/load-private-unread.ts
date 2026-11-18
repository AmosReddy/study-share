import "server-only";
import { cache } from "react";
import { withDirectChat } from "@/server/chat/direct-request-deps";
import { getServerEnv } from "@/server/env";
import { viewerTokenFor } from "@/server/groups/chat-key";
import { privateUnread } from "@/server/chat/direct-use-cases";
import type { PrivateUnread } from "@/shared/direct-chat-types";
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

/**
 * Whether the signed-in person has unread private messages in this group, and from whom (as chat
 * keys), for the pages that draw a dot. Cached for one request, so the group layout and the page
 * under it share one lookup. A dot is a nicety: whatever goes wrong, this answers "nothing unread"
 * and never throws, so no page is ever broken by it.
 */
export const loadPrivateUnread = cache(async (groupId: string): Promise<PrivateUnread> => {
  try {
    const page = await loadGroupPage(groupId);
    if (page) return await privateUnread(withDirectChat(page.deps), groupId);
  } catch (error) {
    // Redirects (a session that ended) are not failures: let Next have them.
    const digest = typeof error === "object" && error !== null ? (error as { digest?: unknown }).digest : undefined;
    if (typeof digest === "string" && digest.startsWith("NEXT_")) throw error;
    console.error("Could not check for unread private messages.");
  }
  return { any: false, fromChatKeys: [] };
});
