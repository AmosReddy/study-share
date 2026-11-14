import type { ChatPage } from "@/shared/chat-types";

/*
  The chat's polling rules and its one network call. The browser asks for news every 2.5 seconds
  while the tab is visible, backs off when the network or the server fails, and every sixth poll
  (and whenever the tab becomes visible) asks for the newest page instead of "after the cursor", to
  catch a message committed slightly out of order and to notice deletions.
*/

export const POLL_INTERVAL_MS = 2500;
export const BACKOFF_MS = [5000, 10_000, 20_000] as const;
/** Every this-many-th poll fetches the newest page. */
export const LATEST_EVERY = 6;

/** Wait before the next poll after `failures` failures in a row (0 means the last poll worked). */
export function pollDelay(failures: number): number {
  if (failures <= 0) return POLL_INTERVAL_MS;
  return BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1];
}

/**
 * Which poll comes next. `sinceLatest` counts the polls since the newest page was last fetched;
 * `force` is set when the tab just became visible or the connection came back. Without a cursor
 * there is nothing to ask "after", so it is the newest page too.
 */
export function pollKind(options: { sinceLatest: number; force: boolean; hasCursor: boolean }): "after" | "latest" {
  if (options.force || !options.hasCursor) return "latest";
  return options.sinceLatest + 1 >= LATEST_EVERY ? "latest" : "after";
}

export function messagesUrl(groupId: string, query: { after?: string; before?: string } = {}): string {
  const base = `/groups/${encodeURIComponent(groupId)}/chat/messages`;
  if (query.after) return `${base}?after=${encodeURIComponent(query.after)}`;
  if (query.before) return `${base}?before=${encodeURIComponent(query.before)}`;
  return base;
}

/** The page when `value` has the shape of one, else null. */
export function parseChatPage(value: unknown): ChatPage | null {
  if (typeof value !== "object" || value === null) return null;
  const page = value as Partial<ChatPage>;
  if (!Array.isArray(page.messages) || typeof page.hasMore !== "boolean") return null;
  if (page.cursor !== null && typeof page.cursor !== "string") return null;
  const ok = page.messages.every(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      typeof m.id === "string" &&
      typeof m.clientId === "string" &&
      typeof m.body === "string" &&
      typeof m.createdAt === "string" &&
      typeof m.cursor === "string",
  );
  return ok ? (page as ChatPage) : null;
}

export type FetchOutcome =
  | { kind: "ok"; page: ChatPage }
  /** 404: removed from the group, or the group is gone. Stop asking. */
  | { kind: "gone" }
  /** The request was sent on to the log-in page: the session ended. */
  | { kind: "signed-out" }
  /** The network or the server failed; try again later. */
  | { kind: "error" }
  | { kind: "aborted" };

export async function fetchChatPage(
  groupId: string,
  query: { after?: string; before?: string },
  signal: AbortSignal,
): Promise<FetchOutcome> {
  try {
    const response = await fetch(messagesUrl(groupId, query), {
      cache: "no-store",
      signal,
      headers: { accept: "application/json" },
    });
    if (response.status === 404) return { kind: "gone" };
    if (response.redirected) return { kind: "signed-out" };
    if (!response.ok) return { kind: "error" };
    const page = parseChatPage(await response.json());
    return page ? { kind: "ok", page } : { kind: "error" };
  } catch {
    return signal.aborted ? { kind: "aborted" } : { kind: "error" };
  }
}
