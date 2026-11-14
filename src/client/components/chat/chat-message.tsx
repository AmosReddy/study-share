"use client";

import { Trash2 } from "lucide-react";
import { ConfirmSheet } from "@/client/components/groups/confirm-sheet";
import { cn } from "@/client/lib/utils";
import type { ChatRow } from "@/client/lib/chat-format";
import type { FormAction } from "@/shared/form-state";

type ChatMessageProps = {
  row: ChatRow;
  groupId: string;
  /** The message's time as text, in the viewer's time zone; "" until the browser has taken over. */
  timeText: string;
  /** The viewer is the group's owner (the delete sheet says so for other people's messages). */
  canDeleteAny: boolean;
  deleteAction: FormAction;
  onDeleted: (id: string) => void;
  onRetry: (clientId: string, body: string) => void;
  onDiscard: (clientId: string) => void;
};

/** A short, single-line version of a message for a button's accessible name. */
const preview = (body: string) => {
  const line = body.replace(/\s+/g, " ").trim();
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
};

/**
 * One message: the sender's name above the first of a run (others' messages only), a bubble of
 * plain text (React escapes it; line breaks are kept and long words wrap), the time, and for a
 * message the viewer may delete a trash button beside it. Own messages sit on the right in the
 * primary colour. A message still being sent says so; one that failed offers retry and discard.
 */
export function ChatMessage({ row, groupId, timeText, canDeleteAny, deleteAction, onDeleted, onRetry, onDiscard }: ChatMessageProps) {
  const { item, startsGroup } = row;
  const showName = startsGroup && !item.mine;
  const id = item.id;

  return (
    <li
      data-testid="chat-message"
      data-status={item.status}
      data-mine={item.mine ? "true" : "false"}
      className={cn("flex flex-col", item.mine ? "items-end" : "items-start", startsGroup ? "mt-3 first:mt-0" : "mt-0.5")}
    >
      {showName ? (
        <span className="mb-0.5 max-w-full px-1 text-xs font-medium text-muted-foreground [overflow-wrap:anywhere]">
          {item.senderName}
        </span>
      ) : null}
      {/* Reversed for own messages, so the delete button is on the outer side and the bubble is read first. */}
      <div className={cn("flex max-w-[92%] min-w-0 items-center gap-1", item.mine && "flex-row-reverse")}>
        <div
          className={cn(
            "min-w-0 rounded-2xl px-3 py-2 text-base",
            item.mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted text-foreground",
            item.status !== "sent" && "opacity-80",
          )}
        >
          <p className="leading-6 whitespace-pre-wrap [overflow-wrap:anywhere]">{item.body}</p>
          {item.status === "sent" ? (
            <time dateTime={item.createdAt} className="mt-0.5 block text-right text-xs">
              {timeText || " "}
            </time>
          ) : null}
        </div>
        {id && item.canDelete ? (
          <ConfirmSheet
            action={deleteAction}
            fields={{ groupId, messageId: id }}
            opener={{
              label: <Trash2 className="size-4" aria-hidden="true" />,
              ariaLabel: `Delete message: ${preview(item.body)}`,
              variant: "ghost",
              className: "size-11 shrink-0 p-0 text-muted-foreground",
            }}
            title="Delete this message?"
            description={
              item.mine
                ? "It disappears for everyone in the group and cannot be brought back."
                : canDeleteAny
                  ? "As the owner you can delete anyone's message. It disappears for everyone in the group and cannot be brought back."
                  : "It disappears for everyone in the group and cannot be brought back."
            }
            confirmLabel="Yes, delete"
            pendingLabel="Deleting…"
            confirmVariant="destructive"
            onDone={() => onDeleted(id)}
          />
        ) : null}
      </div>
      {item.status === "sending" ? <span className="px-1 pt-0.5 text-xs text-muted-foreground">Sending…</span> : null}
      {item.status === "failed" ? (
        <div className="flex max-w-full flex-col items-end">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onRetry(item.key, item.body)}
              className="min-h-11 rounded-md px-2 text-sm font-medium text-destructive underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Not sent. Tap to retry
            </button>
            <button
              type="button"
              onClick={() => onDiscard(item.key)}
              className="min-h-11 rounded-md px-2 text-sm text-muted-foreground underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Discard
            </button>
          </div>
          {item.error ? <span className="px-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">{item.error}</span> : null}
        </div>
      ) : null}
    </li>
  );
}
