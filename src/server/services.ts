import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { createFakeAccountDirectory } from "@/server/adapters/fake-account-directory";
import { createFakeAuthProvider, getFakeAuthStore } from "@/server/adapters/fake-auth-provider";
import { createFakeFileStorage } from "@/server/adapters/fake-file-storage";
import { createFakeGroupStore } from "@/server/adapters/fake-group-store";
import { createFakeMessageStore } from "@/server/adapters/fake-message-store";
import { createFakeProfileStore } from "@/server/adapters/fake-profile-store";
import { createFakeResourceStore } from "@/server/adapters/fake-resource-store";
import { createMemoryRateLimiter, type MemoryRateLimiter } from "@/server/adapters/memory-rate-limiter";
import { emailSendKey, recoveryMintedKey } from "@/server/auth/rate-limit-policy";
import { createSmtpEmailSenderFromConfig } from "@/server/adapters/smtp-email-sender";
import { createS3FileStorage } from "@/server/adapters/s3-file-storage";
import { createSupabaseAuthProvider } from "@/server/adapters/supabase-auth-provider";
import { createAccountDirectory } from "@/server/db/account-directory";
import { getDb } from "@/server/db/client";
import { createGroupStore } from "@/server/db/group-store";
import { createMessageStore } from "@/server/db/message-store";
import { createPostgresRateLimiter } from "@/server/db/postgres-rate-limiter";
import { createProfileStore } from "@/server/db/profile-store";
import { createResourceStore } from "@/server/db/resource-store";
import { getServerEnv } from "@/server/env";
import { getSiteUrl } from "@/server/site-url";
import type { AccountDirectory } from "@/server/ports/account-directory";
import type { AuthProvider } from "@/server/ports/auth-provider";
import type { EmailSender } from "@/server/ports/email-sender";
import type { FileStorage } from "@/server/ports/file-storage";
import type { GroupStore } from "@/server/ports/group-store";
import type { MessageStore } from "@/server/ports/message-store";
import type { ProfileStore } from "@/server/ports/profile-store";
import type { RateLimiter } from "@/server/ports/rate-limiter";
import type { ResourceStore } from "@/server/ports/resource-store";

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

/**
 * File storage. In SERVICES_MODE=fake it is the in-memory fake (its objects are kept on
 * globalThis, so each call can make a fresh wrapper); the app refuses fake mode on every real
 * deployment (see env.ts), so a deployment always gets the S3 adapter.
 */
export function getFileStorage(): FileStorage {
  const env = getServerEnv();
  if (env.SERVICES_MODE === "fake") return createFakeFileStorage({ siteUrl: getSiteUrl() });
  if (!storage) {
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
  // Then connection(), BEFORE any Supabase client exists. Building the client reads the clock:
  // createServerClient registers two onAuthStateChange listeners (its own and supabase-js's), and
  // each one, a microtask later, loads the stored session from these cookies and checks its expiry
  // with Date.now() (GoTrueClient.__loadSession). With a session cookie that runs right after
  // construction, inside this render. Next.js refuses a clock read while it prerenders, and it does
  // prerender a page's shell WITH the session cookies for a link's prefetch ("unstable value
  // Date.now() while prerendering": the prefetch fails and the page can fall into a reload loop).
  // connection() holds the render here until there is a real request. Do not move it below the
  // client's creation, and do not create a cookie-bound client anywhere else during a render.
  // In server actions and route handlers it does nothing. src/server/services.test.ts guards the
  // order; supabase-auth-provider.test.ts shows the client reads the clock when it is made.
  await connection();
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
let groupStore: GroupStore | undefined;
let resourceStore: ResourceStore | undefined;
let messageStore: MessageStore | undefined;

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
 * Groups and their members: SQL on public.groups and public.group_members over the database
 * connection. In SERVICES_MODE=fake it is the in-memory fake over the fake auth store (its state
 * is kept on globalThis, so each call can make a fresh wrapper).
 */
export function getGroupStore(): GroupStore {
  if (getServerEnv().SERVICES_MODE === "fake") return createFakeGroupStore(getFakeAuthStore());
  groupStore ??= createGroupStore(getDb());
  return groupStore;
}

/**
 * Files shared in groups: SQL on public.resources over the database connection. In
 * SERVICES_MODE=fake it is the in-memory fake over the fake auth store and the fake group store
 * (its state is kept on globalThis, so each call can make a fresh wrapper).
 */
export function getResourceStore(): ResourceStore {
  if (getServerEnv().SERVICES_MODE === "fake") return createFakeResourceStore(getFakeAuthStore());
  resourceStore ??= createResourceStore(getDb());
  return resourceStore;
}

/**
 * Group chat messages: SQL on public.messages over the database connection. In SERVICES_MODE=fake
 * it is the in-memory fake over the fake auth store and the fake group store (its state is kept on
 * globalThis, so each call can make a fresh wrapper).
 */
export function getMessageStore(): MessageStore {
  if (getServerEnv().SERVICES_MODE === "fake") return createFakeMessageStore(getFakeAuthStore());
  messageStore ??= createMessageStore(getDb());
  return messageStore;
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
