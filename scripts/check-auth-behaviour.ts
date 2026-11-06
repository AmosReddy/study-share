/**
 * Probes how the real Supabase Auth behaves in the cases our fake has to copy, and
 * prints the facts. Run with: npm run check:auth-behaviour
 *
 * DEV PROJECT ONLY. It creates and deletes test users, so it refuses to run when the
 * settings are (or point at) production. Test addresses are plus-addresses of the
 * project's own mailbox (SMTP_USER), so no email ever goes to anyone else. It sends
 * about three emails and always deletes every user it created.
 *
 * It prints labelled facts only: never a password, token, key or full email address.
 * Provider errors are reported by HTTP status and error code, never by message.
 */
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAuthProvider, type CookieJar } from "@/server/adapters/supabase-auth-provider";
import { EnvError, getServerEnv, settingsPointAtProduction } from "@/server/env";
import { AuthProviderError, type AuthProvider } from "@/server/ports/auth-provider";

/** Supabase's per-address email limit is about one a minute, so a repeat to one address waits this long. */
const PER_ADDRESS_WAIT_MS = 65_000;
const BETWEEN_CALLS_MS = 3_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fact(label: string, value: string) {
  console.log(`FACT  ${label}: ${value}`);
}

/** The status and code of the last error Supabase returned, recorded by a wrapper around the client. */
type RawError = { status?: number; code?: string } | null;

function memoryJar(): CookieJar {
  const jar = new Map<string, string>();
  return {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (items) => {
      for (const { name, value } of items) {
        if (value) jar.set(name, value);
        else jar.delete(name);
      }
    },
  };
}

/** Our own adapter over a server client whose returned errors are recorded (status and code only). */
function probeProvider(url: string, anonKey: string): { provider: AuthProvider; lastError: () => RawError } {
  const cookies = memoryJar();
  const client = createServerClient(url, anonKey, {
    cookies: { getAll: () => cookies.getAll(), setAll: (items) => cookies.setAll(items) },
  });
  let last: RawError = null;
  const auth = new Proxy(client.auth, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        last = null;
        const result = await value.apply(target, args);
        const error = (result as { error?: { status?: number; code?: string } | null })?.error;
        if (error) last = { status: error.status, code: error.code };
        return result;
      };
    },
  });
  const provider = createSupabaseAuthProvider({ url, anonKey, cookies }, { auth } as Pick<SupabaseClient, "auth">);
  return { provider, lastError: () => last };
}

function describeRaw(raw: RawError): string {
  return raw ? `Supabase returned status ${raw.status ?? "none"}, code ${raw.code ?? "none"}` : "Supabase returned no error";
}

/** Runs one adapter call and reports whether it returned normally or threw, with the codes. */
async function outcome(run: () => Promise<unknown>, lastError: () => RawError): Promise<string> {
  try {
    const value = await run();
    const shown = value === undefined ? "" : ` with ${JSON.stringify(value)}`;
    return `returned normally${shown} (${describeRaw(lastError())})`;
  } catch (error) {
    const code = error instanceof AuthProviderError ? `AuthProviderError ${error.code}` : "a non-provider error";
    return `threw ${code} (${describeRaw(lastError())})`;
  }
}

async function main(): Promise<void> {
  let env;
  try {
    env = getServerEnv();
  } catch (error) {
    console.log(`FAIL  environment  ${error instanceof EnvError ? error.message : "could not read the settings"}`);
    process.exit(1);
  }
  if (settingsPointAtProduction(env)) {
    console.log("FAIL  refusing to run: these settings are, or point at, the production project. Dev only.");
    process.exit(1);
  }
  const at = env.SMTP_USER.lastIndexOf("@");
  if (at <= 0) {
    console.log("FAIL  SMTP_USER is not an email address, so there is no safe mailbox for test addresses.");
    process.exit(1);
  }
  const local = env.SMTP_USER.slice(0, at);
  const domain = env.SMTP_USER.slice(at + 1);
  const stamp = Date.now();
  const prefix = `${local}+check${stamp}`;
  const address = (tag: string) => `${prefix}${tag}@${domain}`;

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const P1 = `${crypto.randomUUID()}Aa1!`;
  const P2 = `${crypto.randomUUID()}Bb2!`;
  const meta = { displayName: "Behaviour Check", termsVersion: "check", redirectTo: "http://localhost:3000/" };

  async function findUserId(email: string): Promise<string | undefined> {
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(`Could not list users (status ${error.status ?? "none"})`);
      const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (found) return found.id;
      if (data.users.length < 200) return undefined;
    }
    return undefined;
  }

  async function createConfirmed(email: string): Promise<void> {
    const created = await admin.auth.admin.createUser({ email, password: P1, email_confirm: true });
    if (created.error) throw new Error(`Could not create a confirmed test user (status ${created.error.status ?? "none"})`);
  }

  console.log(`Probing the dev project's Auth behaviour (test addresses are plus-addresses of the project mailbox, tag check${stamp}).`);
  try {
    // (a) Two sign-ups of one unconfirmed address with different passwords, then confirm.
    {
      const email = address("a");
      const { provider, lastError } = probeProvider(url, anonKey);
      fact("(a) first sign-up of address A with password P1", await outcome(() => provider.signUpWithPassword({ email, password: P1, ...meta }), lastError));
      const firstId = await findUserId(email);
      const first = firstId ? await admin.auth.admin.getUserById(firstId) : undefined;
      fact(
        "(a) address A after the first sign-up",
        !first?.data.user ? "no user found" : first.data.user.email_confirmed_at ? "CONFIRMED at once (Confirm email is OFF on this project; the result below does not apply)" : "exists, unconfirmed",
      );
      console.log(`      waiting ${PER_ADDRESS_WAIT_MS / 1000} s so Supabase's per-address email limit does not decide the result...`);
      await sleep(PER_ADDRESS_WAIT_MS);
      fact("(a) second sign-up of the same unconfirmed address A with password P2", await outcome(() => provider.signUpWithPassword({ email, password: P2, ...meta }), lastError));
      const id = await findUserId(email);
      if (!id) throw new Error("Address A has no user after sign-up");
      const confirm = await admin.auth.admin.updateUserById(id, { email_confirm: true });
      fact("(a) confirm address A through the admin API", confirm.error ? `failed (status ${confirm.error.status ?? "none"})` : "done");
      const withP1 = await provider.signInWithPassword({ email, password: P1 });
      const p1Raw = describeRaw(lastError());
      await provider.signOut().catch(() => {});
      const withP2 = await provider.signInWithPassword({ email, password: P2 });
      const p2Raw = describeRaw(lastError());
      await provider.signOut().catch(() => {});
      fact("(a) sign in to A with P1 (the FIRST password)", `${JSON.stringify(withP1)} (${p1Raw})`);
      fact("(a) sign in to A with P2 (the LATEST password)", `${JSON.stringify(withP2)} (${p2Raw})`);
      const verdict =
        withP1.ok && !withP2.ok
          ? "FIRST password kept (pre-registration takeover is possible)"
          : withP2.ok && !withP1.ok
            ? "LATEST password replaces the first (no takeover)"
            : "AMBIGUOUS";
      fact("(a) verdict", verdict);
    }
    await sleep(BETWEEN_CALLS_MS);

    // (b) resendConfirmation for a confirmed address and for an unknown one.
    {
      const email = address("b");
      await createConfirmed(email);
      const { provider, lastError } = probeProvider(url, anonKey);
      fact("(b) resendConfirmation for an already-confirmed address", await outcome(() => provider.resendConfirmation({ email, redirectTo: meta.redirectTo }), lastError));
      await sleep(BETWEEN_CALLS_MS);
      fact("(b) resendConfirmation for an unknown address", await outcome(() => provider.resendConfirmation({ email: address("unknown1"), redirectTo: meta.redirectTo }), lastError));
    }
    await sleep(BETWEEN_CALLS_MS);

    // (c) sendPasswordReset for an unknown address and for a confirmed one.
    {
      const email = address("c");
      await createConfirmed(email);
      const { provider, lastError } = probeProvider(url, anonKey);
      fact("(c) sendPasswordReset for an unknown address", await outcome(() => provider.sendPasswordReset({ email: address("unknown2"), redirectTo: meta.redirectTo }), lastError));
      await sleep(BETWEEN_CALLS_MS);
      fact("(c) sendPasswordReset for a confirmed address", await outcome(() => provider.sendPasswordReset({ email, redirectTo: meta.redirectTo }), lastError));
    }
    await sleep(BETWEEN_CALLS_MS);

    // (d) signUpWithPassword for an already-confirmed address.
    {
      const email = address("d");
      await createConfirmed(email);
      const { provider, lastError } = probeProvider(url, anonKey);
      fact("(d) signUpWithPassword for an already-confirmed address (new password)", await outcome(() => provider.signUpWithPassword({ email, password: P2, ...meta }), lastError));
      const withP1 = await provider.signInWithPassword({ email, password: P1 });
      await provider.signOut().catch(() => {});
      const withP2 = await provider.signInWithPassword({ email, password: P2 });
      await provider.signOut().catch(() => {});
      fact("(d) afterwards: original password works / new password works", `${withP1.ok} / ${withP2.ok}`);
    }
  } catch (error) {
    console.log(`FAIL  probe stopped early: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  } finally {
    // Always delete every user this run created, found by its unique tag.
    let deleted = 0;
    let left = 0;
    for (const tag of ["a", "b", "c", "d", "unknown1", "unknown2"]) {
      const id = await findUserId(address(tag)).catch(() => undefined);
      if (!id) continue;
      const result = await admin.auth.admin.deleteUser(id).catch(() => ({ error: new Error("request failed") }));
      if (result.error) {
        left++;
        console.log(`WARN  test user ${id} was not deleted; remove it in the dashboard`);
      } else deleted++;
    }
    console.log(`Clean-up: ${deleted} test user(s) deleted, ${left} left.`);
  }
}

void main();
