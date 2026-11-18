"use client";

import Link from "next/link";
import { buttonVariants } from "@/client/components/ui/button";
import type { PrivateUnreadState } from "@/shared/direct-chat-types";
import { usePrivateUnread } from "./private-unread-scope";

type Props = {
  groupId: string;
  /** What the server drew for this page; the browser's own news (the background check) wins after that. */
  fallback: PrivateUnreadState;
  /** On the Private list itself there is nowhere better to go than the one unread conversation. */
  onList?: boolean;
};

/**
 * A clear note above the chat when the person has unread private messages: "New private message
 * from <Name>" with a large Open link straight to that conversation, or "<N> unread private chats"
 * with a link to the Private list. It uses only the person's OWN summary, so it can never show
 * anything to someone who is not in the conversation. The region is always in the page and its
 * content comes and goes, so a screen reader announces a new message politely when it arrives.
 */
export function PrivateUnreadBanner({ groupId, fallback, onList = false }: Props) {
  const { chats } = usePrivateUnread(groupId, fallback);
  const base = `/groups/${encodeURIComponent(groupId)}/chat/private`;
  const only = chats.length === 1 ? chats[0] : null;
  const href = only ? `${base}/${encodeURIComponent(only.chatId)}` : onList ? null : base;

  return (
    // Empty, it takes no room: the negative margin gives back the gap the parent puts around it.
    <div role="status" className="empty:-mb-3">
      {chats.length > 0 ? (
        <div data-testid="private-banner" className="flex items-center gap-3 rounded-xl border border-destructive/50 bg-destructive/5 p-3">
          <p className="min-w-0 flex-1 text-base font-medium [overflow-wrap:anywhere]">
            {only ? `New private message from ${only.name}` : `${chats.length} unread private chats`}
          </p>
          {href ? (
            <Link
              href={href}
              aria-label={only ? `Open the private chat with ${only.name}` : "Open your private chats"}
              className={buttonVariants({ className: "h-11 shrink-0 px-5 text-base" })}
            >
              Open
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
