"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { buttonVariants } from "@/client/components/ui/button";
import { formatRelativeTime } from "@/client/lib/chat-format";
import { fetchPrivateSummary } from "@/client/lib/chat-poll";
import { createChatPoller } from "@/client/lib/chat-poller";
import { setPrivateUnread } from "@/client/lib/private-unread-store";
import { useNow } from "@/client/lib/use-now";
import { DIRECT_CHAT_MESSAGES } from "@/shared/direct-chat-messages";
import type { PrivateSummary } from "@/shared/direct-chat-types";
import { useViewer } from "./private-unread-scope";
import { UnreadDot } from "./unread-dot";
import { useBrowserPoller } from "./use-chat-poll";

/**
 * The Private list: the person's conversations, newest first. It starts from what the server drew
 * and keeps itself current by polling the summary route with the same loop as the chat (2.5 s,
 * slower when nobody touches the page, back-off, stops for good on a 404). Each poll also tells
 * the rest of the page (the tab bar, the switch) whether anything is unread. The "how long ago" is
 * worked out in the browser once it has taken over, so the server's page never reads a clock.
 */
export function PrivateChatList({ groupId, initial }: { groupId: string; initial: PrivateSummary }) {
  const [summary, setSummary] = useState(initial);
  const [reconnecting, setReconnecting] = useState(false);
  const [stopped, setStopped] = useState<"gone" | "signed-out" | null>(null);
  const now = useNow();
  const viewer = useViewer();

  useBrowserPoller(
    () =>
      createChatPoller<PrivateSummary>({
        fetchPage: (_kind, _cursor, signal) => fetchPrivateSummary(groupId, signal),
        // There is no cursor: every request asks for the whole list.
        getView: () => ({ cursor: null, known: [] }),
        isVisible: () => document.visibilityState === "visible",
        now: () => Date.now(),
        onPage: (_kind, page) => {
          setSummary(page);
          setPrivateUnread(viewer, groupId, page.unread.any);
        },
        onReconnecting: setReconnecting,
        onGone: () => setStopped("gone"),
        onSignedOut: () => setStopped("signed-out"),
      }),
    groupId,
  );

  const reload = useCallback(() => window.location.reload(), []);

  if (stopped) {
    return (
      <section role="status" aria-label="Private chats" className="flex flex-col items-center gap-3 rounded-xl border px-4 py-10 text-center">
        {stopped === "gone" ? (
          <>
            <h2 className="text-lg font-semibold">You can no longer see these chats</h2>
            <p className="max-w-md text-muted-foreground">You may have been removed from the group, or the group may have been deleted.</p>
            <Link href="/" className={buttonVariants({ className: "h-11 px-5 text-base" })}>
              Go to your groups
            </Link>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold">You were signed out</h2>
            <p className="max-w-md text-muted-foreground">Log in again to see your chats.</p>
            <button type="button" onClick={reload} className={buttonVariants({ className: "h-11 px-5 text-base" })}>
              Log in again
            </button>
          </>
        )}
      </section>
    );
  }

  return (
    <section aria-label="Private chats list" className="flex flex-col gap-3">
      {summary.chats.length === 0 ? (
        <p className="rounded-xl border px-4 py-10 text-center text-muted-foreground">{DIRECT_CHAT_MESSAGES.emptyList}</p>
      ) : (
        <ul aria-label="Private chats" className="flex flex-col divide-y rounded-xl border">
          {summary.chats.map((chat) => (
            <li key={chat.chatId} data-testid="private-chat-row">
              <Link
                href={`/groups/${encodeURIComponent(groupId)}/chat/private/${encodeURIComponent(chat.chatId)}`}
                className="flex min-h-14 min-w-0 items-start gap-3 px-4 py-3 outline-none first:rounded-t-xl last:rounded-b-xl hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={chat.unread ? "font-semibold [overflow-wrap:anywhere]" : "font-medium [overflow-wrap:anywhere]"}>
                    {chat.name}
                    {chat.otherGone ? <span className="font-normal text-muted-foreground"> {DIRECT_CHAT_MESSAGES.leftTag}</span> : null}
                  </span>
                  <span className="truncate text-muted-foreground">{chat.preview}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5 text-sm text-muted-foreground">
                  <time dateTime={chat.lastAt}>{now ? formatRelativeTime(chat.lastAt, now) : " "}</time>
                  {chat.unread ? <UnreadDot /> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {reconnecting ? (
        <p role="status" className="text-xs text-muted-foreground">
          Reconnecting…
        </p>
      ) : null}
    </section>
  );
}
