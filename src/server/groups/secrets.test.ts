import { describe, expect, it } from "vitest";
import { GROUP_CODE_ALPHABET, GROUP_LIMITS, isGroupCode } from "@/shared/groups";
import { hashGroupPassword, newGroupCode, newInviteToken, verifyGroupPassword } from "./secrets";

describe("group password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hashGroupPassword("correct horse");
    expect(await verifyGroupPassword("correct horse", stored)).toBe(true);
    expect(await verifyGroupPassword("correct horsf", stored)).toBe(false);
    expect(await verifyGroupPassword("", stored)).toBe(false);
  });

  it("uses the documented format", async () => {
    const parts = (await hashGroupPassword("abcdef")).split("$");
    expect(parts).toHaveLength(6);
    expect(parts.slice(0, 4)).toEqual(["scrypt", "16384", "8", "1"]);
    expect(Buffer.from(parts[4], "base64url")).toHaveLength(16);
    expect(Buffer.from(parts[5], "base64url")).toHaveLength(32);
  });

  it("gives a different string each time for the same password", async () => {
    const a = await hashGroupPassword("same password");
    const b = await hashGroupPassword("same password");
    expect(a).not.toBe(b);
  });

  it("does not contain the password", async () => {
    const stored = await hashGroupPassword("s3cretWord");
    expect(stored).not.toContain("s3cretWord");
  });

  it("verifies unicode passwords", async () => {
    const stored = await hashGroupPassword("पासवर्ड123");
    expect(await verifyGroupPassword("पासवर्ड123", stored)).toBe(true);
    expect(await verifyGroupPassword("पासवर्ड124", stored)).toBe(false);
  });

  it("treats composed and decomposed sequences of the same password as the same password", async () => {
    const pairs: [string, string][] = [
      ["क़ताब", "क़ताब"], // Hindi: ka + nukta vs the single qa character
      ["café-password", "café-password"], // Latin: e-acute vs e + combining acute
    ];
    for (const [composed, decomposed] of pairs) {
      const hashOfComposed = await hashGroupPassword(composed);
      const hashOfDecomposed = await hashGroupPassword(decomposed);
      expect(await verifyGroupPassword(decomposed, hashOfComposed)).toBe(true);
      expect(await verifyGroupPassword(composed, hashOfDecomposed)).toBe(true);
      expect(await verifyGroupPassword(composed, hashOfComposed)).toBe(true);
    }
    // The Telugu vowel sign pair that has a canonical decomposition: U+0C48 = U+0C46 + U+0C56.
    const teluguComposed = "గైడ్";
    const teluguDecomposed = "గైడ్";
    expect(teluguComposed).not.toBe(teluguDecomposed);
    expect(await verifyGroupPassword(teluguDecomposed, await hashGroupPassword(teluguComposed))).toBe(true);
    expect(await verifyGroupPassword(teluguComposed, await hashGroupPassword(teluguDecomposed))).toBe(true);
    // A genuinely different password still fails.
    expect(await verifyGroupPassword("cafè-password", await hashGroupPassword("café-password"))).toBe(false);
  });

  it("returns false, never throws, for malformed stored values", async () => {
    const good = await hashGroupPassword("abcdef");
    const [, , , , salt, hash] = good.split("$");
    const bad = [
      "garbage",
      "",
      "scrypt",
      "scrypt$16384$8$1$$",
      `scrypt$16384$8$1$${salt}`,
      `scrypt$16384$8$1$${salt}$${hash}$extra`,
      `bcrypt$16384$8$1$${salt}$${hash}`,
      `scrypt$abc$8$1$${salt}$${hash}`,
      `scrypt$16384$x$1$${salt}$${hash}`,
      `scrypt$16384$8$$${salt}$${hash}`,
      `scrypt$16384$8$1$${salt.slice(2)}$${hash}`,
      `scrypt$16384$8$1$${salt}$${hash.slice(2)}`,
      `scrypt$16384$8$1$!!!!$${hash}`,
    ];
    for (const stored of bad) {
      expect(await verifyGroupPassword("abcdef", stored)).toBe(false);
    }
  });

  it("refuses parameters other than the fixed ones, so a crafted value cannot make scrypt use huge memory", async () => {
    const good = await hashGroupPassword("abcdef");
    const [, , , , salt, hash] = good.split("$");
    for (const params of ["1073741824$8$1", "16384$1024$1", "16384$8$64", "16385$8$1", "0$8$1", "016384$8$1", "1e4$8$1"]) {
      const started = Date.now();
      expect(await verifyGroupPassword("abcdef", `scrypt$${params}$${salt}$${hash}`)).toBe(false);
      expect(Date.now() - started).toBeLessThan(1000);
    }
  });
});

describe("newInviteToken", () => {
  it("is 43 URL-safe characters and distinct each time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const token = newInviteToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      seen.add(token);
    }
    expect(seen.size).toBe(200);
  });
});

describe("newGroupCode", () => {
  it("always makes a valid group code", () => {
    for (let i = 0; i < 500; i++) {
      const code = newGroupCode();
      expect(code).toHaveLength(GROUP_LIMITS.codeLength);
      expect(isGroupCode(code)).toBe(true);
    }
  });

  it("uses every character of the alphabet", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) for (const ch of newGroupCode()) seen.add(ch);
    expect([...seen].sort().join("")).toBe([...GROUP_CODE_ALPHABET].sort().join(""));
  });
});
