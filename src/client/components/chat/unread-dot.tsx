import { cn } from "@/client/lib/utils";

/**
 * The small dot for unread private messages. It has a name for screen readers, and a ring so it is
 * a shape against any background, not only a colour.
 */
export function UnreadDot({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="New private message"
      data-testid="unread-dot"
      className={cn("inline-block size-2.5 shrink-0 rounded-full bg-destructive ring-2 ring-background", className)}
    />
  );
}
