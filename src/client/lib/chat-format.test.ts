import { describe, expect, it } from "vitest";
import { formatMessageTime, groupRows, GROUP_GAP_MS } from "./chat-format";
import type { ChatItem } from "./chat-state";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 14, 10, 0) + minute * 60_000).toISOString();

function item(key: string, minute: number, overrides: Partial<ChatItem> = {}): ChatItem {
  return { key, body: key, senderName: "Ravi", mine: false, canDelete: false, createdAt: at(minute), status: "sent", ...overrides };
}

describe("groupRows", () => {
  it("starts a group at the first message and when the sender changes", () => {
    const rows = groupRows([
      item("a", 0),
      item("b", 1),
      item("c", 2, { senderName: "Meera" }),
      item("d", 3, { mine: true, senderName: "Asha" }),
      item("e", 4, { mine: true, senderName: "Asha" }),
      item("f", 5),
    ]);
    expect(rows.map((row) => row.startsGroup)).toEqual([true, false, true, true, false, true]);
  });

  it("starts a new group after a gap of more than the window, not at exactly the window", () => {
    const edge = GROUP_GAP_MS / 60_000;
    const rows = groupRows([item("a", 0), item("b", edge), item("c", edge + edge + 1)]);
    expect(rows.map((row) => row.startsGroup)).toEqual([true, false, true]);
  });

  it("treats the same name as the same sender and another name as another", () => {
    expect(groupRows([item("a", 0), item("b", 1, { senderName: "Former member" })]).map((r) => r.startsGroup)).toEqual([true, true]);
    const former = { senderName: "Former member" };
    expect(groupRows([item("a", 0, former), item("b", 1, former)]).map((r) => r.startsGroup)).toEqual([true, false]);
  });

  it("returns nothing for nothing", () => {
    expect(groupRows([])).toEqual([]);
  });
});

describe("formatMessageTime", () => {
  const now = Date.UTC(2026, 10, 14, 12, 0);

  it("shows only the clock for today, in the given zone", () => {
    expect(formatMessageTime("2026-11-14T10:42:00.000Z", now, "UTC")).toBe("10:42");
    expect(formatMessageTime("2026-11-14T10:42:00.000Z", now, "Asia/Kolkata")).toBe("16:12");
  });

  it("adds the date for another day of the same year", () => {
    expect(formatMessageTime("2026-11-13T10:42:00.000Z", now, "UTC")).toBe("13 Nov, 10:42");
  });

  it("adds the year for another year", () => {
    expect(formatMessageTime("2025-11-14T10:42:00.000Z", now, "UTC")).toBe("14 Nov 2025, 10:42");
  });

  it("compares days in the viewer's zone, not in UTC", () => {
    // 23:30 UTC on the 13th is already the 14th in India, so it is today there but yesterday in UTC.
    const iso = "2026-11-13T23:30:00.000Z";
    expect(formatMessageTime(iso, now, "Asia/Kolkata")).toBe("05:00");
    expect(formatMessageTime(iso, now, "UTC")).toBe("13 Nov, 23:30");
  });

  it("uses 24-hour time with a leading zero", () => {
    expect(formatMessageTime("2026-11-14T09:05:00.000Z", now, "UTC")).toBe("09:05");
  });

  it("gives an empty text for something that is not a time", () => {
    expect(formatMessageTime("not a time", now, "UTC")).toBe("");
  });
});
