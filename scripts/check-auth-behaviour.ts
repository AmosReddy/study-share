/**
 * Probes how the real Supabase Auth behaves in the cases the code-based registration
 * design depends on (emailed codes checked with verifyOtp), and prints the facts.
 * Run with: npm run check:auth-behaviour
 *
 * DEV PROJECT ONLY. It creates and deletes test users, so it refuses to run when the
 * settings are (or point at) production. Test addresses are plus-addresses of the
 * project's own mailbox (SMTP_USER), so no email ever goes to anyone else. It sends at
 * most five real emails (signUp and resend do; the admin generateLink used to obtain a
 * code does not) and always deletes every user it created (by recorded id, then a scan by
 * tag), including on Ctrl-C, SIGTERM, SIGHUP and SIGBREAK. It says "0 left" only when every
 * deletion was confirmed and the scan finished.
 *
 * It prints labelled FACT lines only: never a password, token, code, key or full email
 * address. Provider errors are reported by name, HTTP status and error code, never by
 * message. Each probe is separate: one that fails prints "PROBE FAILED" and the rest run.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanUpUsers, type DeleteOutcome } from "@/server/clean-up-users";
import { describeAuthError, describeCodeShape } from "@/server/describe-auth-error";
import { EnvError, getServerEnv, settingsPointAtProduction } from "@/server/env";

/** Supabase's per-address email limit is about one a minute, so a repeat to one address waits this long. */
const PER_ADDRESS_WAIT_MS = 65_000;
const BETWEEN_CALLS_MS = 3_000;
const TAGS = ["a", "b", "d", "e", "f", "g", "h", "unknown"];
/** After a stop signal, how long to wait for the call in flight before cleaning up anyway. */
const ABORT_SETTLE_MS = 20_000;
const SCAN_PAGE_SIZE = 200;
const SCAN_MAX_PAGES = 50;

/** Set by the signal handler: probes stop at their next wait, and no new probe starts. */
let aborting = false;

/** Waits in short slices so a stop signal ends the wait quickly; throws once aborting. */
async function sleep(ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (aborting) throw new Error("stopped by a signal");
    await new Promise((resolve) => setTimeout(resolve, Math.min(500, end - Date.now())));
  }
  if (aborting) throw new Error("stopped by a signal");
}

function fact(label: string, value: string) {
  console.log(`FACT  ${label}: ${value}`);
}

const yesNo = (value: boolean) => (value ? "yes" : "no");

type Ctx = {
  url: string;
  anonKey: string;
  admin: SupabaseClient;
  /** A new client with its own in-memory session, like one browser. */
  client: () => SupabaseClient;
  address: (tag: string) => string;
  P1: string;
  P2: string;
  createConfirmed: (email: string, password?: string) => Promise<string>;
  /** Admin createUser that records the new user's id for the clean-up. */
  createUser: (attributes: Parameters<SupabaseClient["auth"]["admin"]["createUser"]>[0]) => ReturnType<SupabaseClient["auth"]["admin"]["createUser"]>;
  /** Records a user id (for example from signUp) so the clean-up deletes it by id. */
  track: (id: string | undefined) => void;
  /** Stops tracking an id the probe itself deleted. */
  forget: (id: string) => void;
};

type Probe = { label: string; run: (ctx: Ctx) => Promise<void> };

/** The emailed-style code of an admin-generated link (no email is sent), or undefined with the error described. */
async function generateCode(
  ctx: Ctx,
  params: { type: "signup"; email: string; password: string } | { type: "recovery"; email: string },
): Promise<{ code?: string; error: string }> {
  const { data, error } = await ctx.admin.auth.admin.generateLink(params);
  return { code: data?.properties?.email_otp, error: describeAuthError(error) };
}

function verify(ctx: Ctx, email: string, token: string, type: "signup" | "email" | "recovery") {
  return ctx.client().auth.verifyOtp({ email, token, type });
}

type Verified = Awaited<ReturnType<typeof verify>>;

function acceptedOrRejected(result: Verified, reusableNote?: string): string {
  if (result.error) return `rejected: ${describeAuthError(result.error)}`;
  return `ACCEPTED${reusableNote ? ` (${reusableNote})` : ""}; session returned ${yesNo(!!result.data.session)}; user confirmed ${yesNo(!!result.data.user?.email_confirmed_at)}`;
}

/** (a), (b), (c), (i): sign-up, the signup code, wrong/used/superseded codes, unconfirmed sign-in. */
async function probeSignupCode(ctx: Ctx) {
  const email = ctx.address("a");
  const signUp = await ctx.client().auth.signUp({ email, password: ctx.P1 });
  ctx.track(signUp.data.user?.id);
  fact(
    "(a) signUp of a new address (sends email 1)",
    `${describeAuthError(signUp.error)}; user returned ${yesNo(!!signUp.data.user)}; session returned ${yesNo(!!signUp.data.session)}; confirmed ${yesNo(!!signUp.data.user?.email_confirmed_at)}`,
  );

  // (c) sign in while unconfirmed, right and wrong password.
  const right = await ctx.client().auth.signInWithPassword({ email, password: ctx.P1 });
  fact("(c) signInWithPassword, UNCONFIRMED user, RIGHT password", `${describeAuthError(right.error)}; session ${yesNo(!!right.data.session)}`);
  const wrong = await ctx.client().auth.signInWithPassword({ email, password: ctx.P2 });
  fact("(c) signInWithPassword, UNCONFIRMED user, WRONG password", `${describeAuthError(wrong.error)}; session ${yesNo(!!wrong.data.session)}`);

  const g1 = await generateCode(ctx, { type: "signup", email, password: ctx.P1 });
  fact("(a) admin generateLink type signup for the unconfirmed user (sends no email; code from admin generateLink, not the emailed message)", g1.error);
  fact("(i) signup code shape", describeCodeShape(g1.code));

  // (b) a wrong code (nothing is consumed by a wrong code).
  const wrongCode = g1.code?.replace(/\d/g, (d) => String((Number(d) + 1) % 10)) ?? "00000000";
  const wrongTry = await verify(ctx, email, wrongCode, "signup");
  fact("(b) verifyOtp type signup with a WRONG code (a digit-shifted copy of a generateLink code)", acceptedOrRejected(wrongTry));

  console.log(`      waiting ${PER_ADDRESS_WAIT_MS / 1000} s so the per-address email limit does not decide the second sign-up...`);
  await sleep(PER_ADDRESS_WAIT_MS);
  const second = await ctx.client().auth.signUp({ email, password: ctx.P1 });
  ctx.track(second.data.user?.id);
  fact("(b) second signUp of the same unconfirmed address (sends email 2)", `${describeAuthError(second.error)}; session returned ${yesNo(!!second.data.session)}`);
  if (g1.code) {
    const old = await verify(ctx, email, g1.code, "signup");
    fact("(b) code generated BEFORE the second signUp, used after it (code from admin generateLink, not the emailed message)", acceptedOrRejected(old, "earlier code NOT invalidated"));
  }

  // Two generateLink calls in a row: is the first of them superseded by the second?
  const g2 = await generateCode(ctx, { type: "signup", email, password: ctx.P1 });
  const g3 = await generateCode(ctx, { type: "signup", email, password: ctx.P1 });
  fact("(b) two admin generateLink calls in a row", `${g2.error} / ${g3.error}; codes differ ${yesNo(!!g2.code && g2.code !== g3.code)}`);
  if (g2.code && g2.code !== g3.code) {
    const earlier = await verify(ctx, email, g2.code, "signup");
    fact("(b) the EARLIER of two generated codes, used after the later one was issued (code from admin generateLink, not the emailed message)", acceptedOrRejected(earlier, "earlier code NOT invalidated"));
  }

  // (a) the right code, type signup.
  const latest = g3.code ?? g2.code ?? g1.code;
  if (!latest) throw new Error("no code was generated");
  const ok = await verify(ctx, email, latest, "signup");
  fact("(a) verifyOtp type signup with the LATEST correct code (code from admin generateLink, not the emailed message)", acceptedOrRejected(ok));
  // (b) the same code a second time.
  const again = await verify(ctx, email, latest, "signup");
  fact("(b) the SAME code used a second time (code from admin generateLink, not the emailed message)", acceptedOrRejected(again, "code is reusable"));
}

/** (a): does type "email" also verify a signup code, on its own fresh user (admin-created, unconfirmed, no email sent). */
async function probeEmailType(ctx: Ctx) {
  const email = ctx.address("b");
  const created = await ctx.createUser({ email, password: ctx.P1 });
  if (created.error) throw created.error;
  const g = await generateCode(ctx, { type: "signup", email, password: ctx.P1 });
  fact("(a) fresh unconfirmed user B (admin-created, no email): generateLink type signup", g.error);
  if (!g.code) return;
  const viaEmail = await verify(ctx, email, g.code, "email");
  fact("(a) verifyOtp type email with a signup code (code from admin generateLink, not the emailed message)", acceptedOrRejected(viaEmail));
}

/** (d): admin.deleteUser of an unconfirmed user, then signUp again for the same address (sends email 3). */
async function probeDeleteThenSignUp(ctx: Ctx) {
  const email = ctx.address("d");
  const created = await ctx.createUser({ email, password: ctx.P1 });
  if (created.error || !created.data.user) throw created.error ?? new Error("no user was created");
  const oldId = created.data.user.id;
  const deleted = await ctx.admin.auth.admin.deleteUser(oldId);
  if (!deleted.error) ctx.forget(oldId);
  fact("(d) admin.deleteUser of an UNCONFIRMED user (admin-created user)", describeAuthError(deleted.error));
  const signUp = await ctx.client().auth.signUp({ email, password: ctx.P2 });
  const newId = signUp.data.user?.id;
  ctx.track(newId);
  const stored = newId ? await ctx.admin.auth.admin.getUserById(newId) : undefined;
  fact(
    "(d) signUp again for the same address right after the delete (sends email 3, no wait)",
    `${describeAuthError(signUp.error)}; new id differs from the old one ${yesNo(!!newId && newId !== oldId)}; session returned ${yesNo(!!signUp.data.session)}; confirmation email recorded as sent ${yesNo(!!stored?.data.user?.confirmation_sent_at)}`,
  );
}

/** (e): recovery code, session, password change, old and new password. */
async function probeRecovery(ctx: Ctx) {
  const email = ctx.address("e");
  await ctx.createConfirmed(email);
  const g = await generateCode(ctx, { type: "recovery", email });
  fact("(e) admin generateLink type recovery (sends no email)", g.error);
  fact("(i) recovery code shape", describeCodeShape(g.code));
  if (!g.code) return;
  const client = ctx.client();
  const verified = await client.auth.verifyOtp({ email, token: g.code, type: "recovery" });
  fact("(e) verifyOtp type recovery", acceptedOrRejected(verified));
  if (!verified.data.session) return;
  const updated = await client.auth.updateUser({ password: ctx.P2 });
  fact("(e) updateUser({ password }) with the recovery session", describeAuthError(updated.error));
  const withNew = await ctx.client().auth.signInWithPassword({ email, password: ctx.P2 });
  const withOld = await ctx.client().auth.signInWithPassword({ email, password: ctx.P1 });
  fact("(e) afterwards: NEW password signs in / OLD password signs in", `${yesNo(!!withNew.data.session)} / ${yesNo(!!withOld.data.session)} (old: ${describeAuthError(withOld.error)})`);
}

/** (f): signOut({ scope: "others" }) with two independent sessions of one user. */
async function probeSignOutOthers(ctx: Ctx) {
  const email = ctx.address("f");
  await ctx.createConfirmed(email);
  const a = ctx.client();
  const b = ctx.client();
  const inA = await a.auth.signInWithPassword({ email, password: ctx.P1 });
  const inB = await b.auth.signInWithPassword({ email, password: ctx.P1 });
  const sessionB = inB.data.session;
  fact(
    "(f) the same user signed in twice (two independent sessions)",
    `${describeAuthError(inA.error)} / ${describeAuthError(inB.error)}; distinct refresh tokens ${yesNo(!!inA.data.session && !!sessionB && inA.data.session.refresh_token !== sessionB.refresh_token)}`,
  );
  if (!inA.data.session || !sessionB) return;
  const out = await a.auth.signOut({ scope: "others" });
  fact("(f) signOut({ scope: others }) from session A", describeAuthError(out.error));
  const aUser = await a.auth.getUser();
  fact("(f) session A afterwards: getUser", `${describeAuthError(aUser.error)}; user ${yesNo(!!aUser.data.user)}`);
  const bAccess = await ctx.admin.auth.getUser(sessionB.access_token);
  fact("(f) session B's existing ACCESS token afterwards (checked at the server)", bAccess.error ? `rejected: ${describeAuthError(bAccess.error)}` : "still accepted until it expires");
  const aRefresh = await a.auth.refreshSession();
  fact("(f) session A afterwards: refresh", `${describeAuthError(aRefresh.error)}; new session ${yesNo(!!aRefresh.data.session)}`);
  const bRefresh = await ctx.client().auth.refreshSession({ refresh_token: sessionB.refresh_token });
  fact("(f) session B's REFRESH token afterwards", bRefresh.error ? `rejected: ${describeAuthError(bRefresh.error)}` : `STILL REFRESHES; new session ${yesNo(!!bRefresh.data.session)}`);
}

/** (g): a user created without a password gets one through a recovery code. */
async function probeAddPassword(ctx: Ctx) {
  const email = ctx.address("g");
  const created = await ctx.createUser({ email, email_confirm: true });
  fact("(g) admin createUser with email_confirm and NO password", describeAuthError(created.error));
  if (created.error) return;
  const before = await ctx.client().auth.signInWithPassword({ email, password: ctx.P1 });
  fact("(g) signInWithPassword before any password exists", `${describeAuthError(before.error)}; session ${yesNo(!!before.data.session)}`);
  const g = await generateCode(ctx, { type: "recovery", email });
  fact("(g) generateLink type recovery for the password-less user", g.error);
  if (!g.code) return;
  const client = ctx.client();
  const verified = await client.auth.verifyOtp({ email, token: g.code, type: "recovery" });
  fact("(g) verifyOtp type recovery", acceptedOrRejected(verified));
  if (!verified.data.session) return;
  const updated = await client.auth.updateUser({ password: ctx.P1 });
  fact("(g) updateUser({ password }) sets the first password", describeAuthError(updated.error));
  const after = await ctx.client().auth.signInWithPassword({ email, password: ctx.P1 });
  fact("(g) signInWithPassword with that new password", `${describeAuthError(after.error)}; session ${yesNo(!!after.data.session)}`);
}

/** (h): resend({ type: "signup" }) for a confirmed and for an unknown address (may send up to two emails). */
async function probeResend(ctx: Ctx) {
  const email = ctx.address("h");
  await ctx.createConfirmed(email);
  const client = ctx.client();
  const confirmed = await client.auth.resend({ type: "signup", email });
  fact("(h) resend type signup for a CONFIRMED address", describeAuthError(confirmed.error));
  await sleep(BETWEEN_CALLS_MS);
  const unknown = await client.auth.resend({ type: "signup", email: ctx.address("unknown") });
  fact("(h) resend type signup for an UNKNOWN address", describeAuthError(unknown.error));
}

/** (j): the code lifetime, if the public auth settings expose it. */
async function probeSettings(ctx: Ctx) {
  const response = await fetch(`${ctx.url}/auth/v1/settings`, { headers: { apikey: ctx.anonKey, Authorization: `Bearer ${ctx.anonKey}` } });
  if (!response.ok) {
    fact("(j) effective code lifetime", `not readable (settings endpoint answered ${response.status})`);
    return;
  }
  const settings = (await response.json()) as Record<string, unknown>;
  const names = Object.keys(settings).filter((key) => /otp|expir|lifetime/i.test(key));
  fact(
    "(j) effective code lifetime",
    names.length ? `readable through settings keys: ${names.join(", ")}` : "not readable (the public auth settings expose no code lifetime or length; the Management API needs an access token this script does not have)",
  );
  fact("(j) related public setting mailer_autoconfirm (true means Confirm email is OFF)", String(settings.mailer_autoconfirm ?? "not present"));
}

const probes: Probe[] = [
  { label: "(a)(b)(c)(i)", run: probeSignupCode },
  { label: "(a) email type", run: probeEmailType },
  { label: "(d)", run: probeDeleteThenSignUp },
  { label: "(e)", run: probeRecovery },
  { label: "(f)", run: probeSignOutOthers },
  { label: "(g)", run: probeAddPassword },
  { label: "(h)", run: probeResend },
  { label: "(j)", run: probeSettings },
];

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
  const address = (tag: string) => `${local}+check${stamp}${tag}@${domain}`;

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const client = () => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Every user this run creates is recorded by id as soon as it exists, so clean-up can delete by id.
  const createdIds = new Set<string>();

  /** The tagged users still on the project, found by address. Reports whether it saw every page. */
  async function scanForTaggedUsers(): Promise<{ ids: string[]; complete: boolean }> {
    const wanted = new Set(TAGS.map((tag) => address(tag).toLowerCase()));
    const ids: string[] = [];
    for (let page = 1; page <= SCAN_MAX_PAGES; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: SCAN_PAGE_SIZE });
      if (error) throw new Error(`Could not list users (status ${error.status ?? "none"})`);
      for (const user of data.users) if (user.email && wanted.has(user.email.toLowerCase())) ids.push(user.id);
      if (data.nextPage === null || data.users.length === 0) return { ids, complete: true };
    }
    return { ids, complete: false };
  }

  async function deleteById(id: string): Promise<DeleteOutcome> {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (!error) return "deleted";
    return error.status === 404 || error.code === "user_not_found" ? "gone" : "failed";
  }

  const P1 = `${crypto.randomUUID()}Aa1!`;
  const P2 = `${crypto.randomUUID()}Bb2!`;
  const ctx: Ctx = {
    url,
    anonKey,
    admin,
    client,
    address,
    P1,
    P2,
    createUser: async (attributes) => {
      const result = await admin.auth.admin.createUser(attributes);
      if (result.data.user) createdIds.add(result.data.user.id);
      return result;
    },
    track: (id) => {
      if (id) createdIds.add(id);
    },
    forget: (id) => {
      createdIds.delete(id);
    },
    createConfirmed: async (email, password = P1) => {
      const created = await ctx.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) throw new Error(`Could not create a confirmed test user (status ${created.error?.status ?? "none"})`);
      return created.data.user.id;
    },
  };

  // Delete every user this run created: by recorded id first, then a scan by tag as a fallback.
  // Runs once (the shared promise); "0 left" is printed only when every deletion was confirmed.
  let cleanedUp: Promise<void> | undefined;
  const cleanUp = () =>
    (cleanedUp ??= (async () => {
      const result = await cleanUpUsers({ knownIds: [...createdIds], scan: scanForTaggedUsers, deleteUser: deleteById });
      for (const warning of result.warnings) console.log(`WARN  ${warning}`);
      console.log(result.summary);
      if (result.left > 0) process.exitCode = 1;
    })());

  // A stop signal: stop the probes, wait for the call in flight, clean up, exit non-zero.
  // Further signals are ignored while that runs, so a second Ctrl-C cannot cut the clean-up short.
  let inFlight: Promise<unknown> = Promise.resolve();
  let handlingSignal = false;
  const onSignal = (signal: string) => {
    if (handlingSignal) {
      console.log(`${signal} ignored: clean-up is already running.`);
      return;
    }
    handlingSignal = true;
    aborting = true;
    process.exitCode = 130;
    console.log(`\n${signal} received: stopping, then cleaning up the test users before exiting.`);
    void (async () => {
      const settled = await Promise.race([
        inFlight.then(() => true, () => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ABORT_SETTLE_MS)),
      ]);
      if (!settled) console.log("WARN  the call in flight did not finish in time; cleaning up anyway (a user it creates after this scan would be missed)");
      await cleanUp().catch(() => {});
      process.exit(130);
    })();
  };
  // SIGBREAK exists on Windows only and SIGHUP is emulated there (console close); register what the platform accepts.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
    try {
      process.on(signal, () => onSignal(signal));
    } catch {
      // This platform does not support this signal.
    }
  }

  console.log(`Probing the dev project's code-based Auth behaviour (test addresses are plus-addresses of the project mailbox, tag check${stamp}).`);
  try {
    for (const probe of probes) {
      if (aborting) break;
      inFlight = probe.run(ctx);
      try {
        await inFlight;
      } catch (error) {
        fact(probe.label, `PROBE FAILED: ${aborting ? "stopped by a signal" : describeAuthError(error)}`);
        if (!aborting) process.exitCode = 1;
      }
      try {
        await sleep(BETWEEN_CALLS_MS);
      } catch {
        break;
      }
    }
  } finally {
    await cleanUp();
  }
}

void main();
