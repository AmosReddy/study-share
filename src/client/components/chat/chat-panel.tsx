"use client";

import { ArrowDown } from "lucide-react";
import Link from "next/link";
import { flushSync } from "react-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type UIEvent,
} from "react";
import { Button, buttonVariants } from "@/client/components/ui/button";
import { chatItems, chatReducer, hasUnseen, initialChatState, newestSentAt } from "@/client/lib/chat-state";
import { formatMessageTime, groupRows } from "@/client/lib/chat-format";
import { fetchChatPage } from "@/client/lib/chat-poll";
import { newClientId } from "@/client/lib/client-id";
import { useNow } from "@/client/lib/use-now";
import type { ChatPage, DeleteMessageResult, SendMessageResult } from "@/shared/chat-types";
import type { FormAction } from "@/shared/form-state";
import { ChatComposer } from "./chat-composer";
import { ChatMessage } from "./chat-message";
import { useChatPoll } from "./use-chat-poll";
import { useFillViewport } from "./use-fill-viewport";

type ChatPanelProps = {
  groupId: string;
  /** The newest messages, rendered by the server. */
  initial: ChatPage;
  sendAction: (groupId: string, body: string, clientId: string) => Promise<SendMessageResult>;
  deleteAction: (groupId: string, messageId: string) => Promise<DeleteMessageResult>;
};

/** Within this many pixels of the end counts as "at the bottom". */
const NEAR_BOTTOM = 80;

/**
 * The group's chat. It starts from the page the server rendered and then keeps itself current by
 * polling (use-chat-poll.ts). The messages scroll inside a box that fills the screen above the
 * phone's tab bar, with the composer fixed at its bottom; the viewer stays at the newest message
 * unless they scrolled up, in which case a "New messages" button waits for them.
 */
export function ChatPanel({ groupId, initial, sendAction, deleteAction }: ChatPanelProps) {
  const [state, dispatch] = useReducer(chatReducer, initial, initialChatState);
  const [reconnecting, setReconnecting] = useState(false);
  const [stopped, setStopped] = useState<"gone" | "signed-out" | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [seenAt, setSeenAt] = useState("");

  const items = useMemo(() => chatItems(state), [state]);
  const rows = useMemo(() => groupRows(items), [items]);
  const now = useNow();

  const panelRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<string | null>(state.cursor);
  const itemsRef = useRef(items);
  const knownIdsRef = useRef<readonly string[]>(state.messages.map((m) => m.id));
  /** Whether the list is at its end: only then do new messages scroll into view by themselves. */
  const pinnedRef = useRef(true);
  /** Set when the viewer sends, so their own message scrolls into view even if they had scrolled up. */
  const stickRef = useRef(false);
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    cursorRef.current = state.cursor;
    knownIdsRef.current = state.messages.map((message) => message.id);
    itemsRef.current = items;
  });

  useFillViewport(panelRef);
  useChatPoll({
    groupId,
    cursorRef,
    knownIdsRef,
    dispatch,
    onReconnecting: setReconnecting,
    onGone: useCallback(() => setStopped("gone"), []),
    onSignedOut: useCallback(() => setStopped("signed-out"), []),
  });

  const lastKey = items.length > 0 ? items[items.length - 1].key : "";

  // To the newest message: when the chat opens, and whenever a different message becomes the last
  // one while the viewer is at the end (or has just sent it).
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const first = lastKeyRef.current === null;
    const changed = lastKeyRef.current !== lastKey;
    lastKeyRef.current = lastKey;
    if (!changed) return;
    if (first || pinnedRef.current || stickRef.current) list.scrollTop = list.scrollHeight;
    stickRef.current = false;
  }, [lastKey]);

  // The list changes height when the keyboard opens, the box grows or the window is resized: stay at the end if we were.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) list.scrollTop = list.scrollHeight;
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  function onScroll(event: UIEvent<HTMLDivElement>) {
    const list = event.currentTarget;
    const near = list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM;
    // Leaving the end: everything up to now has been seen, anything newer is "new".
    if (!near && pinnedRef.current) setSeenAt(newestSentAt(itemsRef.current));
    pinnedRef.current = near;
    setAtBottom(near);
  }

  function jumpToEnd() {
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight });
  }

  async function deliver(clientId: string, body: string) {
    try {
      const result = await sendAction(groupId, body, clientId);
      if (result.ok) {
        dispatch({ type: "sent", message: result.message });
      } else if (result.notFound) {
        dispatch({ type: "discard", clientId });
        setStopped("gone");
      } else {
        dispatch({ type: "failed", clientId, error: result.error });
      }
    } catch {
      dispatch({ type: "failed", clientId });
    }
  }

  function send(text: string) {
    const body = text.trim();
    if (body === "") return;
    const clientId = newClientId();
    stickRef.current = true;
    dispatch({ type: "queue", message: { clientId, body, createdAt: new Date().toISOString(), status: "sending" } });
    void deliver(clientId, body);
  }

  function retry(clientId: string, body: string) {
    stickRef.current = true;
    dispatch({ type: "retry", clientId });
    // The same clientId: if the first try did reach the server, it answers with that message.
    void deliver(clientId, body);
  }

  async function loadEarlier() {
    const list = listRef.current;
    const oldest = state.messages[0];
    if (!list || !oldest || loadingOlder) return;
    setLoadingOlder(true);
    setOlderFailed(false);
    const outcome = await fetchChatPage(groupId, { before: oldest.cursor }, new AbortController().signal);
    setLoadingOlder(false);
    if (outcome.kind === "gone") return setStopped("gone");
    if (outcome.kind === "signed-out") return setStopped("signed-out");
    if (outcome.kind !== "ok") return setOlderFailed(true);
    // Add the page above and keep the same messages in view: the list grew upwards by the difference.
    const before = { height: list.scrollHeight, top: list.scrollTop };
    flushSync(() => dispatch({ type: "before", page: outcome.page }));
    list.scrollTop = before.top + (list.scrollHeight - before.height);
  }

  // One action for every delete sheet; the message id comes with the form.
  const removeAction = useCallback<FormAction>(
    async (_previous, form) => {
      const id = form.get("messageId");
      const result = await deleteAction(groupId, typeof id === "string" ? id : "");
      // A message that is gone already is as good as deleted.
      if (result.ok || result.notFound) return { status: "done" };
      return { status: "error", formError: result.error };
    },
    [deleteAction, groupId],
  );

  if (stopped) return <ChatStopped reason={stopped} groupId={groupId} />;

  const showNewMessages = !atBottom && hasUnseen(items, seenAt);

  return (
    <section
      ref={panelRef}
      aria-label="Chat"
      // The height shown until useFillViewport measures; the negative margin gives back the space
      // the group page keeps under its content for the phone's tab bar, so the page does not scroll.
      className="relative flex h-[calc(100dvh-18rem)] min-h-72 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground -mb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:-mb-8"
    >
      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          role="log"
          aria-live="polite"
          aria-label="Messages"
          tabIndex={0}
          onScroll={onScroll}
          // The page scrolls nothing else; prepending is anchored by hand in loadEarlier.
          style={{ overflowAnchor: "none" }}
          className="h-full overflow-y-auto overscroll-contain px-3 py-3 outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          {state.hasOlder ? (
            <div className="mb-3 flex flex-col items-center gap-1">
              <Button
                type="button"
                variant="outline"
                disabled={loadingOlder}
                onClick={() => void loadEarlier()}
                className="h-11 px-4 text-base"
              >
                {loadingOlder ? "Loading…" : "Load earlier messages"}
              </Button>
              {olderFailed ? <p className="text-sm text-destructive">Couldn&apos;t load earlier messages. Try again.</p> : null}
            </div>
          ) : null}
          {rows.length === 0 ? (
            <p className="px-2 py-10 text-center text-muted-foreground">No messages yet. Say hello to the group.</p>
          ) : (
            <ul className="flex flex-col">
              {rows.map((row) => (
                <ChatMessage
                  key={row.item.key}
                  row={row}
                  groupId={groupId}
                  timeText={now ? formatMessageTime(row.item.createdAt, now) : ""}
                  canDeleteAny={state.canDeleteAny}
                  deleteAction={removeAction}
                  onDeleted={(id) => dispatch({ type: "remove", id })}
                  onRetry={retry}
                  onDiscard={(clientId) => dispatch({ type: "discard", clientId })}
                />
              ))}
            </ul>
          )}
        </div>
        {showNewMessages ? (
          <Button
            type="button"
            onClick={jumpToEnd}
            className="absolute bottom-3 left-1/2 h-11 -translate-x-1/2 gap-2 rounded-full px-4 text-base shadow-md"
          >
            <ArrowDown className="size-4" aria-hidden="true" />
            New messages
          </Button>
        ) : null}
      </div>
      {reconnecting ? (
        <p role="status" className="border-t px-3 py-1 text-xs text-muted-foreground">
          Reconnecting…
        </p>
      ) : null}
      <ChatComposer onSend={send} />
    </section>
  );
}

function ChatStopped({ reason, groupId }: { reason: "gone" | "signed-out"; groupId: string }) {
  return (
    <section
      aria-label="Chat"
      role="status"
      className="flex flex-col items-center gap-3 rounded-xl border px-4 py-10 text-center"
    >
      {reason === "gone" ? (
        <>
          <h2 className="text-lg font-semibold">You can no longer see this chat</h2>
          <p className="max-w-md text-muted-foreground">
            You may have been removed from the group, or the group may have been deleted.
          </p>
          <Link href="/" className={buttonVariants({ className: "h-11 px-5 text-base" })}>
            Go to your groups
          </Link>
        </>
      ) : (
        <>
          <h2 className="text-lg font-semibold">You were signed out</h2>
          <p className="max-w-md text-muted-foreground">Log in again to keep chatting.</p>
          {/* A full page load, so the server sends the person to log in and back here. */}
          <a href={`/groups/${encodeURIComponent(groupId)}/chat`} className={buttonVariants({ className: "h-11 px-5 text-base" })}>
            Log in again
          </a>
        </>
      )}
    </section>
  );
}
