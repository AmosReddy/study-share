import type { ChatPage } from "@/shared/chat-types";
import { REQUEST_TIMEOUT_MS, STALE_REQUEST_MS, IDLE_SLOW_AFTER_MS, nextPollDelay, pollKind, type FetchOutcome } from "./chat-poll";

/*
  The chat's polling loop without any browser or React in it: every browser thing it needs is passed
  in, so it is tested with fake timers. use-chat-poll.ts wires it to the document.

  Rules:
  - One request at a time, never overlapping.
  - Every 2.5 s while the page is visible; none while hidden. After a couple of minutes without any
    input in the page the interval stretches to 10 s, after ten minutes to 30 s. Any activity, or the
    tab becoming visible, snaps back to 2.5 s and polls at once.
  - Failures back off (5, 10, 20 s), never faster than the idle interval.
  - A request that has not answered within 15 s is cancelled and counts as a failure (a connection
    that went half-open, as after a network change or waking from sleep, never answers).
  - When the tab becomes visible or the network returns, a request that has been in flight for more
    than 5 s is abandoned and a fresh one starts.
  - A 404 or a redirect to log in stops the loop for good.
*/

export type PollKind = "after" | "latest";

export type PollerDeps = {
  /** One request. `cursor` is set for "after". Resolve "aborted" when `signal` aborts. */
  fetchPage(kind: PollKind, cursor: string | null, signal: AbortSignal): Promise<FetchOutcome>;
  /** The newest message's cursor and the ids held now, read when each request is made. */
  getView(): { cursor: string | null; known: readonly string[] };
  isVisible(): boolean;
  /** Milliseconds, any origin (Date.now). */
  now(): number;
  onPage(kind: PollKind, page: ChatPage, known: readonly string[]): void;
  onReconnecting(reconnecting: boolean): void;
  onGone(): void;
  onSignedOut(): void;
};

export type ChatPoller = {
  start(): void;
  stop(): void;
  /** The person did something in the page. */
  activity(): void;
  /** Call when the page's visibility changed. */
  visibilityChanged(): void;
  /** Call when the browser reports the network is back. */
  online(): void;
};

type Request = { controller: AbortController; startedAt: number; reason: "timeout" | "restart" | "stop" | null };

export function createChatPoller(deps: PollerDeps): ChatPoller {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let current: Request | null = null;
  let failures = 0;
  let sinceLatest = 0;
  // The first poll after starting (and after the tab comes back) fetches the newest page.
  let force = true;
  let lastActivity = deps.now();

  function clearTimer() {
    clearTimeout(timer);
    timer = undefined;
  }

  function schedule(delay: number) {
    clearTimer();
    if (!stopped) timer = setTimeout(() => void poll(), delay);
  }

  async function poll(): Promise<void> {
    timer = undefined;
    if (stopped || current || !deps.isVisible()) return;
    const request: Request = { controller: new AbortController(), startedAt: deps.now(), reason: null };
    current = request;
    const timeout = setTimeout(() => {
      request.reason = "timeout";
      request.controller.abort();
    }, REQUEST_TIMEOUT_MS);

    let delay = 0;
    try {
      const view = deps.getView();
      const kind = pollKind({ sinceLatest, force, hasCursor: view.cursor !== null });
      force = false;
      let outcome = await deps.fetchPage(kind, kind === "after" ? view.cursor : null, request.controller.signal);
      // Abandoned for a fresh request, or stopped: this answer is no longer wanted.
      if (stopped || request.reason === "restart" || request.reason === "stop") return;
      if (outcome.kind === "aborted") {
        if (request.reason !== "timeout") return;
        outcome = { kind: "error" };
      }

      let hasMore = false;
      switch (outcome.kind) {
        case "ok":
          failures = 0;
          deps.onReconnecting(false);
          if (kind === "latest") {
            sinceLatest = 0;
          } else {
            sinceLatest += 1;
            hasMore = outcome.page.hasMore;
          }
          deps.onPage(kind, outcome.page, view.known);
          break;
        case "gone":
          stopped = true;
          deps.onGone();
          return;
        case "signed-out":
          stopped = true;
          deps.onSignedOut();
          return;
        case "error":
          failures += 1;
          // A newest-page look that failed has not happened yet.
          if (kind === "latest") force = true;
          deps.onReconnecting(true);
          break;
      }
      // More newer messages are waiting: ask again straight away.
      delay = hasMore ? 0 : nextPollDelay({ failures, idleMs: deps.now() - lastActivity });
    } finally {
      clearTimeout(timeout);
      if (current === request) current = null;
    }
    schedule(delay);
  }

  /** Starts a poll now, first abandoning a request that has been waiting too long. */
  function pollNow() {
    clearTimer();
    if (current && deps.now() - current.startedAt > STALE_REQUEST_MS) {
      current.reason = "restart";
      current.controller.abort();
      current = null;
    }
    if (!current) void poll();
  }

  return {
    start() {
      void poll();
    },
    stop() {
      stopped = true;
      clearTimer();
      if (current) {
        current.reason = "stop";
        current.controller.abort();
      }
    },
    activity() {
      const now = deps.now();
      const idle = now - lastActivity;
      lastActivity = now;
      // Only a stretched interval needs waking; at 2.5 s the next poll is already close.
      if (idle >= IDLE_SLOW_AFTER_MS && !stopped && deps.isVisible()) {
        clearTimer();
        if (!current) void poll();
      }
    },
    visibilityChanged() {
      if (stopped) return;
      if (!deps.isVisible()) {
        clearTimer();
        return;
      }
      lastActivity = deps.now();
      force = true;
      pollNow();
    },
    online() {
      if (stopped) return;
      failures = 0;
      force = true;
      if (deps.isVisible()) pollNow();
    },
  };
}
