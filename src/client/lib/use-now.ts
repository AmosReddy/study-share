import { useSyncExternalStore } from "react";

/*
  The browser's clock, to the minute, for text that depends on "today" (a message's time). It is 0
  on the server and during hydration, so nothing that reads it can differ between the server's HTML
  and the browser's first render, and no component reads the clock while rendering: the clock is
  only read here, by the store, in the browser. It ticks once a minute, so "today" rolls over at
  midnight without a reload.
*/

const MINUTE = 60_000;
let current = 0;
const listeners = new Set<() => void>();

function readClock(): number {
  return Math.floor(Date.now() / MINUTE) * MINUTE;
}

function tick() {
  const next = readClock();
  if (next === current) return;
  current = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  tick();
  const timer = setInterval(tick, 15_000);
  return () => {
    listeners.delete(listener);
    clearInterval(timer);
  };
}

function snapshot(): number {
  if (current === 0) current = readClock();
  return current;
}

/** Milliseconds since 1970 at the start of this minute, or 0 on the server and while hydrating. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}
