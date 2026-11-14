import type { ChatItem } from "./chat-state";

/** Messages by the same person closer together than this share one name label. */
export const GROUP_GAP_MS = 5 * 60 * 1000;

export type ChatRow = {
  item: ChatItem;
  /** First of a run by one person: others' messages show the sender's name here. */
  startsGroup: boolean;
};

/**
 * Marks where a new run of messages begins: a different sender (own messages, or another name),
 * or more than `gapMs` since the message before. Names are compared because the views carry no
 * account ids; two people with one name run together, which is harmless.
 */
export function groupRows(items: readonly ChatItem[], gapMs: number = GROUP_GAP_MS): ChatRow[] {
  return items.map((item, index) => {
    const before = items[index - 1];
    const startsGroup =
      !before ||
      before.mine !== item.mine ||
      before.senderName !== item.senderName ||
      Date.parse(item.createdAt) - Date.parse(before.createdAt) > gapMs;
    return { item, startsGroup };
  });
}

/**
 * A message's time in the viewer's own time zone: "10:42" for today, "14 Nov, 10:42" for another
 * day, "14 Nov 2025, 10:42" for another year. `nowMs` and `timeZone` are given so it is testable
 * (the page passes its own clock reading and no zone, which means the viewer's). "" for text that
 * is not a time.
 */
export function formatMessageTime(iso: string, nowMs: number, timeZone?: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const now = new Date(nowMs);
  const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(at);
  const day = (date: Date) =>
    new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "numeric", day: "numeric", timeZone }).format(date);
  if (day(at) === day(now)) return clock;
  const year = (date: Date) => new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone }).format(date);
  const date = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    ...(year(at) === year(now) ? {} : { year: "numeric" as const }),
    timeZone,
  }).format(at);
  return `${date}, ${clock}`;
}
