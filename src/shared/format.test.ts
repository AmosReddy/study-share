import { describe, expect, it } from "vitest";
import { formatBytes, formatFileDate } from "./format";

describe("formatBytes", () => {
  it("writes bytes, KB and MB the way people read them", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(812)).toBe("812 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(15 * 1024)).toBe("15 KB");
    expect(formatBytes(2.4 * 1024 * 1024)).toBe("2.4 MB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3 GB");
  });

  it("moves up a unit instead of printing 1024 of the one below", () => {
    expect(formatBytes(1024 * 1024 - 1)).toBe("1 MB");
    expect(formatBytes(1024 * 1024 * 1024 - 1)).toBe("1 GB");
  });

  it("copes with values that are not sizes", () => {
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
  });
});

describe("formatFileDate", () => {
  it("prints the UTC day in a fixed format", () => {
    expect(formatFileDate("2026-11-14T00:10:09.000Z")).toBe("14 Nov 2026");
    expect(formatFileDate("2026-01-05T23:59:59.000Z")).toBe("5 Jan 2026");
  });

  it("gives an empty string for text that is not a date", () => {
    expect(formatFileDate("yesterday")).toBe("");
    expect(formatFileDate("")).toBe("");
  });
});
