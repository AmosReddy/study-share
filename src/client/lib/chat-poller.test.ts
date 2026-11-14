import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatPage } from "@/shared/chat-types";
import { createChatPoller, type PollKind } from "./chat-poller";
import type { FetchOutcome } from "./chat-poll";

const page = (hasMore = false): ChatPage => ({ messages: [], hasMore, cursor: "c1", canDeleteAny: false });

type Call = { kind: PollKind; cursor: string | null; signal: AbortSignal; resolve: (outcome: FetchOutcome) => void };

/** A poller whose requests are answered by the test, one at a time, and whose events are recorded. */
function setUp(options: { cursor?: string | null; visible?: boolean } = {}) {
  const calls: Call[] = [];
  const events: string[] = [];
  let visible = options.visible ?? true;
  let inFlight = 0;
  let maxInFlight = 0;
  const poller = createChatPoller({
    fetchPage: (kind, cursor, signal) =>
      new Promise<FetchOutcome>((resolve) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const done = (outcome: FetchOutcome) => {
          inFlight -= 1;
          resolve(outcome);
        };
        calls.push({ kind, cursor, signal, resolve: done });
        // Like fetch: an aborted request ends with "aborted".
        signal.addEventListener("abort", () => done({ kind: "aborted" }), { once: true });
      }),
    getView: () => ({ cursor: options.cursor === undefined ? "c0" : options.cursor, known: ["m1"] }),
    isVisible: () => visible,
    now: () => Date.now(),
    onPage: (kind, _page, known) => events.push(`page:${kind}:${known.join(",")}`),
    onReconnecting: (reconnecting) => events.push(`reconnecting:${reconnecting}`),
    onGone: () => events.push("gone"),
    onSignedOut: () => events.push("signed-out"),
  });
  return {
    poller,
    calls,
    events,
    maxInFlight: () => maxInFlight,
    setVisible: (value: boolean) => {
      visible = value;
    },
    /** Answers the newest request and lets the loop go on. */
    async answer(outcome: FetchOutcome) {
      calls[calls.length - 1].resolve(outcome);
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

const ok = (hasMore = false): FetchOutcome => ({ kind: "ok", page: page(hasMore) });
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

/** Answers every request at once and returns how long the loop waited before each of the next ones. */
async function waits(t: ReturnType<typeof setUp>, upTo: number) {
  const starts: number[] = [];
  let seen = 0;
  const origin = Date.now();
  while (Date.now() - origin < upTo) {
    if (t.calls.length > seen) {
      seen = t.calls.length;
      starts.push(Date.now() - origin);
      await t.answer(ok());
    }
    await advance(100);
  }
  if (t.calls.length > seen) {
    starts.push(Date.now() - origin);
    await t.answer(ok());
  }
  return starts;
}


beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-14T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("the polling loop", () => {
  it("starts with the newest page, then asks after the cursor every 2.5 s, and the sixth poll is the newest page again", async () => {
    const t = setUp();
    t.poller.start();
    expect(t.calls.map((c) => c.kind)).toEqual(["latest"]);
    await t.answer(ok());
    const kinds: PollKind[] = [];
    for (let n = 0; n < 6; n++) {
      await advance(2499);
      expect(t.calls.length).toBe(n + 1);
      await advance(1);
      expect(t.calls.length).toBe(n + 2);
      kinds.push(t.calls[n + 1].kind);
      expect(t.calls[n + 1].cursor).toBe(t.calls[n + 1].kind === "after" ? "c0" : null);
      await t.answer(ok());
    }
    expect(kinds).toEqual(["after", "after", "after", "after", "after", "latest"]);
    t.poller.stop();
  });

  it("passes the held ids from when the request was made with the page", async () => {
    const t = setUp();
    t.poller.start();
    await t.answer(ok());
    expect(t.events).toEqual(["reconnecting:false", "page:latest:m1"]);
    t.poller.stop();
  });

  it("never has two requests in flight, however many events arrive", async () => {
    const t = setUp();
    t.poller.start();
    t.poller.start();
    t.poller.activity();
    t.poller.visibilityChanged();
    t.poller.online();
    expect(t.calls.length).toBe(1);
    await t.answer(ok());
    await advance(60_000);
    await t.answer(ok());
    expect(t.maxInFlight()).toBe(1);
    t.poller.stop();
  });

  it("asks again at once when the answer says more newer messages wait", async () => {
    const t = setUp();
    t.poller.start();
    await t.answer(ok());
    await advance(2500);
    expect(t.calls[1].kind).toBe("after");
    await t.answer(ok(true));
    expect(t.calls.length).toBe(3);
    t.poller.stop();
  });
});

describe("failures", () => {
  it("backs off 5, 10, 20, 20 s with a Reconnecting note, and a success clears it", async () => {
    const t = setUp();
    t.poller.start();
    for (const wait of [5000, 10_000, 20_000, 20_000]) {
      const before = t.calls.length;
      await t.answer({ kind: "error" });
      await advance(wait - 1);
      expect(t.calls.length).toBe(before);
      await advance(1);
      expect(t.calls.length).toBe(before + 1);
    }
    expect(t.events.filter((e) => e === "reconnecting:true")).toHaveLength(4);
    await t.answer(ok());
    expect(t.events.at(-1)).toBe("page:latest:m1");
    expect(t.events).toContain("reconnecting:false");
    // Back to the normal pace.
    const before = t.calls.length;
    await advance(2500);
    expect(t.calls.length).toBe(before + 1);
    t.poller.stop();
  });

  it("counts a request that never answers as a failure after 15 s, aborts it and backs off", async () => {
    const t = setUp();
    t.poller.start();
    await advance(14_999);
    expect(t.calls[0].signal.aborted).toBe(false);
    expect(t.events).toEqual([]);
    await advance(1);
    expect(t.calls[0].signal.aborted).toBe(true);
    expect(t.events).toEqual(["reconnecting:true"]);
    // The first back-off is 5 s.
    await advance(4999);
    expect(t.calls.length).toBe(1);
    await advance(1);
    expect(t.calls.length).toBe(2);
    t.poller.stop();
  });

  it("does not time out a request that answered in time", async () => {
    const t = setUp();
    t.poller.start();
    await advance(14_000);
    await t.answer(ok());
    await advance(60_000);
    expect(t.calls[0].signal.aborted).toBe(false);
    t.poller.stop();
  });

  it("stops for good on a 404 and on a redirect to log in", async () => {
    const gone = setUp();
    gone.poller.start();
    await gone.answer({ kind: "gone" });
    await advance(120_000);
    expect(gone.calls.length).toBe(1);
    expect(gone.events).toEqual(["gone"]);

    const out = setUp();
    out.poller.start();
    await out.answer({ kind: "signed-out" });
    await advance(120_000);
    expect(out.calls.length).toBe(1);
    expect(out.events).toEqual(["signed-out"]);
  });
});

describe("visibility and the network", () => {
  it("does not poll while hidden and polls at once, for the newest page, when visible again", async () => {
    const t = setUp();
    t.poller.start();
    await t.answer(ok());
    t.setVisible(false);
    t.poller.visibilityChanged();
    await advance(120_000);
    expect(t.calls.length).toBe(1);
    t.setVisible(true);
    t.poller.visibilityChanged();
    expect(t.calls.length).toBe(2);
    expect(t.calls[1].kind).toBe("latest");
    t.poller.stop();
  });

  it("lets a request in flight when the tab was hidden finish without scheduling more", async () => {
    const t = setUp();
    t.poller.start();
    t.setVisible(false);
    t.poller.visibilityChanged();
    await t.answer(ok());
    await advance(60_000);
    expect(t.calls.length).toBe(1);
    t.poller.stop();
  });

  it("keeps a request that has been in flight under 5 s when the tab comes back, and abandons an older one for a fresh poll", async () => {
    const t = setUp();
    t.poller.start();
    await advance(4000);
    t.poller.visibilityChanged();
    expect(t.calls.length).toBe(1);
    expect(t.calls[0].signal.aborted).toBe(false);

    await advance(2000);
    t.poller.visibilityChanged();
    expect(t.calls[0].signal.aborted).toBe(true);
    expect(t.calls.length).toBe(2);
    // The abandoned request is not a failure, and its late answer changes nothing.
    t.calls[0].resolve(ok());
    await advance(0);
    expect(t.events).toEqual([]);
    expect(t.maxInFlight()).toBe(1);
    await t.answer(ok());
    expect(t.events).toEqual(["reconnecting:false", "page:latest:m1"]);
    t.poller.stop();
  });

  it("does the same when the network comes back, and clears the back-off", async () => {
    const t = setUp();
    t.poller.start();
    await t.answer({ kind: "error" });
    await t.answer({ kind: "error" }).catch(() => undefined);
    await advance(5000);
    await t.answer({ kind: "error" });
    // Now waiting 10 s. The network returns: poll at once.
    const before = t.calls.length;
    t.poller.online();
    expect(t.calls.length).toBe(before + 1);
    await t.answer(ok());
    await advance(2500);
    expect(t.calls.length).toBe(before + 2);
    t.poller.stop();
  });

  it("abandons a hung request when the network returns", async () => {
    const t = setUp();
    t.poller.start();
    await advance(6000);
    t.poller.online();
    expect(t.calls[0].signal.aborted).toBe(true);
    expect(t.calls.length).toBe(2);
    t.poller.stop();
  });
});

describe("idle slow-down", () => {
  it("polls every 2.5 s for two minutes, then every 10 s, then after ten minutes every 30 s", async () => {
    const t = setUp();
    t.poller.start();
    const starts = await waits(t, 14 * 60_000);
    const gaps = starts.slice(1).map((at, i) => at - starts[i]);
    const gapAt = (ms: number) => gaps[starts.slice(1).findIndex((at) => at >= ms)];
    expect(gapAt(60_000)).toBeLessThanOrEqual(2600);
    expect(gapAt(130_000)).toBeGreaterThanOrEqual(9900);
    expect(gapAt(130_000)).toBeLessThanOrEqual(10_100);
    expect(gapAt(500_000)).toBeLessThanOrEqual(10_100);
    expect(gapAt(700_000)).toBeGreaterThanOrEqual(29_900);
    expect(gapAt(700_000)).toBeLessThanOrEqual(30_100);
    t.poller.stop();
  });

  it("snaps back at once on any activity after being idle, and to 2.5 s afterwards", async () => {
    const t = setUp();
    t.poller.start();
    await waits(t, 11 * 60_000);
    const before = t.calls.length;
    // A 30 s wait is running. The person touches the page.
    await advance(5000);
    expect(t.calls.length).toBe(before);
    t.poller.activity();
    expect(t.calls.length).toBe(before + 1);
    await t.answer(ok());
    await advance(2500);
    expect(t.calls.length).toBe(before + 2);
    t.poller.stop();
  });

  it("does not poll more often for busy input before the page is idle (cheap handler)", async () => {
    const t = setUp();
    t.poller.start();
    await t.answer(ok());
    for (let n = 0; n < 50; n++) {
      t.poller.activity();
      await advance(1000);
    }
    // 50 s of constant activity: polls follow the 2.5 s clock only.
    expect(t.calls.length).toBeLessThanOrEqual(1 + 20);
    t.poller.stop();
  });

  it("treats the tab becoming visible as activity", async () => {
    const t = setUp();
    t.poller.start();
    await waits(t, 3 * 60_000);
    t.setVisible(false);
    t.poller.visibilityChanged();
    await advance(60_000);
    t.setVisible(true);
    t.poller.visibilityChanged();
    const before = t.calls.length;
    await t.answer(ok());
    await advance(2500);
    expect(t.calls.length).toBe(before + 1);
    t.poller.stop();
  });

  it("never goes faster than the back-off while idle, and slower still when both apply", async () => {
    const t = setUp();
    t.poller.start();
    await waits(t, 3 * 60_000);
    // The request now waiting is answered with a failure.
    await advance(10_000);
    await t.answer({ kind: "error" });
    // Idle gives 10 s, the first back-off 5 s: the slower wins.
    const before = t.calls.length;
    await advance(9999);
    expect(t.calls.length).toBe(before);
    await advance(1);
    expect(t.calls.length).toBe(before + 1);
    t.poller.stop();
  });
});

describe("stopping", () => {
  it("aborts the request in flight, ignores its answer and starts nothing more", async () => {
    const t = setUp();
    t.poller.start();
    t.poller.stop();
    expect(t.calls[0].signal.aborted).toBe(true);
    await advance(0);
    t.poller.activity();
    t.poller.visibilityChanged();
    t.poller.online();
    await advance(60_000);
    expect(t.calls.length).toBe(1);
    expect(t.events).toEqual([]);
  });
});
