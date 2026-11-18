"use client";

import { useEffect } from "react";
import { setPrivateUnread } from "@/client/lib/private-unread-store";
import { useViewer } from "./private-unread-scope";

/**
 * Puts what the server just worked out for this page into the browser's store, so the Chat tab's
 * dot (drawn by the group layout, which is not drawn again on a move between tabs) agrees with it.
 * It runs after EVERY render of the page (not only when the answer changed), so a fresher answer
 * from the server always replaces what a poll last stored. Draws nothing.
 */
export function PrivateUnreadSync({ groupId, any }: { groupId: string; any: boolean }) {
  const viewer = useViewer();
  useEffect(() => {
    setPrivateUnread(viewer, groupId, any);
  });
  return null;
}
