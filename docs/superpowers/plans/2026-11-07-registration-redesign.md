# Registration Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace link-based email confirmation and reset with the familiar model: sign up with email and password and confirm with an emailed 6-digit code, continue with Google through an account chooser, and reset a password with an emailed code, while making a stranger's pre-registration of someone else's email useless.

**Architecture:** Supabase Auth stays behind our `AuthProvider` port, which gains code verification and loses the link methods. A new `AccountDirectory` port (SQL on the `auth` schema over the existing database connection) reads who has an account and removes pending sign-ups conditionally. The use-cases bind a code to the browser that created the pending account through a signed cookie, verify the password on a pending account after creating it, and scramble the password of any pending account that a foreign code confirms. The whole link flow is deleted.

**Tech Stack:** Next.js 16 (server actions, route handlers), TypeScript, Supabase Auth (`@supabase/supabase-js` 2.119, `@supabase/ssr` 0.12), Drizzle/postgres.js, Zod, Vitest, Playwright, Tailwind/shadcn.

**Spec:** `docs/superpowers/specs/2026-11-07-registration-redesign-design.md` (binding; read all of it). It supersedes the sign-up, confirmation and reset parts of `docs/superpowers/specs/2026-11-06-phase-1-accounts-and-groups-design.md`. Read `AGENTS.md`: this Next.js is newer than older versions, so check `node_modules/next/dist/docs/` before using an API.

## Global Constraints

- **Codes only.** Emails carry a 6-digit code and no link, for sign-up and for reset. Codes last 10 minutes (Supabase "Email OTP expiration" = 600 s), code length 6. Delete the link flow entirely: `src/app/auth/confirm/**`, `src/server/auth/email-link.ts`, `confirm-page.ts` and their tests, the `/login?confirmed` notice, `readEmailLink`/`confirmLinkTarget` uses. Keep `src/app/auth/callback/route.ts` (Google).
- **Existing email on sign-up is stated clearly:** "This email already has an account. Log in or reset your password." (Google-only: "This email is registered with Google. Continue with Google, or reset your password to add one."). Log-in errors, Forgot password and resend stay private/identical.
- Wrong-code limit **5 per 15 minutes per email**, NOT reset by a resend; resend keeps the shared 60-second cooldown (`email-send:<email>`) and shows a countdown; per-IP code-verify limit 30 per hour; limiter failures fail open with the single fixed warning and a 2 s timeout, as before.
- Newest sign-up wins: an existing UNCONFIRMED account for the address is removed (`delete ... where id = $1 and email_confirmed_at is null`) before a new one is created; after creating it, verify the password on it by `signInWithPassword` (right password gives `email_not_confirmed`, wrong gives `invalid_credentials`) and redo once if wrong.
- Pending-sign-up cookie: signed (HMAC), httpOnly, `sameSite=lax`, path `/`, 30-minute life, holds `{ userId, email }` only; trusted only to decide the foreign-code rule and to pre-fill the address. A code that confirms a user that does not match it, or no cookie, scrambles that account's password (admin `updateUserById` with a random value; this ends every session, including the one the code just made), opens a fresh session with `openSessionWithoutEmail`, and forces "create your password" before finishing.
- After a successful code the person is signed in. After a password reset or forced password creation the person is signed in and every other device is signed out (`signOut({ scope: "others" })`).
- Google: always `prompt=select_account`; terms rule: empty accepted version is recorded automatically at Google sign-in, an outdated version goes to `/welcome`; the sentence "By continuing you confirm you are 18 or older and accept the Terms and Privacy Notice" sits under both buttons; after Google sign-in a defensive repair removes any pending email sign-up on the account and overwrites display name and terms with the Google user's own; a failed repair signs the person out with "Something went wrong signing you in with Google. Please try again."
- Keep: password at least 8, display name 2 to 50, same-site-only `next` via `safeNextPath`, httpOnly cookies, no secrets/tokens/codes/emails/IPs in logs, ports and adapters, ESLint boundaries (`@supabase/*` only in `src/server/adapters`, drizzle/postgres only in `src/server/db`), builds with NO secrets (read cookies/headers before env at build time), test mode refused in production, vendor-neutral settings, Conventional Commits with the trailer for the authoring model.
- Phones first: 44px targets, 16px inputs, `autocomplete="one-time-code"` + `inputmode="numeric"` on the code box, paste accepted with spaces or dashes, visible focus, no sideways scroll at 360px, both themes readable, errors in plain language tied to fields.
- Steps marked **[You]** need the owner. Never ask for secrets in chat. No production access by agents.

## Review Focus

1. **A stranger signs up the victim's address just after the victim.** The victim's browser (cookie id of the victim's now-deleted pending account, or none) must not be signed into an account whose password they did not type: the code is accepted only to the extent of scrambling the password and forcing a new one. (Task 4.)
2. **Two sign-ups for one address at the same moment:** exactly one pending account survives, and its password is the one whose submitter's self-check passed; the other submitter is retried once. (Tasks 2 and 4.)
3. **Wrong-code abuse:** 5 wrong codes lock verification for that address for 15 minutes even if the person requests new codes; a correct code during the lock is refused with the lock message. (Task 4.)
4. **Code entry quirks:** spaces, dashes, non-digits, 5 or 7 digits, the same code submitted twice, double-tap on Verify. (Tasks 4 and 5.)
5. **A Google user whose email has a stranger's pending password, or an existing password account:** the stranger's password is gone, the display name and terms are the Google user's, and an existing confirmed password account is signed into rather than duplicated. (Tasks 2 and 6.)

---

## File Structure

```
scripts/check-auth-behaviour.ts                       Extended live probe (Task 1)
src/server/ports/account-directory.ts                 New port (Task 2)
src/server/db/account-directory.ts (+ .int.test.ts)   SQL on auth.users / auth.identities (Task 2)
scripts/test-db-setup.sql                             Stand-in auth.identities / columns for CI (Task 2)
src/server/ports/auth-provider.ts                     Code API; link methods removed (Task 3)
src/server/adapters/supabase-auth-provider.ts (+test), fake-auth-provider.ts (+test), auth-provider.contract.ts  (Task 3)
src/server/auth/pending-signup-cookie.ts (+test)      Signed cookie (Task 4)
src/server/auth/use-cases.ts (+test), rate-limit-policy.ts, session.ts   (Task 4)
src/app/(auth)/actions.ts, signup/, signup/verify/, forgot-password/, reset-password/, login/, welcome/   (Tasks 5, 6)
src/app/auth/callback/route.ts                        Google repair + terms rule (Task 6)
src/app/api/test/{outbox,expire-codes}/route.ts       Test-only (Task 3 and 5)
src/client/components/auth/*                          Code form, verify form, forms (Tasks 5, 6)
e2e/*.spec.ts, e2e/helpers.ts                         Browser tests (Tasks 5 to 7)
docs/SETUP_AUTH.md, README.md, spec notes             (Task 8)
```
Unit tests sit beside their files. Integration tests (`*.int.test.ts`, real Postgres) run in CI and locally against the DEV project exactly as in earlier work (`TEST_DATABASE_URL="$(node --env-file=.env.local -p 'process.env.DATABASE_MIGRATION_URL')" npm run test:int`; transaction + rollback, refuse production ids).

---

### Task 1: Live probe of the Supabase behaviour the design assumes

**Files:** Modify `scripts/check-auth-behaviour.ts`.

**Interfaces:** Produces printed FACTS (no secrets, no full addresses) that later tasks rely on. Uses the admin API `generateLink` to obtain the emailed code (`properties.email_otp`) without reading a mailbox.

- [ ] **Step 1: Extend the probe** (dev only, deletes everything it creates in `finally`, SIGINT-safe cleanup) with labelled facts for: (a) `signUp` then `verifyOtp({ email, token, type })` with the code from `generateLink({ type: "signup" ... })`: which `type` string works (`signup` or `email`) and whether it returns a session; (b) wrong code, an already-used code, and a code after a second `signUp`/resend (is the earlier code invalidated?); (c) `signInWithPassword` on an UNCONFIRMED user with the right and the wrong password: the exact error codes; (d) `admin.deleteUser` then `signUp` again for the same address: works, new id; (e) recovery: `generateLink({ type: "recovery" })` code with `verifyOtp({ type: "recovery" })` returns a session, then `updateUser({ password })` works; (f) `signOut({ scope: "others" })` leaves the current session valid and revokes a second session's refresh token; (g) `signUp` for an address with NO password user created by admin (no password): `updateUser({ password })` after a recovery code sets one (the Google-only "add a password" case); (h) whether `resend({ type: "signup" })` sends and returns normally for confirmed/unknown addresses.
- [ ] **Step 2: Run it against DEV** (`npm run check:auth-behaviour`), keep emails few (use plus-addresses of the project mailbox as before), and put every printed FACT line into your report. Do not change app code in this task. If a fact contradicts the spec, stop and report it as NEEDS_CONTEXT.
- [ ] **Step 3: Commit** `feat: probe the code-based auth behaviour on the dev project`

---

### Task 2: Account directory (who has an account; conditional removal)

**Files:** Create `src/server/ports/account-directory.ts`, `src/server/db/account-directory.ts`, `src/server/db/account-directory.int.test.ts`; Modify `scripts/test-db-setup.sql`, `src/server/services.ts`.

**Interfaces:**
- Produces:
  ```ts
  export type EmailAccountState =
    | { kind: "none" }
    | { kind: "pending"; userId: string }
    | { kind: "confirmed"; userId: string; providers: ("email" | "google")[]; hasPassword: boolean };
  export interface AccountDirectory {
    describeEmail(email: string): Promise<EmailAccountState>;
    removePendingSignup(email: string): Promise<boolean>;       // true if a row was deleted
    repairAfterGoogle(userId: string): Promise<{ hadPendingEmailSignup: boolean }>;
  }
  createAccountDirectory(db: PostgresJsDatabase): AccountDirectory      // src/server/db
  getAccountDirectory(): AccountDirectory                                // services.ts
  ```
- `repairAfterGoogle` removes an unverified `email` identity for the user and reports whether one existed; the password scramble and metadata overwrite are done by the caller (Task 4/6) through the provider.

- [ ] **Step 1: Write failing integration tests** (rollback-safe, work on plain Postgres with the stand-in schema and on Supabase): `describeEmail` returns `none`, `pending` (email identity unverified / `email_confirmed_at` null), `confirmed` with `providers` `["email"]`, `["google"]` and `["email","google"]` and `hasPassword` true/false (a non-empty `encrypted_password`), matching is case-insensitive and trims; `removePendingSignup` deletes only an unconfirmed user, returns false and deletes nothing for a confirmed user (the conditional delete), and is a no-op for an unknown address; two concurrent `removePendingSignup` calls delete once; `repairAfterGoogle` removes an unverified email identity and reports `true`, reports `false` when there is none and never touches a verified identity.
- [ ] **Step 2: Run them; expected FAIL** (modules missing).
- [ ] **Step 3: Implement** the SQL (parameterised; delete via `... where id = $1 and email_confirmed_at is null returning id`); extend `scripts/test-db-setup.sql` so the plain-Postgres stand-in has `auth.identities` (`id uuid, user_id uuid, provider text, identity_data jsonb, ...`) and `encrypted_password`, `email_confirmed_at` columns; wire `getAccountDirectory()` in `services.ts`.
- [ ] **Step 4: Run** the integration suite against DEV and `npm run lint && npm run typecheck && npm test`; expected PASS. The CI database job runs the same tests.
- [ ] **Step 5: Commit** `feat: add the account directory for sign-up state and pending removal`

---

### Task 3: AuthProvider code API (port, Supabase adapter, fake)

**Files:** Modify `src/server/ports/auth-provider.ts`, `src/server/adapters/supabase-auth-provider.ts` and `.test.ts`, `fake-auth-provider.ts` and `.test.ts`, `auth-provider.contract.ts` and its test, `src/app/api/test/outbox/route.ts`; Create `src/app/api/test/expire-codes/route.ts`.

**Interfaces:**
- Produces (replacing `signUpWithPassword`'s `redirectTo`, `resendConfirmation`, `confirmEmailToken`, `sendPasswordReset`):
  ```ts
  export type CodeKind = "signup" | "recovery";
  export type VerifyCodeResult =
    | { ok: true; userId: string }                       // a session now exists
    | { ok: false; reason: "invalid_code" | "expired" };
  signUpWithPassword(i: { email; password; displayName; termsVersion }): Promise<{ userId: string }>
  resendSignUpCode(i: { email }): Promise<void>                      // neutral for confirmed/unknown
  sendPasswordResetCode(i: { email }): Promise<void>                 // neutral
  verifyCode(i: { email; code: string; kind: CodeKind }): Promise<VerifyCodeResult>
  updatePassword(newPassword: string, opts?: { signOutOthers?: boolean }): Promise<void>
  scramblePassword(userId: string): Promise<void>                    // admin, random value, never returned
  startGoogleSignIn(i: { redirectTo: string }): Promise<{ url: string }>   // adds prompt=select_account
  ```
  Keep `getUser`, `signInWithPassword` (returns `email_not_confirmed` vs `invalid_credentials` exactly as GoTrue), `completeOAuth`, `acceptTerms`, `updateDisplayName`, `signOut`. Use the `verifyOtp` type string and the other facts from Task 1's report (carried in the ledger).
  *As built (rulings P5 to P9):* `VerifyCodeResult` has the one failure reason `invalid_or_expired`; added `openSessionWithoutEmail(i: { email }): Promise<{ userId: string }>` (admin `generateLink` recovery + `verifyOtp` on the cookie client; server only, right after a code or Google sign-in proved ownership). Live facts in the spec, section 5.5.
- Fake provider: codes are 6 random digits per pending/recovery request, single-use, valid until `expireAllCodes()`; the outbox records `{ to, kind: "code", purpose: "signup" | "recovery", code }`; `GET /api/test/outbox?email=` returns `{ code }` (404 unless fake); `POST /api/test/expire-codes` marks every code expired (404 unless fake, cleared by reset); the fake mirrors GoTrue: a repeat sign-up of an unconfirmed address keeps the FIRST password (so the use-case defence is exercised), `signInWithPassword` on an unconfirmed user answers `email_not_confirmed` only for the right password, a resend invalidates earlier codes, `signOut({scope:"others"})` revokes other fake sessions.

- [ ] **Step 1: Write failing tests**: the shared contract (`runAuthProviderContract`) covers sign-up then `verifyCode` success signs in; wrong code, reused code, a code invalidated by resend, an expired code each give the right `reason`; recovery code lets `updatePassword` set a new password and the old one stops working; `signOutOthers` keeps the current session and ends another; sign-up twice keeps the first password (documents GoTrue); unconfirmed login ordering; neutral resend/reset for confirmed and unknown addresses. Supabase adapter unit tests (stub client): `verifyCode` calls `verifyOtp` with the probe-confirmed type, maps `otp_expired` to `expired` and other failures to `invalid_code` without vendor text, `startGoogleSignIn` passes `queryParams: { prompt: "select_account" }`, `updatePassword` with `signOutOthers` calls `signOut({ scope: "others" })` after `updateUser`, `scramblePassword` uses the admin client and never logs or returns the password, rate limits and outages map to `AuthProviderError` as before.
- [ ] **Step 2: Run; expected FAIL.**
- [ ] **Step 3: Implement** the port, both adapters and the test routes (read cookies before env in route handlers).
- [ ] **Step 4: Run** `npm run lint && npm run typecheck && npm test`; expected PASS. (Use-cases and pages are broken until Tasks 4 to 6: keep the build green by leaving thin compatibility shims only where a later task removes them, and list each shim in your report.)
- [ ] **Step 5: Commit** `feat: add email codes to the auth provider and drop the link methods`

---

### Task 4: Pending cookie and use-cases

**Files:** Create `src/server/auth/pending-signup-cookie.ts` and test; Modify `src/server/auth/use-cases.ts` and `.test.ts`, `rate-limit-policy.ts`, `session.ts` as needed.

**Interfaces:**
- Consumes: Tasks 2 and 3.
- Produces:
  ```ts
  signPendingSignup(secret: string, v: { userId: string; email: string }, nowMs: number): string
  readPendingSignup(secret: string, value: string | undefined, nowMs: number): { userId: string; email: string } | null
  // Deps gains: directory: AccountDirectory; pending: { userId: string; email: string } | null (read from the cookie by the caller)
  signUp(deps, raw, next): Promise<ActionResult<{ pendingUserId: string; email: string }>>
  verifySignUpCode(deps, raw, next): Promise<ActionResult<{ redirectTo: string; needsPassword: boolean }>>
  resendSignUpCode(deps, raw): Promise<ActionResult>
  requestPasswordReset(deps, raw): Promise<ActionResult<{ email: string }>>        // always ok for any valid email
  verifyResetCode(deps, raw): Promise<ActionResult>                                // session established
  setPassword(deps, raw): Promise<ActionResult<{ redirectTo: string }>>            // reset and forced creation; signs out others
  repairGoogleAccount(deps, user: AuthUser): Promise<ActionResult<{ redirectTo: string }>>
  ```
  The cookie secret is derived from the existing service-role setting with a fixed label (HMAC key = SHA-256 of `"pending-signup:" + SUPABASE_SERVICE_ROLE_KEY`); no new setting. Policy additions in `rate-limit-policy.ts`: `CODE_ATTEMPTS` (5 per 900 s per email), `CODE_ATTEMPTS_IP` (30 per 3600 s).

- [ ] **Step 1: Write failing tests** (fake provider, in-memory directory/limiter): cookie signing (round trip, tampered, wrong secret, expired, wrong shape returns null); `signUp`: no account creates a pending account, emails a code and returns the pending id; confirmed account returns the exact "already has an account" message without creating or emailing; Google-only returns the Google message; an unconfirmed account is removed and replaced and the new password works for the self-check; when the self-check fails (fake keeps the first password) the pending account is removed and recreated once and succeeds; two concurrent calls leave exactly one pending account; invalid fields and the 60 s shared cooldown behave as before (Global Constraints). `verifySignUpCode`: strips spaces and dashes, rejects non-6-digit input before any provider call, correct code with a matching cookie signs in with `needsPassword: false`; a code that confirms a user NOT matching the cookie (Review Focus 1) and a code with no cookie run `verifyCode` -> `scramblePassword` (ends every session, the stranger's password is dead) -> `openSessionWithoutEmail` (a fresh session in this browser) and return `needsPassword: true`; if `openSessionWithoutEmail` fails, the password stays random, the person is signed out and is pointed to Forgot password; 5 wrong codes lock the address for 15 minutes even after a resend; limiter failure fails open; a wrong or expired code gives the one "wrong or has expired" message with a path to resend. `rate_limited` from `signUpWithPassword`, `resendSignUpCode` and `sendPasswordResetCode` (the provider's per-address email interval) gives the existing "couldn't send" result, and the app's own 60 s cooldown is checked before every provider call, so the provider's 429 is never what decides. `requestPasswordReset`: identical result for known and unknown addresses; `verifyResetCode` then `setPassword` changes the password, signs out other sessions and returns `redirectTo`; `setPassword` requires a session and a matching confirm field. `repairGoogleAccount`: pending email identity removed, password scrambled (which ends the Google session), the session restored with `openSessionWithoutEmail`, display name and terms overwritten by the Google user's, empty terms version recorded; outdated version returns `redirectTo` `/welcome`; any failure (including `openSessionWithoutEmail`) signs out and returns the Google error message; an existing confirmed password account is untouched.
- [ ] **Step 2: Run; expected FAIL.**
- [ ] **Step 3: Implement.** Order for `signUp`: validate, cooldown and limits, `describeEmail`, branch, `removePendingSignup` if pending, `signUpWithPassword`, self-check with `signInWithPassword`, one retry, result. Order for a foreign code: `verifyCode`, `scramblePassword`, `openSessionWithoutEmail`, then the forced `setPassword` (`updatePassword` works from that recovery session). Never log codes, emails, ids or IPs.
- [ ] **Step 4: Run** `npm run lint && npm run typecheck && npm test`; expected PASS.
- [ ] **Step 5: Commit** `feat: add code-based sign-up, reset and Google repair use-cases`

---

### Task 5: Sign-up and verify pages; delete the link flow

**Files:** Modify `src/app/(auth)/actions.ts`, `src/app/(auth)/signup/page.tsx`, `login/page.tsx`; Create `src/app/(auth)/signup/verify/page.tsx`, `src/client/components/auth/code-form.tsx` (shared by Tasks 5 and 6), `signup-verify-form.tsx`; Modify `signup-form.tsx`, `resend-form.tsx`; Delete `src/app/auth/confirm/**`, `src/server/auth/email-link.ts`, `confirm-page.ts` and tests, link-only e2e tests; Test `e2e/auth.spec.ts`.

**Interfaces:**
- Consumes: Task 4 use-cases. Produces routes: `/signup` (form), `/signup/verify` (code box; reads the pending cookie and falls back to an address field when there is none), actions `signUpAction`, `verifyCodeAction`, `resendCodeAction`, `changeEmailAction` (clears the cookie). `code-form.tsx`: presentational `CodeForm({ email, onResend, cooldownSeconds, ... })` with the one-time-code input (`autocomplete="one-time-code"`, `inputmode="numeric"`, `maxLength` tolerant of pasted separators), Verify, a Resend button with a live countdown, "Change email".
- [ ] **Step 1: Write the failing browser tests** (all three Playwright sizes; use the fake outbox for codes; per-test random `x-forwarded-for`): sign-up then code lands home signed in with the name visible; a wrong code shows the error and keeps the screen, 5 wrong codes show the lock message; `POST /api/test/expire-codes` then the code shows "expired" and Resend works after the countdown; an already-registered address shows the clear message (and the Google message for the Google-only account) and sends nothing; a second sign-up with another password for the same address, then the code from the latest email: only the latest password works (the pre-registration check); the cookie-less path (clear cookies on the verify page, type address and code) signs in and forces "create your password"; reload on the verify page keeps the screen; Change email returns to the form; code box attributes and pasting `"123 456"` and `"123-456"`; double-tap Verify submits once; signed-in visit to `/signup` goes home. Delete the tests for the removed link flow.
- [ ] **Step 2: Run `npm run test:e2e -- e2e/auth.spec.ts`; expected FAIL** for the right reasons.
- [ ] **Step 3: Implement** the pages, actions and components; set and clear the pending cookie in the actions; set the plain `reset_email`-style convenience cookies only where Task 6 needs them; delete the link flow files and any import of them; keep `/login` working and add the hint "Signed up with Google? Use Continue with Google." plus the unconfirmed-account button that sends a new code and opens the code screen.
- [ ] **Step 4: Run** the e2e file, then `npm run lint && npm run typecheck && npm test && npm run build`.
- [ ] **Step 5: Commit** `feat: add the emailed-code sign-up and verify screens and remove the link flow`

---

### Task 6: Forgot password and Google

**Files:** Modify `src/app/(auth)/forgot-password/**`, `reset-password/**`, `welcome/page.tsx`, `src/app/(auth)/actions.ts`, `src/app/auth/callback/route.ts`, `src/client/components/auth/forgot-password-form.tsx`, `reset-password-form.tsx`, `google-button.tsx`, `signup-form.tsx`, `login-form.tsx`; Test `e2e/auth.spec.ts`, `e2e/google.spec.ts`.

**Interfaces:**
- Consumes: Tasks 3 to 5. Behaviour: `/forgot-password` (email) always moves to `/reset-password` with the neutral "If an account exists for that email, we sent a code"; `/reset-password` step 1 code (email from a short-lived cookie or typed), step 2 "Create a new password" (session required), success signs out other devices, signs in, goes home with "Password updated". A forced-create session from Task 5 reuses step 2. The Google button's flow always requests the account chooser; the sentence "By continuing you confirm you are 18 or older and accept the Terms and Privacy Notice" is shown under both buttons on `/signup` and `/login`; `/auth/callback` runs `repairGoogleAccount` (after a scramble it restores the person's session with `openSessionWithoutEmail`, with no second Google trip; if that fails it signs out with the 5.3 error) and applies the terms rule from the spec.
- [ ] **Step 1: Write the failing browser tests**: forgot password for a known and an unknown address shows the same screen; the code then a new password signs in, the old password stops working, and a second signed-in session (another browser context) is signed out; a wrong or expired reset code shows the right message with a resend path; a Google-only account can add a password through Forgot password (fake models it) and then log in with it; Google (fake) shows the chooser URL parameter, lands home with no `/welcome` for a new user, records terms automatically, goes to `/welcome` only when the accepted version is outdated; a Google sign-in for an email with a stranger's pending email sign-up (create it first through the sign-up flow) ends with the stranger's password rejected and the Google user's name; an existing confirmed password account signs into the same account; a failed repair (fake hook) signs out with the error message. The Google spec keeps its own serial project and `POST /api/test/reset`.
- [ ] **Step 2: Run; expected FAIL.**
- [ ] **Step 3: Implement.** The fake's single Google account stays; add a fake hook (`POST /api/test/fail-next-repair`, 404 unless fake, cleared by reset) only if the failed-repair test cannot be done otherwise.
- [ ] **Step 4: Run** the e2e files, then `npm run lint && npm run typecheck && npm test && npm run build`.
- [ ] **Step 5: Commit** `feat: add code-based password reset and the Google account chooser with repair`

---

### Task 7: Quality sweep, CI parity and cleanup

**Files:** Modify `e2e/phone-quality.spec.ts`, `e2e/phone-quality-welcome.spec.ts`, `e2e/helpers.ts`, `playwright.config.ts` (only if projects change), `.github/workflows/ci.yml` (only if needed).

- [ ] **Step 1: Extend the phone sweep** to every new screen (`/signup/verify` with a pending cookie, `/reset-password` code step and new-password step, `/signup` and `/login` with the terms sentence), each with the required landmark/URL expectation and axe, in light and dark at phone-360 and desktop; remove expectations for deleted routes.
- [ ] **Step 2: Run the whole suite** `npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build`, then prove CI parity in a CLEAN CLONE of the committed branch outside the project folder with no `.env` files (`npm ci && npm run lint && npm run typecheck && npm test && npm run build`), and delete the clone.
- [ ] **Step 3: Grep for leftovers** (`confirmEmailToken`, `resendConfirmation`, `sendPasswordReset`, `/auth/confirm`, `token_hash`, `email-link`, `link_expired`, `confirmed=1`) in `src`, `e2e`, `docs`, `README.md`; list every hit in your report and fix code hits.
- [ ] **Step 4: Commit** `test: extend the phone sweep to the code-based registration screens`

---

### Task 8: Docs, setup guide and live acceptance

**Files:** Modify `docs/SETUP_AUTH.md`, `README.md`, the Phase 1 spec's superseded sections (add a pointer), `.env.example` if needed.

- [ ] **Step 1: Rewrite the guide's email-template and Supabase steps for codes only**: **Confirm signup** template: `<h2>Your study-share code</h2><p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p><p>This code expires in 10 minutes. If you did not create an account, ignore this email.</p>`; **Reset password** template likewise ("Use this code to reset your password"); **Email OTP expiration** = 600 seconds; keep Confirm email ON, minimum password 8, Gmail SMTP, redirect URLs (Google only), raised rate limits; remove the Continue-page, Outlook link-scanner and `{{ .RedirectTo }}` encoding checks; update acceptance Part 8 to the spec's acceptance list (codes, cross-device, wrong/expired code, existing email message, Google chooser, Google-only message, reset by code with other devices signed out, the pre-registration check); update the merge gate and troubleshooting.
- [ ] **Step 2: Update README and the spec pointers**; no secrets, placeholders only.
- [ ] **Step 3: Commit** `docs: update the setup guide for emailed codes`
- [ ] **Step 4: [You] with the controller:** apply the two new templates and the 600-second setting in the DEV and PRODUCTION Supabase projects, run `npm run check:auth-behaviour` and `npm run check:services` on dev, `check:services` on production, run the live acceptance on the Vercel preview then production on a real phone and a desktop with real inboxes, then merge only after all of it (merge gate unchanged: production migrations done, `NEXT_PUBLIC_SITE_URL` for Production, redirect URLs, Google set up).

**Done when:** the spec's acceptance list passes on the live site on a phone and a desktop, and every unit, database and browser test passes in CI at phone and desktop sizes.
