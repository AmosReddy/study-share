import { useSyncExternalStore } from "react";
import type { PrivateUnreadState } from "@/shared/direct-chat-types";

/*
  What a person has not read in their private chats, as the browser last learned it: whether
  anything is unread, whose Members rows get a dot (by one-way chat key) and which conversations
  are unread (id and name, for the banner). The group layout is not drawn again when the person
  moves between the group's tabs, so the screens that learn something newer (the Private list's
  polling, the background check on every group page, a page the server has just drawn) put it here,
  and the tab bar, the Private switch, the Members rows and the banner read it from here. It is
  only a hint: a wrong value is never harmful and the next check or page load corrects it.

  Everything is keyed by the VIEWER (an opaque tag the server makes for the signed-in person, see
  viewerTokenFor) as well as the group, so a different person signing in on the same tab never
  inherits the last person's answer. Nothing but what the person's own summary holds is kept: no
  account ids.
*/

/** What nobody has learned yet. One shared object, so a hook that falls back to it has a stable snapshot. */
export const NOTHING_LEARNED: PrivateUnreadState = Object.freeze({ any: false, fromChatKeys: [], chats: [] }) as PrivateUnreadState;

const known = new Map<string, PrivateUnreadState>();
const listeners = new Set<() => void>();

const keyOf = (viewer: string, groupId: string) => `${viewer}:${groupId}`;

/** Tells every dot and banner in the page what this person has unread in the group. A repeat of the same answer changes nothing. */
export function setPrivateUnread(viewer: string, groupId: string, state: PrivateUnreadState): void {
  const key = keyOf(viewer, groupId);
  const current = known.get(key);
  if (current && JSON.stringify(current) === JSON.stringify(state)) return;
  known.set(key, { any: state.any, fromChatKeys: [...state.fromChatKeys], chats: state.chats.map((c) => ({ ...c })) });
  listeners.forEach((listener) => listener());
}

/** What was last learned for this person and group, or undefined when nothing was. */
export function readPrivateUnread(viewer: string, groupId: string): PrivateUnreadState | undefined {
  return known.get(keyOf(viewer, groupId));
}

/** Forgets everything (tests). */
export function clearPrivateUnread(): void {
  known.clear();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The latest known answer for the person and group, or `fallback` (what the server drew; keep it
 * the same object between renders, as props are) until a screen has learned better.
 */
export function usePrivateUnreadFor(viewer: string, groupId: string, fallback: PrivateUnreadState = NOTHING_LEARNED): PrivateUnreadState {
  return useSyncExternalStore(
    subscribe,
    () => readPrivateUnread(viewer, groupId) ?? fallback,
    () => fallback,
  );
}
