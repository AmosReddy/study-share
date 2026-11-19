"use client";

import Link from "next/link";
import { usePrivateUnread } from "@/client/components/chat/private-unread-scope";
import { UnreadDot } from "@/client/components/chat/unread-dot";
import type { PrivateUnreadState } from "@/shared/direct-chat-types";
import { cn } from "@/client/lib/utils";

type ChatSwitchProps = {
  groupId: string;
  current: "group" | "private";
  /** What the server drew for this page; the browser's own news (the background check, the list's polling) wins after that. */
  unread: PrivateUnreadState;
};

/**
 * "Group | Private" at the top of the Chat area: two links (not a widget that holds state), so each
 * has its own address, the current one is marked with aria-current, and the back button works.
 * Private carries the unread dot.
 */
export function ChatSwitch({ groupId, current, unread }: ChatSwitchProps) {
  const base = `/groups/${encodeURIComponent(groupId)}/chat`;
  const showDot = usePrivateUnread(groupId, unread).any;
  const items = [
    { key: "group" as const, href: base, label: "Group" },
    { key: "private" as const, href: `${base}/private`, label: "Private" },
  ];
  return (
    <nav aria-label="Chat type">
      <ul className="flex gap-1 rounded-xl border bg-muted/40 p-1">
        {items.map(({ key, href, label }) => {
          const active = current === key;
          return (
            <li key={key} className="min-w-0 flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-base font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                  active && "bg-background font-semibold text-foreground shadow-sm",
                )}
              >
                {label}
                {key === "private" && showDot ? <UnreadDot className="size-3.5" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
