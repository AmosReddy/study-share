/**
 * Verifies that every external service is reachable with the credentials in
 * .env.local. Run with: npm run check:services
 *
 * It goes through the same ports and composition root as the app, so it also
 * proves the wiring works. Prints PASS or FAIL per service and exits non-zero
 * if any fails. Error output is limited to the error's name and message so
 * credentials are not printed.
 */
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAuthProvider, type CookieJar } from "@/server/adapters/supabase-auth-provider";
import { pingDatabase } from "@/server/db/ping";
import { EnvError, getServerEnv } from "@/server/env";
import { getEmailSender, getFileStorage } from "@/server/services";

async function checkStorage(): Promise<void> {
  const storage = getFileStorage();
  const key = `healthcheck/${Date.now()}.txt`;
  const body = `check ${key}`;
  try {
    await storage.put(key, body, "text/plain");

    const info = await storage.head(key);
    if (info?.sizeBytes !== body.length) throw new Error("Stored size did not match what was uploaded");

    const bytes = await storage.get(key);
    if (!bytes || new TextDecoder().decode(bytes) !== body) {
      throw new Error("Downloaded content did not match what was uploaded");
    }

    // Prove a browser-style upload through a signed link works: the app sends uploads straight from
    // the browser to storage, from the site's address (CORS), with a real, non-empty body.
    const uploadKey = `healthcheck/upload-${Date.now()}.txt`;
    try {
      const uploadBody = `upload ${uploadKey}`;
      const { url: uploadUrl, headers } = await storage.createUploadUrl({
        key: uploadKey,
        contentType: "text/plain",
        sizeBytes: uploadBody.length,
        expiresInSeconds: 60,
      });
      const origin = "https://example.test";
      const preflight = await fetch(uploadUrl, {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" },
      });
      if (!preflight.ok || !preflight.headers.get("access-control-allow-origin")) {
        throw new Error(`Storage does not allow browser uploads (preflight ${preflight.status})`);
      }
      const put = await fetch(uploadUrl, { method: "PUT", headers: { ...headers, Origin: origin }, body: uploadBody });
      if (!put.ok) throw new Error(`Signed upload failed (${put.status})`);
      if ((await storage.head(uploadKey))?.sizeBytes !== uploadBody.length) throw new Error("Signed upload stored the wrong size");
    } finally {
      await storage.delete(uploadKey).catch(() => {});
    }

    // Prove a signed download link works too, since the app hands these to browsers.
    const url = await storage.createDownloadUrl({ key, expiresInSeconds: 60 });
    const response = await fetch(url);
    if (!response.ok || (await response.text()) !== body) throw new Error(`Signed download failed (${response.status})`);
  } finally {
    // Always try to clean up, even when a check failed.
    await storage.delete(key).catch(() => {});
  }
  if ((await storage.head(key)) !== null) throw new Error("Deleted file is still there");
}

/**
 * Creates a throwaway confirmed user with the admin API, then signs in, reads the
 * user and signs out through our own adapter (the same code the app runs, with an
 * in-memory cookie jar instead of the request's). The user is always deleted.
 */
async function checkAuth(): Promise<void> {
  const env = getServerEnv();
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `healthcheck+${Date.now()}@example.com`;
  const password = `${crypto.randomUUID()}Aa1!`;

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "Health Check" },
  });
  if (created.error) throw new Error(`Could not create the test user (${created.error.status ?? "no status"})`);
  const userId = created.data.user.id;

  try {
    const jar = new Map<string, string>();
    const cookies: CookieJar = {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (items) => {
        for (const { name, value } of items) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    };
    const auth = createSupabaseAuthProvider({
      url: env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      cookies,
    });

    const signIn = await auth.signInWithPassword({ email, password });
    if (!signIn.ok) throw new Error(`Sign-in failed: ${signIn.reason}`);

    const user = await auth.getUser();
    if (user?.id !== userId) throw new Error("getUser did not return the signed-in user");
    if (user.displayName !== "Health Check") throw new Error("getUser did not map the display name");

    await auth.signOut();
    if ((await auth.getUser()) !== null) throw new Error("Still signed in after sign-out");
  } finally {
    // Always clean up, even when a check failed. A failed clean-up is printed
    // (the user id only) so the leftover account can be removed by hand.
    const deleted = await admin.auth.admin.deleteUser(userId).catch(() => ({ error: new Error("request failed") }));
    if (deleted.error) console.log(`WARN  auth  the test user ${userId} was not deleted; remove it in the dashboard`);
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error";
}

async function main(): Promise<void> {
  try {
    getServerEnv();
  } catch (error) {
    console.log(`FAIL  environment  ${error instanceof EnvError ? error.message : describeError(error)}`);
    process.exit(1);
  }

  const checks: [string, () => Promise<void>][] = [
    ["database", pingDatabase],
    ["file storage", checkStorage],
    ["email (SMTP login)", () => getEmailSender().verify()],
    ["auth", checkAuth],
  ];

  let failed = false;
  for (const [name, run] of checks) {
    try {
      await run();
      console.log(`PASS  ${name}`);
    } catch (error) {
      failed = true;
      console.log(`FAIL  ${name}  ${describeError(error)}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

void main();
