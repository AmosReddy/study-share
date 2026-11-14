import { useCallback, useEffect, useRef, type Dispatch } from "react";
import type { ChatAction } from "@/client/lib/chat-state";
import { fetchChatPage } from "@/client/lib/chat-poll";
import { createChatPoller, type ChatPoller } from "@/client/lib/chat-poller";

type Options = {
  groupId: string;
  /** Where the next poll starts from and which messages are held, read when each request is made. */
  getView: () => { cursor: string | null; known: readonly string[] };
  dispatch: Dispatch<ChatAction>;
  /** True while polls are failing and being retried; false once one works. */
  onReconnecting: (reconnecting: boolean) => void;
  /** The server said the person may no longer see this chat (404). Polling has stopped. */
  onGone: () => void;
  /** The request was sent on to log in. Polling has stopped. */
  onSignedOut: () => void;
};

/** What counts as the person being there: any of these in the page wakes a slowed-down chat. */
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "focusin"] as const;

/**
 * Keeps the chat fresh while the panel is mounted, with the loop in src/client/lib/chat-poller.ts
 * (one request at a time, 2.5 s while visible and in use, slower when nobody touches the page,
 * back-off, a 15 s timeout, 404 stops everything). This only connects it to the page: visibility,
 * the network coming back and the person's input. Next hides a page the person left (it stays
 * mounted but its effects are torn down), so polling also stops there and starts again, with a
 * fresh look at the newest page, when they come back.
 *
 * Returns `markActive` for the panel to call when the person does something (sending counts).
 */
export function useChatPoll({ groupId, getView, dispatch, onReconnecting, onGone, onSignedOut }: Options) {
  // The latest callbacks, without restarting the loop when they change.
  const callbacks = useRef({ getView, onReconnecting, onGone, onSignedOut });
  useEffect(() => {
    callbacks.current = { getView, onReconnecting, onGone, onSignedOut };
  });
  const pollerRef = useRef<ChatPoller | null>(null);

  useEffect(() => {
    const poller = createChatPoller({
      fetchPage: (kind, cursor, signal) => fetchChatPage(groupId, kind === "after" && cursor ? { after: cursor } : {}, signal),
      getView: () => callbacks.current.getView(),
      isVisible: () => document.visibilityState === "visible",
      now: () => Date.now(),
      onPage: (kind, page, known) => dispatch(kind === "latest" ? { type: "latest", page, known } : { type: "after", page }),
      onReconnecting: (reconnecting) => callbacks.current.onReconnecting(reconnecting),
      onGone: () => callbacks.current.onGone(),
      onSignedOut: () => callbacks.current.onSignedOut(),
    });
    pollerRef.current = poller;

    const onVisibility = () => poller.visibilityChanged();
    const onOnline = () => poller.online();
    const onActivity = () => poller.activity();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    for (const name of ACTIVITY_EVENTS) document.addEventListener(name, onActivity, { passive: true, capture: true });
    // Scrolling inside the message list does not bubble to the document, so listen in the capture phase.
    document.addEventListener("scroll", onActivity, { passive: true, capture: true });
    poller.start();

    return () => {
      poller.stop();
      pollerRef.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      for (const name of ACTIVITY_EVENTS) document.removeEventListener(name, onActivity, { capture: true });
      document.removeEventListener("scroll", onActivity, { capture: true });
    };
  }, [groupId, dispatch]);

  return useCallback(() => pollerRef.current?.activity(), []);
}
