import type { ChatPage } from "@/shared/chat-types";
import type { PrivateSummary } from "@/shared/direct-chat-types";

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

/** After this long with no input in the page the chat checks every IDLE_SLOW_DELAY_MS, after IDLE_SLOWER_AFTER_MS every IDLE_SLOWER_DELAY_MS. */
export const IDLE_SLOW_AFTER_MS = 2 * 60 * 1000;
export const IDLE_SLOW_DELAY_MS = 10_000;
export const IDLE_SLOWER_AFTER_MS = 10 * 60 * 1000;
export const IDLE_SLOWER_DELAY_MS = 30_000;

/** A poll that has not answered in this long is given up as a failure (a half-open connection never answers). */
export const REQUEST_TIMEOUT_MS = 15_000;
/** When the tab comes back or the network returns, a request that has been in flight longer than this is abandoned for a fresh one. */
export const STALE_REQUEST_MS = 5000;

/** Wait before the next poll after `failures` failures in a row (0 means the last poll worked). */
export function pollDelay(failures: number): number {
  if (failures <= 0) return POLL_INTERVAL_MS;
  return BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1];
}

/** The interval between polls for a page nobody has touched for `idleMs`: 2.5 s, then 10 s, then 30 s. */
export function idleDelay(idleMs: number): number {
  if (idleMs >= IDLE_SLOWER_AFTER_MS) return IDLE_SLOWER_DELAY_MS;
  if (idleMs >= IDLE_SLOW_AFTER_MS) return IDLE_SLOW_DELAY_MS;
  return POLL_INTERVAL_MS;
}

/** Wait before the next poll: the slower of the idle interval and the back-off after failures. */
export function nextPollDelay(options: { failures: number; idleMs: number }): number {
  return Math.max(pollDelay(options.failures), idleDelay(options.idleMs));
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

/** `base` with at most one cursor in its query. */
function withCursor(base: string, query: { after?: string; before?: string }): string {
  if (query.after) return `${base}?after=${encodeURIComponent(query.after)}`;
  if (query.before) return `${base}?before=${encodeURIComponent(query.before)}`;
  return base;
}

export function messagesUrl(groupId: string, query: { after?: string; before?: string } = {}): string {
  return withCursor(`/groups/${encodeURIComponent(groupId)}/chat/messages`, query);
}

/** A private conversation's messages route (the same shape of answer, plus whether the person may reply). */
export function directMessagesUrl(groupId: string, chatId: string, query: { after?: string; before?: string } = {}): string {
  return withCursor(`/groups/${encodeURIComponent(groupId)}/chat/private/${encodeURIComponent(chatId)}/messages`, query);
}

/** The route the Private list polls. */
export function privateSummaryUrl(groupId: string): string {
  return `/groups/${encodeURIComponent(groupId)}/chat/private/summary`;
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

/** A private conversation's page: a chat page that also says whether the person may still reply. Nobody has delete-any power there. */
export type DirectPollPage = ChatPage & { canSend: boolean };

export function parseDirectPage(value: unknown): DirectPollPage | null {
  const page = parseChatPage(value);
  if (!page) return null;
  const canSend = (value as { canSend?: unknown }).canSend;
  if (typeof canSend !== "boolean") return null;
  return { ...page, canDeleteAny: false, canSend };
}

/** The Private list's summary when `value` has the shape of one, else null. */
export function parsePrivateSummary(value: unknown): PrivateSummary | null {
  if (typeof value !== "object" || value === null) return null;
  const summary = value as Partial<PrivateSummary>;
  if (!Array.isArray(summary.chats) || typeof summary.unread !== "object" || summary.unread === null) return null;
  if (typeof summary.unread.any !== "boolean" || !Array.isArray(summary.unread.fromChatKeys)) return null;
  const ok = summary.chats.every(
    (c) =>
      typeof c === "object" &&
      c !== null &&
      typeof c.chatId === "string" &&
      typeof c.name === "string" &&
      typeof c.otherGone === "boolean" &&
      typeof c.preview === "string" &&
      typeof c.lastAt === "string" &&
      typeof c.unread === "boolean",
  );
  return ok ? (summary as PrivateSummary) : null;
}

export type FetchOutcome<P = ChatPage> =
  | { kind: "ok"; page: P }
  /** 404: removed from the group, or the group is gone. Stop asking. */
  | { kind: "gone" }
  /** The request was sent on to the log-in page: the session ended. */
  | { kind: "signed-out" }
  /** The network or the server failed; try again later. */
  | { kind: "error" }
  | { kind: "aborted" };

/** One GET of JSON, sorted into the outcomes the polling loop understands. `parse` answers null for a body of the wrong shape. */
export async function fetchPage<P>(url: string, parse: (value: unknown) => P | null, signal: AbortSignal): Promise<FetchOutcome<P>> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal,
      headers: { accept: "application/json" },
    });
    if (response.status === 404) return { kind: "gone" };
    if (response.redirected) return { kind: "signed-out" };
    if (!response.ok) return { kind: "error" };
    const page = parse(await response.json());
    return page ? { kind: "ok", page } : { kind: "error" };
  } catch {
    return signal.aborted ? { kind: "aborted" } : { kind: "error" };
  }
}

export function fetchChatPage(groupId: string, query: { after?: string; before?: string }, signal: AbortSignal): Promise<FetchOutcome> {
  return fetchPage(messagesUrl(groupId, query), parseChatPage, signal);
}

export function fetchDirectPage(
  groupId: string,
  chatId: string,
  query: { after?: string; before?: string },
  signal: AbortSignal,
): Promise<FetchOutcome<DirectPollPage>> {
  return fetchPage(directMessagesUrl(groupId, chatId, query), parseDirectPage, signal);
}

export function fetchPrivateSummary(groupId: string, signal: AbortSignal): Promise<FetchOutcome<PrivateSummary>> {
  return fetchPage(privateSummaryUrl(groupId), parsePrivateSummary, signal);
}
