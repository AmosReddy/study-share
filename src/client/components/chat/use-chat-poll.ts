import { useEffect, useRef, type Dispatch, type RefObject } from "react";
import type { ChatAction } from "@/client/lib/chat-state";
import { fetchChatPage, pollDelay, pollKind } from "@/client/lib/chat-poll";

type Options = {
  groupId: string;
  /** Where the next poll starts from (read at each poll, so it is always the latest). */
  cursorRef: RefObject<string | null>;
  /** The ids of the messages held now, so a look at the newest page can tell a deleted message from a new one. */
  knownIdsRef: RefObject<readonly string[]>;
  dispatch: Dispatch<ChatAction>;
  /** True while polls are failing and being retried; false once one works. */
  onReconnecting: (reconnecting: boolean) => void;
  /** The server said the person may no longer see this chat (404). Polling has stopped. */
  onGone: () => void;
  /** The request was sent on to log in. Polling has stopped. */
  onSignedOut: () => void;
};

/**
 * Keeps the chat fresh while the panel is mounted: one poll at a time (never overlapping), every
 * 2.5 s while the tab is visible, none while it is hidden, one at once when it becomes visible
 * again or the connection returns. Failures back off (5, 10, 20 s) and say "Reconnecting"; a 404
 * stops everything. Unmounting aborts the request in flight. Next hides a page the person left
 * (it stays mounted but its effects are torn down), so polling also stops there and starts again,
 * with a fresh look at the newest page, when they come back.
 */
export function useChatPoll({ groupId, cursorRef, knownIdsRef, dispatch, onReconnecting, onGone, onSignedOut }: Options) {
  // The latest callbacks, without restarting the loop when they change.
  const callbacks = useRef({ onReconnecting, onGone, onSignedOut });
  useEffect(() => {
    callbacks.current = { onReconnecting, onGone, onSignedOut };
  });

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let stopped = false;
    let failures = 0;
    let sinceLatest = 0;
    // The first poll after starting (and after the tab comes back) fetches the newest page.
    let force = true;

    function schedule(delay: number) {
      clearTimeout(timer);
      timer = stopped ? undefined : setTimeout(poll, delay);
    }

    async function poll() {
      timer = undefined;
      if (stopped || running || document.visibilityState !== "visible") return;
      running = true;
      let delay = pollDelay(0);
      try {
        const cursor = cursorRef.current;
        const known = knownIdsRef.current;
        const kind = pollKind({ sinceLatest, force, hasCursor: cursor !== null });
        force = false;
        const outcome = await fetchChatPage(groupId, kind === "after" && cursor ? { after: cursor } : {}, controller.signal);
        if (controller.signal.aborted) return;
        switch (outcome.kind) {
          case "ok":
            failures = 0;
            callbacks.current.onReconnecting(false);
            if (kind === "latest") {
              sinceLatest = 0;
              dispatch({ type: "latest", page: outcome.page, known });
            } else {
              sinceLatest += 1;
              dispatch({ type: "after", page: outcome.page });
              // More newer messages are waiting: ask again straight away.
              if (outcome.page.hasMore) delay = 0;
            }
            break;
          case "gone":
            stopped = true;
            callbacks.current.onGone();
            return;
          case "signed-out":
            stopped = true;
            callbacks.current.onSignedOut();
            return;
          case "error":
            failures += 1;
            callbacks.current.onReconnecting(true);
            delay = pollDelay(failures);
            break;
          case "aborted":
            return;
        }
      } finally {
        running = false;
      }
      schedule(delay);
    }

    function onVisibility() {
      clearTimeout(timer);
      timer = undefined;
      if (document.visibilityState !== "visible") return;
      force = true;
      if (!running) void poll();
    }

    function onOnline() {
      failures = 0;
      force = true;
      clearTimeout(timer);
      timer = undefined;
      if (!running) void poll();
    }

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    void poll();

    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [groupId, cursorRef, knownIdsRef, dispatch]);
}
