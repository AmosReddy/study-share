import { useSyncExternalStore } from "react";

/*
  Whether a group has private messages the person has not read, as the browser last learned it. The
  group layout works it out once when the page is first rendered, but a layout is not drawn again
  when the person moves between the group's tabs, so the screens that learn something newer (the
  Private list's polling, a page the server has just drawn) put it here and the tab bar and the
  Private switch read it from here. It is only a hint for a dot: a wrong value is never harmful and
  the next poll or page load corrects it. Nothing else is kept: no names, no keys.
*/

const known = new Map<string, boolean>();
const listeners = new Set<() => void>();

/** Tells every dot in the page that this group does (or does not) have unread private messages. */
export function setPrivateUnread(groupId: string, any: boolean): void {
  if (known.get(groupId) === any) return;
  known.set(groupId, any);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The latest known answer for the group, or `fallback` (what the server drew) until a screen has learned better. */
export function usePrivateUnread(groupId: string, fallback: boolean): boolean {
  return useSyncExternalStore(
    subscribe,
    () => known.get(groupId) ?? fallback,
    () => fallback,
  );
}
