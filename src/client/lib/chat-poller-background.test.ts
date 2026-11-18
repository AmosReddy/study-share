import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrivateSummary } from "@/shared/direct-chat-types";
import {
  BACKGROUND_BACKOFF_MS,
  BACKGROUND_IDLE_SLOWER_MS,
  BACKGROUND_IDLE_SLOW_MS,
  BACKGROUND_POLL_MS,
  IDLE_SLOWER_AFTER_MS,
  IDLE_SLOW_AFTER_MS,
  nextBackgroundPollDelay,
  type FetchOutcome,
} from "./chat-poll";
import { createChatPoller } from "./chat-poller";

/*
  The background check for unread private messages (on every group page) is the chat's polling
  loop with a slower rhythm and a delayed first poll. These tests drive that loop with the real
  rhythm and fake timers.
*/

const summary: PrivateSummary = { chats: [], unread: { any: false, fromChatKeys: [] } };
const ok: FetchOutcome<PrivateSummary> = { kind: "ok", page: summary };

describe("nextBackgroundPollDelay", () => {
  it("is 10 s while the page is in use, 30 s after two minutes idle and 60 s after ten", () => {
    expect(BACKGROUND_POLL_MS).toBe(10_000);
    expect(nextBackgroundPollDelay({ failures: 0, idleMs: 0 })).toBe(10_000);
    expect(nextBackgroundPollDelay({ failures: 0, idleMs: IDLE_SLOW_AFTER_MS - 1 })).toBe(10_000);
    expect(nextBackgroundPollDelay({ failures: 0, idleMs: IDLE_SLOW_AFTER_MS })).toBe(BACKGROUND_IDLE_SLOW_MS);
    expect(BACKGROUND_IDLE_SLOW_MS).toBe(30_000);
    expect(nextBackgroundPollDelay({ failures: 0, idleMs: IDLE_SLOWER_AFTER_MS - 1 })).toBe(30_000);
    expect(nextBackgroundPollDelay({ failures: 0, idleMs: IDLE_SLOWER_AFTER_MS })).toBe(BACKGROUND_IDLE_SLOWER_MS);
    expect(BACKGROUND_IDLE_SLOWER_MS).toBe(60_000);
  });

  it("backs off after failures in a row (20, 40, then at most 60 s) and never goes faster than the idle rhythm", () => {
    expect(BACKGROUND_BACKOFF_MS).toEqual([20_000, 40_000, 60_000]);
    expect([1, 2, 3, 4, 9].map((failures) => nextBackgroundPollDelay({ failures, idleMs: 0 }))).toEqual([20_000, 40_000, 60_000, 60_000, 60_000]);
    expect(nextBackgroundPollDelay({ failures: 1, idleMs: IDLE_SLOWER_AFTER_MS })).toBe(60_000);
    expect(nextBackgroundPollDelay({ failures: 1, idleMs: IDLE_SLOW_AFTER_MS })).toBe(30_000);
  });
});

describe("the poller running the background rhythm", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-14T10:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  function setUp(outcome: () => FetchOutcome<PrivateSummary> = () => ok) {
    let visible = true;
    const requests: number[] = [];
    const events: string[] = [];
    const origin = Date.now();
    const poller = createChatPoller<PrivateSummary>({
      fetchPage: async () => {
        requests.push(Date.now() - origin);
        return outcome();
      },
      getView: () => ({ cursor: null, known: [] }),
      isVisible: () => visible,
      now: () => Date.now(),
      onPage: () => events.push("page"),
      onReconnecting: (r) => events.push(`reconnecting:${r}`),
      onGone: () => events.push("gone"),
      onSignedOut: () => events.push("signed-out"),
      nextDelay: nextBackgroundPollDelay,
      initialDelayMs: BACKGROUND_POLL_MS,
    });
    return {
      poller,
      requests,
      events,
      setVisible: (value: boolean) => {
        visible = value;
      },
    };
  }

  it("waits 10 s before the first check (the page was just drawn with fresh news), then checks every 10 s", async () => {
    const t = setUp();
    t.poller.start();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(t.requests).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.requests).toEqual([10_000]);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(t.requests).toEqual([10_000, 20_000, 30_000]);
    t.poller.stop();
  });

  it("slows to every 30 s after two minutes without input and wakes at once on activity", async () => {
    const t = setUp();
    t.poller.start();
    await vi.advanceTimersByTimeAsync(IDLE_SLOW_AFTER_MS + 40_000);
    const gaps = t.requests.slice(1).map((at, i) => at - t.requests[i]);
    expect(gaps[0]).toBe(10_000);
    expect(gaps[gaps.length - 1]).toBe(30_000);
    const before = t.requests.length;
    t.poller.activity();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.requests.length).toBe(before + 1);
    t.poller.stop();
  });

  it("makes no request while the tab is hidden, and checks at once when it is visible again", async () => {
    const t = setUp();
    t.poller.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.requests).toHaveLength(1);
    t.setVisible(false);
    t.poller.visibilityChanged();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(t.requests).toHaveLength(1);
    t.setVisible(true);
    t.poller.visibilityChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.requests).toHaveLength(2);
    t.poller.stop();
  });

  it("backs off quietly after failures and recovers", async () => {
    let failing = true;
    const t = setUp(() => (failing ? { kind: "error" } : ok));
    t.poller.start();
    await vi.advanceTimersByTimeAsync(10_000 + 20_000 + 40_000 + 60_000 + 1);
    expect(t.requests).toEqual([10_000, 30_000, 70_000, 130_000]);
    failing = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.events).toContain("reconnecting:false");
    t.poller.stop();
  });

  it("stops for good on a 404 or a redirect to log in", async () => {
    for (const kind of ["gone", "signed-out"] as const) {
      const t = setUp(() => ({ kind }));
      t.poller.start();
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.advanceTimersByTimeAsync(300_000);
      expect(t.requests).toHaveLength(1);
      expect(t.events).toContain(kind);
    }
  });
});
