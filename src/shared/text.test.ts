import { describe, expect, it } from "vitest";
import { isWellFormedText, toWellFormedText } from "./text";

describe("well-formed text without the native methods", () => {
  const proto = String.prototype as unknown as Record<string, unknown>;

  function without<T>(run: () => T): T {
    const [a, b] = [proto.isWellFormed, proto.toWellFormed];
    proto.isWellFormed = undefined;
    proto.toWellFormed = undefined;
    try {
      return run();
    } finally {
      proto.isWellFormed = a;
      proto.toWellFormed = b;
    }
  }

  it("agrees with the native methods", () => {
    for (const text of ["", "plain", "\ud83d\ude00", "a\ud800", "\udc00b", "\ud800\ud800", "\ud83d\ude00\udc00", "x\ud83d"]) {
      expect(without(() => isWellFormedText(text)), JSON.stringify(text)).toBe(text.isWellFormed());
      expect(without(() => toWellFormedText(text)), JSON.stringify(text)).toBe(text.toWellFormed());
    }
  });
});
