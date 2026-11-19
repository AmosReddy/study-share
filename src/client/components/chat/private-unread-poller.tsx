"use client";

import { usePathname } from "next/navigation";
import { BACKGROUND_POLL_MS, fetchPrivateSummary, nextBackgroundPollDelay } from "@/client/lib/chat-poll";
import { createChatPoller } from "@/client/lib/chat-poller";
import { setPrivateUnread } from "@/client/lib/private-unread-store";
import { unreadStateFrom, type PrivateSummary } from "@/shared/direct-chat-types";
import { useViewer } from "./private-unread-scope";
import { useBrowserPoller } from "./use-chat-poll";

/**
 * Keeps the unread dots and the banner current on EVERY page of the group, so a private message
 * shows up wherever the person is (Library, Members, the group chat) without a reload. It asks the
 * same summary route the Private list polls, but slowly (every 10 s while the page is in use, 30 s
 * after two minutes without input, 60 s after ten, back-off after failures; paused while the tab is
 * hidden and checking at once when it is visible again; stopped for good on a 404 or a redirect to
 * log in). It does not run on the Private list and in a conversation, which are already current.
 * It reads no clock while rendering and draws nothing.
 */
export function PrivateUnreadPoller({ groupId }: { groupId: string }) {
  const pathname = usePathname().toLowerCase();
  const base = `/groups/${groupId.toLowerCase()}/chat/private`;
  if (pathname === base || pathname.startsWith(`${base}/`)) return null;
  return <BackgroundCheck groupId={groupId} />;
}

function BackgroundCheck({ groupId }: { groupId: string }) {
  const viewer = useViewer();
  useBrowserPoller(
    () =>
      createChatPoller<PrivateSummary>({
        fetchPage: (_kind, _cursor, signal) => fetchPrivateSummary(groupId, signal),
        // There is no cursor: every request asks for the whole summary.
        getView: () => ({ cursor: null, known: [] }),
        isVisible: () => document.visibilityState === "visible",
        now: () => Date.now(),
        onPage: (_kind, page) => setPrivateUnread(viewer, groupId, unreadStateFrom(page)),
        // A dot is only a hint: failures are retried quietly, and a 404 or sign-out just stops the checks.
        onReconnecting: () => {},
        onGone: () => {},
        onSignedOut: () => {},
        nextDelay: nextBackgroundPollDelay,
        // The page was just drawn by the server with fresh news.
        initialDelayMs: BACKGROUND_POLL_MS,
      }),
    `${viewer}:${groupId}`,
  );
  return null;
}
