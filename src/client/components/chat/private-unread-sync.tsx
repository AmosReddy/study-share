"use client";

import { useEffect } from "react";
import { setPrivateUnread } from "@/client/lib/private-unread-store";

/**
 * Puts what the server just worked out for this page into the browser's store, so the Chat tab's
 * dot (drawn by the group layout, which is not drawn again on a move between tabs) agrees with it.
 * Draws nothing.
 */
export function PrivateUnreadSync({ groupId, any }: { groupId: string; any: boolean }) {
  useEffect(() => {
    setPrivateUnread(groupId, any);
  }, [groupId, any]);
  return null;
}
