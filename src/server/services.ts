import "server-only";
import { cookies } from "next/headers";
import { createFakeAccountDirectory } from "@/server/adapters/fake-account-directory";
import { createFakeAuthProvider, getFakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { createFakeGroupStore } from "@/server/adapters/fake-group-store";
import { createFakeProfileStore } from "@/server/adapters/fake-profile-store";
import { createMemoryRateLimiter, type MemoryRateLimiter } from "@/server/adapters/memory-rate-limiter";
import { emailSendKey, recoveryMintedKey } from "@/server/auth/rate-limit-policy";
import { createSmtpEmailSenderFromConfig } from "@/server/adapters/smtp-email-sender";
import { createS3FileStorage } from "@/server/adapters/s3-file-storage";
import { createSupabaseAuthProvider } from "@/server/adapters/supabase-auth-provider";
import { createAccountDirectory } from "@/server/db/account-directory";
import { getDb } from "@/server/db/client";
import { createPostgresRateLimiter } from "@/server/db/postgres-rate-limiter";
import { createProfileStore } from "@/server/db/profile-store";
import { getServerEnv } from "@/server/env";
import type { AccountDirectory } from "@/server/ports/account-directory";
import type { AuthProvider } from "@/server/ports/auth-provider";
import type { EmailSender } from "@/server/ports/email-sender";
import type { FileStorage } from "@/server/ports/file-storage";
import type { GroupStore } from "@/server/ports/group-store";
import type { ProfileStore } from "@/server/ports/profile-store";
import type { RateLimiter } from "@/server/ports/rate-limiter";

/**
 * Composition root: the only place that decides which implementation backs
 * each port. Application code calls getFileStorage() and getEmailSender() and
 * never learns which vendor is behind them.
 *
 * To switch a vendor: change its settings (STORAGE_* or SMTP_*). To add a vendor
 * that is not S3 or SMTP compatible: write a new adapter and choose it here.
 */

let storage: FileStorage | undefined;
let email: EmailSender | undefined;

export function getFileStorage(): FileStorage {
  if (!storage) {
    const env = getServerEnv();
    storage = createS3FileStorage({
      endpoint: env.STORAGE_ENDPOINT,
      region: env.STORAGE_REGION,
      accessKeyId: env.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
      bucket: env.STORAGE_BUCKET,
      forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    });
  }
  return storage;
}

export function getEmailSender(): EmailSender {
  if (!email) {
    const env = getServerEnv();
    email = createSmtpEmailSenderFromConfig({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
      from: env.SMTP_FROM,
    });
  }
  return email;
}

/**
 * A new provider per request, over this request's cookies. In SERVICES_MODE=fake
 * it is the in-memory test double, sharing one store across the process.
 */
export async function getAuthProvider(): Promise<AuthProvider> {
  // Cookies first: while a page is prerendered at build time this is where it stops and waits
  // for a real request. Reading the settings before it would run (and fail) at build time,
  // where there are no settings. src/server/services.test.ts guards the order.
  const store = await cookies();
  const env = getServerEnv();

  // Server Components may read cookies but not write them; the proxy and server
  // actions do the writing, so a refused write during rendering is ignored.
  const write = (fn: () => void) => {
    try {
      fn();
    } catch {}
  };

  if (env.SERVICES_MODE === "fake") {
    return createFakeAuthProvider({
      store: getFakeAuthStore(),
      cookies: {
        get: (name) => store.get(name)?.value,
        set: (name, value) => write(() => store.set(name, value, { httpOnly: true, sameSite: "lax", path: "/" })),
        delete: (name) => write(() => store.delete(name)),
      },
    });
  }

  return createSupabaseAuthProvider({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    // Only for scramblePassword; the adapter keeps its admin client apart from the cookies.
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    cookies: {
      getAll: () => store.getAll().map(({ name, value }) => ({ name, value })),
      setAll: (items) => write(() => items.forEach(({ name, value, options }) => store.set(name, value, options))),
    },
  });
}

const MEMORY_LIMITER_KEY = "__studyShareMemoryRateLimiter";
let postgresLimiter: RateLimiter | undefined;
let accountDirectory: AccountDirectory | undefined;
let profileStore: ProfileStore | undefined;

/** Test mode's one limiter. On globalThis, like the fake auth store, because Next.js can bundle
 * server actions and route handlers separately and each would get its own copy. */
function memoryLimiter(): MemoryRateLimiter {
  const g = globalThis as unknown as Record<string, MemoryRateLimiter | undefined>;
  return (g[MEMORY_LIMITER_KEY] ??= createMemoryRateLimiter());
}

export function getRateLimiter(): RateLimiter {
  if (getServerEnv().SERVICES_MODE === "fake") return memoryLimiter();
  postgresLimiter ??= createPostgresRateLimiter(getDb());
  return postgresLimiter;
}

/**
 * Who has an account, and removal of unconfirmed sign-ups: SQL on the auth schema over the
 * database connection. In SERVICES_MODE=fake it is the fake directory over the fake auth store.
 */
export function getAccountDirectory(): AccountDirectory {
  if (getServerEnv().SERVICES_MODE === "fake") return createFakeAccountDirectory(getFakeAuthStore());
  accountDirectory ??= createAccountDirectory(getDb());
  return accountDirectory;
}

/**
 * The app's profile rows (terms acceptance): SQL on public.profiles over the database
 * connection. In SERVICES_MODE=fake it is the fake store over the fake auth store; the app
 * refuses fake mode on every real deployment (see env.ts), so a deployment always gets SQL.
 */
export function getProfileStore(): ProfileStore {
  if (getServerEnv().SERVICES_MODE === "fake") return createFakeProfileStore(getFakeAuthStore());
  profileStore ??= createProfileStore(getDb());
  return profileStore;
}

/**
 * Groups and their members. In SERVICES_MODE=fake it is the in-memory fake over the fake auth
 * store (its state is kept on globalThis, so each call can make a fresh wrapper). The SQL store
 * is not wired yet; until it is, any other mode refuses clearly.
 */
export function getGroupStore(): GroupStore {
  if (getServerEnv().SERVICES_MODE === "fake") return createFakeGroupStore(getFakeAuthStore());
  throw new Error("The group store is not available yet.");
}

/**
 * Test mode only: clears one address's one-email-a-minute cooldown (and the minted-recovery
 * cooldown that a foreign code or a Google repair starts), so a browser test can send a second
 * email to the same address without waiting a minute. Does nothing in any other mode.
 */
export function forgetEmailSendCooldown(email: string): void {
  if (getServerEnv().SERVICES_MODE !== "fake") return;
  const address = email.trim().toLowerCase();
  memoryLimiter().forget(emailSendKey(address));
  memoryLimiter().forget(recoveryMintedKey(address));
}
