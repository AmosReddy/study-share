import { describe, expect, it } from "vitest";
import { clientIp } from "./request-ip";

describe("clientIp", () => {
  it("is empty when the header is missing or blank", () => {
    expect(clientIp(null)).toBe("");
    expect(clientIp(undefined)).toBe("");
    expect(clientIp("")).toBe("");
    expect(clientIp("   ")).toBe("");
  });

  it("takes the first address of the list, trimmed", () => {
    expect(clientIp("203.0.113.7")).toBe("203.0.113.7");
    expect(clientIp("203.0.113.7, 10.0.0.1, 10.0.0.2")).toBe("203.0.113.7");
    expect(clientIp("  2001:db8::1  ,10.0.0.1")).toBe("2001:db8::1");
  });

  it("is empty when the first entry is empty", () => {
    expect(clientIp(", 10.0.0.1")).toBe("");
  });

  it("passes an oversized value through for the use-case to cap", () => {
    const long = "a".repeat(500);
    expect(clientIp(`${long}, 10.0.0.1`)).toBe(long);
  });
});
