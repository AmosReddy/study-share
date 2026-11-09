import { describe, expect, it } from "vitest";
import { describeForLog } from "./describe-error";

describe("describeForLog", () => {
  it("gives the error's name and message", () => {
    expect(describeForLog(new TypeError("fetch failed"))).toBe("TypeError: fetch failed");
  });

  it("removes addresses, which can carry passwords or tokens", () => {
    const error = new Error("connect to postgres://user:secret@db.example:5432/x failed, see https://a.example/?token=abc");
    expect(describeForLog(error)).toBe("Error: connect to <url removed> failed, see <url removed>");
  });

  it("says nothing about values that are not errors", () => {
    expect(describeForLog("token=abc")).toBe("unknown error");
    expect(describeForLog(undefined)).toBe("unknown error");
  });
});
