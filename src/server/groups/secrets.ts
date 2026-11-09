import "server-only";
import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { GROUP_CODE_ALPHABET, GROUP_LIMITS } from "@/shared/groups";

/*
  Secrets for groups: the password that lets people join a group, the invite link token and the
  short group code. The password is never stored, logged or put in an error: only a salted scrypt
  hash is kept.

  Stored format: scrypt$<N>$<r>$<p>$<salt base64url>$<hash base64url>
*/

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_BYTES,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      (error, key) => (error ? reject(new Error("Could not hash the group password.")) : resolve(key)),
    );
  });
}

/**
 * The same text can be typed as different code point sequences (a composed or a decomposed Hindi
 * or Telugu letter, depending on the keyboard): both hashing and checking use the canonical form.
 */
function canonical(password: string): string {
  return password.normalize("NFC");
}

/** The string to store for a group password. */
export async function hashGroupPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(canonical(password), salt);
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** The bytes of a canonical base64url string of exactly `length` bytes, or null. */
function decodeExact(text: string, length: number): Buffer | null {
  if (!BASE64URL.test(text)) return null;
  const bytes = Buffer.from(text, "base64url");
  if (bytes.length !== length || bytes.toString("base64url") !== text) return null;
  return bytes;
}

/**
 * True when `password` matches a string made by hashGroupPassword. A malformed or unknown-format
 * stored value gives false and never throws. Only the exact parameters this module writes are
 * accepted, so a crafted stored value cannot make scrypt allocate a lot of memory.
 */
export async function verifyGroupPassword(password: string, stored: string): Promise<boolean> {
  try {
    if (typeof password !== "string" || typeof stored !== "string") return false;
    const parts = stored.split("$");
    if (parts.length !== 6) return false;
    const [scheme, n, r, p, saltText, hashText] = parts;
    if (scheme !== "scrypt" || n !== String(SCRYPT_N) || r !== String(SCRYPT_R) || p !== String(SCRYPT_P)) {
      return false;
    }
    const salt = decodeExact(saltText, SALT_BYTES);
    const expected = decodeExact(hashText, KEY_BYTES);
    if (salt === null || expected === null) return false;

    const actual = await deriveKey(canonical(password), salt);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** An invite link token: 32 random bytes as 43 URL-safe characters. */
export function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** A group code: codeLength characters, each drawn uniformly from the code alphabet. */
export function newGroupCode(): string {
  let code = "";
  for (let i = 0; i < GROUP_LIMITS.codeLength; i++) {
    code += GROUP_CODE_ALPHABET[randomInt(GROUP_CODE_ALPHABET.length)];
  }
  return code;
}
