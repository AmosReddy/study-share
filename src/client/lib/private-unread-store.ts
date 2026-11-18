import { useSyncExternalStore } from "react";

/*
  Whether a group has private messages the person has not read, as the browser last learned it. The
  group layout is not drawn again when the person moves between the group's tabs, so the screens
  that learn something newer (the Private list's polling, a page the server has just drawn) put it
  here and the tab bar and the Private switch read it from here. It is only a hint for a dot: a
  wrong value is never harmful and the next poll or page load corrects it.

  Everything is keyed by the VIEWER (an opaque tag the server makes for the signed-in person, see
  viewerTokenFor) as well as the group, so a different person signing in on the same tab never
  inherits the last person's answer. Nothing else is kept: no names, no chat keys.
*/

const known = new Map<string, boolean>();
const listeners = new Set<() => void>();

const keyOf = (viewer: string, groupId: string) => `${viewer}:${groupId}`;

/** Tells every dot in the page that this person does (or does not) have unread private messages in the group. */
export function setPrivateUnread(viewer: string, groupId: string, any: boolean): void {
  const key = keyOf(viewer, groupId);
  if (known.get(key) === any) return;
  known.set(key, any);
  listeners.forEach((listener) => listener());
}

/** What was last learned for this person and group, or undefined when nothing was. */
export function readPrivateUnread(viewer: string, groupId: string): boolean | undefined {
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

/** The latest known answer for the person and group, or `fallback` (what the server drew) until a screen has learned better. */
export function usePrivateUnreadFor(viewer: string, groupId: string, fallback: boolean): boolean {
  return useSyncExternalStore(
    subscribe,
    () => readPrivateUnread(viewer, groupId) ?? fallback,
    () => fallback,
  );
}
