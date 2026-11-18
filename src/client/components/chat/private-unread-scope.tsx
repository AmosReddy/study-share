"use client";

import { createContext, useContext, type ReactNode } from "react";
import { usePrivateUnreadFor } from "@/client/lib/private-unread-store";
import type { PrivateUnreadState } from "@/shared/direct-chat-types";

const ViewerContext = createContext("");

/**
 * Tells everything under the group's frame who is signed in (an opaque tag the server made, never
 * an account id), so the unread dots' store is kept per person and one account never inherits what
 * another account on the same tab last learned.
 */
export function PrivateUnreadScope({ viewer, children }: { viewer: string; children: ReactNode }) {
  return <ViewerContext.Provider value={viewer}>{children}</ViewerContext.Provider>;
}

/** The signed-in person's tag, or "" outside the scope. */
export const useViewer = () => useContext(ViewerContext);

/** What this person has unread in the group: the browser's latest news, else `fallback` (what the server drew). */
export function usePrivateUnread(groupId: string, fallback?: PrivateUnreadState): PrivateUnreadState {
  return usePrivateUnreadFor(useViewer(), groupId, fallback);
}
