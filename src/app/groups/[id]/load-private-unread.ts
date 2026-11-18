import "server-only";
import { cache } from "react";
import { withDirectChat } from "@/server/chat/direct-request-deps";
import { privateUnread } from "@/server/chat/direct-use-cases";
import type { PrivateUnread } from "@/shared/direct-chat-types";
import { loadGroupPage } from "./load-group";

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
