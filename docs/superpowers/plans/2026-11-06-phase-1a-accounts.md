# Phase 1a: Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People can sign up (email or Google), confirm their email, log in, reset a forgotten password, accept the Terms, and see a simple account page, all polished on phones and desktop, live on the real site.

**Architecture:** Sign-in sits behind our own `AuthProvider` interface with Supabase Auth as its adapter (cookie sessions via `@supabase/ssr`, refreshed in `src/proxy.ts`). A second, in-memory `AuthProvider` and `RateLimiter` run when `SERVICES_MODE=fake`, so browser tests need no real Supabase, Google or email. Server actions are thin and call use-case functions in `src/server/auth`, which enforce validation, rate limits and neutral responses. A database trigger copies each user's name and terms acceptance into `profiles`.

**Tech Stack:** Next.js 16 (App Router, server actions, `proxy.ts`), TypeScript, `@supabase/ssr` 0.12.x and `@supabase/supabase-js` 2.x, Zod, Drizzle, Tailwind and shadcn/ui, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-06-phase-1-accounts-and-groups-design.md` (sections 1 to 11 apply; this plan covers its step 1a). The earlier plan `docs/PROJECT_PLAN.md` and the layout rules in the Phase 0 plan still apply. Read `AGENTS.md`: this Next.js version differs from older ones, so check `node_modules/next/dist/docs/` before using an API.

## Global Constraints

- Node `26.x`. Install current stable packages; the lockfile pins them.
- Code layout and vendor isolation from Phase 0 stay enforced: `src/client`, `src/server`, `src/shared`, `src/app` (thin routes). `@supabase/*` may be imported only in `src/server/adapters` (this plan adds that lint rule). Settings use vendor-neutral names.
- Free plans only: Supabase free, Vercel Hobby, Gmail SMTP. Supabase sends sign-up and reset emails itself through the project's Gmail account.
- **Confirm first.** Supabase's "Confirm email" stays ON. The confirmation link returns the person to the page they were heading for (for example `/invite/<token>`).
- Account password: at least 8 characters. Display name: 2 to 50 characters.
- One checkbox: "I'm 18 or older and I accept the Terms and Privacy Notice". Store the date and the terms version. Google users see it once, before their first group action.
- Phones first, from 360px up: no sideways scrolling, tap targets at least 44px, inputs at least 16px, correct `autocomplete`, `inputmode` and `type` on every field, visible focus, WCAG AA contrast, skeletons and plain-language errors, bottom areas respect the safe area and stay visible above the keyboard.
- Sign-up with an existing address and password reset for an unknown address both give a neutral message that never reveals whether the address exists.
- Open sign-up is accepted. Rate limits are database-backed and per email and per IP; the per-IP sign-up cap is about 30 attempts an hour so a college network is not locked out. No CAPTCHA.
- No secret, token, password or other person's details in logs, error messages or URLs. A `next` (return-to) value is only ever a same-site path.
- Google sign-in must not trap people in apps' built-in browsers: detect that case and show "Open in your browser" with a copy-link button.
- Conventional Commits. Work reaches `main` by pull request with all CI checks passing. Commit messages end with the attribution line given in the session's system reminder.
- Steps marked **[You]** need the project owner (accounts, dashboards, secrets). Give exact click-by-click guidance and wait. Never ask for secrets in chat.

## Review Focus

1. A `next` value of `//evil.com`, `/\evil.com`, `https://evil.com`, `javascript:alert(1)` or `/%2f%2fevil.com` must go to `/`, never off-site. (Test in Task 1.)
2. A confirmation or reset link that is expired, already used, or opened on a different device than the sign-up shows a clear message with a way to ask for a new one, and never a blank page or a loop. (Task 7.)
3. Signing up with an email that already has an account returns exactly the same response as a new email. (Tasks 3 and 6.)
4. A very long display name, and one in Hindi, Telugu or emoji, truncates in the account menu at 360px with no sideways scroll. (Task 8.)
5. The rate-limit store being unreachable must not crash sign-in or sign-up: it logs and lets the request through, while Supabase's own limits still apply. (Task 6.)

---

## File Structure

```
src/proxy.ts                                  Refreshes the session cookie on each request
src/app/(auth)/{login,signup,forgot-password,reset-password,welcome}/page.tsx
src/app/(auth)/actions.ts                     Server actions (thin): call src/server/auth/use-cases
src/app/auth/confirm/route.ts                 Email link landing (token_hash), same-device or not
src/app/auth/callback/route.ts                Google sign-in landing (code exchange)
src/app/api/test/outbox/route.ts              Test-only: last emailed link (404 unless SERVICES_MODE=fake)
src/app/account/page.tsx, terms/page.tsx, privacy/page.tsx, manifest.ts, page.tsx (home)
src/client/components/auth/                   Forms, fields, Google button, in-app-browser notice, account menu
src/shared/auth-schemas.ts   legal.ts   safe-next-path.ts   in-app-browser.ts
src/server/ports/auth-provider.ts   rate-limiter.ts
src/server/adapters/supabase-auth-provider.ts   supabase-session-proxy.ts   fake-auth-provider.ts   memory-rate-limiter.ts
src/server/db/postgres-rate-limiter.ts   schema.ts (+ rate_limits)   drizzle/0001_*.sql  drizzle/0002_*.sql
src/server/auth/use-cases.ts   rate-limit-policy.ts   session.ts
src/server/site-url.ts   services.ts (+ getAuthProvider, getRateLimiter)   env.ts (+ SERVICES_MODE, NEXT_PUBLIC_SITE_URL)
e2e/auth.spec.ts   e2e/phone-quality.spec.ts   playwright.config.ts   .github/workflows/ci.yml
```

Every unit test sits next to its file as `*.test.ts`. Run unit tests with `npx vitest run --project unit <path>`. Integration tests (real Postgres) run in CI, as in Phase 0; there is no local Postgres.

---

### Task 1: Shared rules (schemas, return-to paths, in-app browsers, legal constants)

**Files:**
- Create: `src/shared/auth-schemas.ts`, `src/shared/safe-next-path.ts`, `src/shared/in-app-browser.ts`, `src/shared/legal.ts`
- Test: `src/shared/auth-schemas.test.ts`, `src/shared/safe-next-path.test.ts`, `src/shared/in-app-browser.test.ts`

**Interfaces:**
- Produces:
  - `signUpSchema`, `loginSchema`, `forgotPasswordSchema`, `resetPasswordSchema`, `displayNameSchema` (Zod). `signUpSchema` fields: `displayName`, `email`, `password`, `acceptTerms` (must be `true`).
  - `safeNextPath(value: unknown, fallback?: string): string` (default fallback `"/"`). Returns a same-site path plus query, else the fallback.
  - `isInAppBrowser(userAgent: string): boolean`.
  - `TERMS_VERSION = "2026-11-06"`, `CONTACT_EMAIL` (placeholder constant the owner fills in Task 10).

- [ ] **Step 1: Write the failing tests**
  - `signUpSchema`: accepts a valid input; rejects a 7-character password, a 1-character and a 51-character name, a bad email, and `acceptTerms: false`; trims names; accepts `"राम"`, `"రాము"` and `"Ana 🙂"`; lowercases and trims the email.
  - `safeNextPath`: `"/invite/abc?x=1"` is returned unchanged; each Review Focus 1 value returns `"/"`; `""`, `undefined`, a number and `"invite"` (no leading slash) return the fallback; a custom fallback is honoured; a value over 500 characters returns the fallback.
  - `isInAppBrowser`: true for sample user agents of Instagram, Facebook (`FBAN`/`FBAV`), LinkedIn and Snapchat in-app browsers and an Android `; wv)` WebView; false for ordinary Chrome, Safari, Firefox and Samsung Internet. WhatsApp links normally open in the default browser, so a plain WhatsApp-sent link in Chrome must be false.

- [ ] **Step 2: Run the tests; expected: FAIL (modules not defined)**

Run: `npx vitest run --project unit src/shared`

- [ ] **Step 3: Implement the signatures above**

`safeNextPath` parses with `new URL(value, "https://placeholder.invalid")` and accepts only when the origin is unchanged, the raw value starts with a single `/` (not `//` or `/\`), and it contains no control characters or backslashes; return `pathname + search`. Passwords are never trimmed.

- [ ] **Step 4: Run the tests; expected: PASS**

- [ ] **Step 5: Commit** `feat: add shared auth rules and return-to path checks`

---

### Task 2: Ports, settings, site address and the vendor lint rule

**Files:**
- Create: `src/server/ports/auth-provider.ts`, `src/server/ports/rate-limiter.ts`, `src/server/site-url.ts`
- Modify: `src/server/env.ts`, `.env.example`, `eslint.config.mjs`
- Test: `src/server/env.test.ts`, `src/server/site-url.test.ts`

**Interfaces:**
- Produces (`auth-provider.ts`):
  ```ts
  export type AuthUser = { id: string; email: string; displayName: string; termsVersion: string | null };
  export type SignInResult = { ok: true } | { ok: false; reason: "invalid_credentials" | "email_not_confirmed" };
  export class AuthProviderError extends Error { code: "rate_limited" | "weak_password" | "unavailable" }
  export interface AuthProvider {
    getUser(): Promise<AuthUser | null>;
    signUpWithPassword(i: { email: string; password: string; displayName: string; termsVersion: string; redirectTo: string }): Promise<void>; // neutral for an existing email
    resendConfirmation(i: { email: string; redirectTo: string }): Promise<void>;                              // neutral
    signInWithPassword(i: { email: string; password: string }): Promise<SignInResult>;
    startGoogleSignIn(i: { redirectTo: string }): Promise<{ url: string }>;
    completeOAuth(code: string): Promise<boolean>;
    confirmEmailToken(i: { tokenHash: string; type: "email" | "recovery" }): Promise<boolean>;
    sendPasswordReset(i: { email: string; redirectTo: string }): Promise<void>;                                // neutral
    updatePassword(newPassword: string): Promise<void>;
    acceptTerms(i: { termsVersion: string }): Promise<void>;
    updateDisplayName(name: string): Promise<void>;
    signOut(): Promise<void>;
  }
  ```
  `redirectTo` is always an absolute URL on the site.
- Produces (`rate-limiter.ts`): `interface RateLimiter { hit(i: { key: string; limit: number; windowSeconds: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }> }`.
- Produces (`site-url.ts`): `getSiteUrl(source?: Record<string, string | undefined>): string`. Uses `NEXT_PUBLIC_SITE_URL`, else `https://${VERCEL_BRANCH_URL}`, else `https://${VERCEL_URL}`, else `http://localhost:3000`; never ends with `/`.
- Settings added to `serverEnvSchema`: `SERVICES_MODE` (`"real" | "fake"`, default `"real"`), `NEXT_PUBLIC_SITE_URL` (optional URL).

- [ ] **Step 1: Write the failing tests**
  - `env.test.ts`: `SERVICES_MODE` defaults to `"real"`; `"fake"` is accepted for `APP_ENV=dev`; `"fake"` is refused (error names `SERVICES_MODE`) when `APP_ENV=production`, when `VERCEL_ENV=production`, and when any setting points at a production project; an invalid value is rejected.
  - `site-url.test.ts`: the four sources in priority order; trailing slash removed; garbage `NEXT_PUBLIC_SITE_URL` falls through to the next source.

- [ ] **Step 2: Run the tests; expected: FAIL**

- [ ] **Step 3: Implement** the two ports (pure types, no vendor names), `getSiteUrl`, and the two settings, plus the `.env.example` entries. In `eslint.config.mjs` add `@supabase/*` to the vendor-SDK group so only `src/server/adapters` may import it.

- [ ] **Step 4: Prove the lint rule works**

Create a temporary file `src/app/zz-probe.ts` with `import { createClient } from "@supabase/supabase-js"`, run `npx eslint src/app/zz-probe.ts` and expect one `no-restricted-imports` error; delete the file. (Install `@supabase/supabase-js` and `@supabase/ssr` first: `npm i @supabase/supabase-js @supabase/ssr`.)

- [ ] **Step 5: Run the tests; expected: PASS. Run** `npm run lint && npm run typecheck`

- [ ] **Step 6: Commit** `feat: add auth ports, test-mode setting and vendor lint rule`

---

### Task 3: Test-mode implementations (fake sign-in, in-memory limiter)

**Files:**
- Create: `src/server/adapters/fake-auth-provider.ts`, `src/server/adapters/memory-rate-limiter.ts`
- Test: `src/server/adapters/auth-provider.contract.test.ts`, `src/server/adapters/rate-limiter.contract.test.ts`

**Interfaces:**
- Consumes: the ports from Task 2.
- Produces:
  - `createFakeAuthProvider(deps: { store: FakeAuthStore; cookies: { get(name: string): string | undefined; set(name: string, value: string): void; delete(name: string): void } }): AuthProvider & { outbox: FakeOutbox }` and `createFakeAuthStore(): FakeAuthStore` (module-level singleton in services so state survives between requests). `FakeOutbox` records `{ to, kind: "confirm" | "reset", url }[]` with `lastFor(email)`.
  - `createMemoryRateLimiter(now?: () => number): RateLimiter` (fixed window per key).
  - The contract test files export `runAuthProviderContract(make: () => AuthProvider)` and `runRateLimiterContract(make)` so the Supabase adapter and the Postgres limiter reuse them where they can run.

- [ ] **Step 1: Write the contract tests** (run against the fakes now)
  Auth: sign-up then sign-in with the same password fails with `email_not_confirmed` until `confirmEmailToken` succeeds with the emailed link's token; sign-up twice with the same email gives the same observable result both times (no throw, same outbox count shape) and does not replace the first password; wrong password gives `invalid_credentials` for both an unknown email and a known one; `getUser()` is null before sign-in and returns name and `termsVersion` after; `acceptTerms` sets `termsVersion`; `signOut` clears the user; a used or unknown token returns `false`; `sendPasswordReset` for an unknown email does not throw and sends nothing; a `recovery` token allows `updatePassword`, after which the old password fails and the new one works; `startGoogleSignIn` returns a URL, and `completeOAuth` with the code from it creates a confirmed user.
  Limiter: the (limit+1)th hit in a window is refused with `retryAfterSeconds > 0`; separate keys are independent; the window resets after `windowSeconds` (using the injected clock).

- [ ] **Step 2: Run; expected: FAIL**
- [ ] **Step 3: Implement** both fakes. The fake provider keeps users, pending tokens and the session in memory and in the cookie jar. It never talks to the network.
- [ ] **Step 4: Run; expected: PASS**
- [ ] **Step 5: Commit** `feat: add fake auth provider and in-memory rate limiter for tests`

---

### Task 4: Database: rate limits and the profile trigger

**Files:**
- Create: `src/server/db/postgres-rate-limiter.ts`, `drizzle/0001_*.sql` (generated), `drizzle/0002_*.sql` (custom SQL, `npx drizzle-kit generate --custom`)
- Modify: `src/server/db/schema.ts`, `scripts/test-db-setup.sql`
- Test: `src/server/db/accounts.int.test.ts` (runs in CI against real Postgres)

**Interfaces:**
- Consumes: `RateLimiter` (Task 2), the existing `profiles` table, `getDb()`.
- Produces: `createPostgresRateLimiter(db: PostgresJsDatabase): RateLimiter`; table `rate_limits (key text, window_start timestamptz, hits integer, primary key (key, window_start))` with Row Level Security on; a trigger function `handle_auth_user_change()` on `auth.users` (insert, and update of `raw_user_meta_data`).
- Trigger behaviour: inserts the user's `profiles` row on sign-up with `display_name` from metadata `display_name`, else `full_name` or `name` (Google), else the part of the email before `@`, trimmed to 50 characters. When metadata carries `terms_version`, sets `terms_version`, `terms_accepted_at` and `age_confirmed_at` once (never overwritten by a later update). A display-name update changes `display_name`. It must be `security definer` with a fixed `search_path`.
- `scripts/test-db-setup.sql` stand-in `auth.users` gains `email text` and `raw_user_meta_data jsonb not null default '{}'`.

- [ ] **Step 1: Write the failing integration tests** (CI)
  - Trigger: inserting into `auth.users` with Google-style metadata creates a profile named from `full_name`; with email-only creates one named from the email prefix; with `terms_version` sets the three fields; a later metadata update with a different `terms_version` does not change `terms_accepted_at`; a `display_name` update changes the name; deleting the auth user deletes the profile (existing cascade).
  - Limiter: the contract suite (`runRateLimiterContract`) against `createPostgresRateLimiter`; concurrent calls (20 in parallel, limit 5) allow exactly 5; the `rate_limits` table has Row Level Security on (the existing RLS test already covers every table).
- [ ] **Step 2: Push the branch and confirm the new CI database job fails** (watch it with `gh pr checks`, or run the test locally if a Postgres is available).
- [ ] **Step 3: Implement** the table (`.enableRLS()`), the limiter (one atomic `insert ... on conflict (key, window_start) do update set hits = rate_limits.hits + 1 returning hits`, and delete rows older than a day opportunistically), and the custom trigger migration.
- [ ] **Step 4: Update `scripts/test-db-setup.sql`, then confirm the CI database job passes.**
- [ ] **Step 5: Commit** `feat: add rate limit table, Postgres limiter and profile trigger`

---

### Task 5: Supabase adapter, session refresh and wiring

**Files:**
- Create: `src/server/adapters/supabase-auth-provider.ts`, `src/server/adapters/supabase-session-proxy.ts`, `src/proxy.ts`
- Modify: `src/server/services.ts`, `scripts/check-services.ts`
- Test: `src/server/adapters/supabase-auth-provider.test.ts`

**Interfaces:**
- Consumes: `AuthProvider` (Task 2), the contract suite (Task 3), `getServerEnv()`.
- Produces:
  - `createSupabaseAuthProvider(deps: { url: string; anonKey: string; cookies: CookieJar }): AuthProvider`, where `CookieJar = { getAll(): { name: string; value: string }[]; setAll(items: { name: string; value: string; options?: object }[]): void }`. A new provider is created per request.
  - `refreshSupabaseSession(request: NextRequest): Promise<NextResponse>` used by `src/proxy.ts` (matcher excludes static files and images). It uses `getClaims()` and copies the refreshed cookies and cache headers onto the response.
  - `getAuthProvider(): Promise<AuthProvider>` and `getRateLimiter(): RateLimiter` in `services.ts`. `SERVICES_MODE=fake` returns the fake provider (singleton store, cookie jar from `next/headers`) and the in-memory limiter; otherwise the Supabase adapter and the Postgres limiter. `getAuthProvider` reads `cookies()` from `next/headers` (async in this Next version).
- Mapping rules the tests pin: invalid login maps to `invalid_credentials`; "Email not confirmed" maps to `email_not_confirmed`; a 429 or over-quota response maps to `AuthProviderError("rate_limited")`; a password-policy error maps to `weak_password`; network failures map to `unavailable`; sign-up for an already registered address returns normally; `getUser()` uses `getClaims()` and maps `user_metadata` (`display_name`, `full_name`, `terms_version`) to `AuthUser`; no error message or log line contains a password or token.

- [ ] **Step 1: Write the failing tests** with a stand-in for the Supabase client object (a minimal fake injected as an optional second argument `client?`), covering every mapping rule above plus: `startGoogleSignIn` passes `provider: "google"` and the `redirectTo`; `acceptTerms` writes `terms_version`, `terms_accepted_at` and `age_confirmed_at` into user metadata; `confirmEmailToken` calls `verifyOtp` with the token hash and type and returns `false` on error.
- [ ] **Step 2: Run; expected: FAIL**
- [ ] **Step 3: Implement** the adapter and the proxy. Wire `services.ts`. Check `node_modules/next/dist/docs/` for the `proxy.ts` rules; the proxy must not import `server-only` code.
- [ ] **Step 4: Run the unit tests; expected: PASS**
- [ ] **Step 5: Extend `scripts/check-services.ts`** with an "auth" check through `getAuthProvider` using an in-memory cookie jar: create a throwaway user with the service-role key (admin API), confirm it, sign in through the port, read `getUser()`, sign out, and delete the user. It prints `PASS auth` or `FAIL auth` and always deletes the user. **[You]** run `npm run check:services` against dev, then production, and report PASS or FAIL.
- [ ] **Step 6: Commit** `feat: add Supabase auth adapter, session refresh and service wiring`

---

### Task 6: Auth use-cases (validation, rate limits, neutral results)

**Files:**
- Create: `src/server/auth/use-cases.ts`, `src/server/auth/rate-limit-policy.ts`, `src/server/auth/session.ts`
- Test: `src/server/auth/use-cases.test.ts`

**Interfaces:**
- Consumes: `AuthProvider`, `RateLimiter`, the schemas and `safeNextPath` (Task 1), `getSiteUrl`.
- Produces:
  ```ts
  export type Deps = { auth: AuthProvider; limiter: RateLimiter; siteUrl: string; ip: string };
  export type ActionResult<T = void> =
    | { ok: true; data: T }
    | { ok: false; fieldErrors?: Record<string, string>; formError?: string; retryAfterSeconds?: number };
  signUp(deps, raw: unknown, next: unknown): Promise<ActionResult<{ status: "check_email" }>>
  logIn(deps, raw: unknown, next: unknown): Promise<ActionResult<{ redirectTo: string }>>   // formError "confirm_email" when unconfirmed
  resendConfirmation(deps, raw: unknown, next: unknown): Promise<ActionResult>
  requestPasswordReset(deps, raw: unknown): Promise<ActionResult<{ status: "check_email" }>>
  resetPassword(deps, raw: unknown): Promise<ActionResult>
  startGoogle(deps, next: unknown): Promise<ActionResult<{ url: string }>>
  acceptTerms(deps, raw: unknown, next: unknown): Promise<ActionResult<{ redirectTo: string }>>
  updateProfile(deps, raw: unknown): Promise<ActionResult>
  getCurrentUser(): Promise<AuthUser | null>   // session.ts, wrapped in React cache()
  requireUser(next: string): Promise<AuthUser>  // redirects to /login?next=<safe path>
  requireAcceptedTerms(next: string): Promise<AuthUser> // redirects to /welcome?next=...
  ```
  `rate-limit-policy.ts` exports the constants: sign-up 5 per email per hour and 30 per IP per hour; log-in 10 per email per 15 minutes and 100 per IP per hour; password reset 3 per email per hour and 30 per IP per hour; password update 10 per user per hour; resend 3 per email per hour.

- [ ] **Step 1: Write the failing tests** (fake provider and memory limiter)
  Sign-up: invalid fields return `fieldErrors` keyed by field and call nothing; success calls the provider once with `redirectTo = siteUrl + safeNextPath(next)` (an absolute address; the confirm route reads it back as `redirect_to` and keeps only its path and query) and returns `check_email`; an existing email returns the same result as a new one (Review Focus 3); a 6th attempt for one email in an hour returns `retryAfterSeconds > 0` and does not call the provider; the 31st attempt from one IP is refused while another IP is not; emails are case-insensitive for limiting.
  Log-in: a good login returns `redirectTo = safeNextPath(next)`; a bad `next` like `//evil.com` becomes `/`; wrong credentials return one generic `formError` for unknown and known emails alike; `email_not_confirmed` returns `formError: "confirm_email"`; the 11th failure for an email in 15 minutes is refused.
  Reset: `requestPasswordReset` for an unknown email returns `check_email` and sends nothing; `resetPassword` needs a matching confirm password and at least 8 characters; success signs the person in and revokes nothing else here.
  Terms: `acceptTerms` requires the checkbox and `TERMS_VERSION`, and returns the safe next path.
  Limiter failure: a limiter whose `hit` throws makes `signUp` and `logIn` still succeed and log one warning (Review Focus 5).
  `requireUser` and `requireAcceptedTerms`: unit-test their redirect target logic through a small pure helper `authRedirectTarget(user, path)` exported from `session.ts`.
- [ ] **Step 2: Run; expected: FAIL**
- [ ] **Step 3: Implement.** Limiter errors are caught, logged without the key, and treated as allowed. Normalise emails (`trim`, lower case) before limiting and before calling the provider.
- [ ] **Step 4: Run; expected: PASS**
- [ ] **Step 5: Commit** `feat: add auth use-cases with rate limits and neutral responses`

---

### Task 7: Auth pages and routes (phone-first)

**Files:**
- Create: the `(auth)` pages, `src/app/(auth)/actions.ts`, `src/app/auth/confirm/route.ts`, `src/app/auth/callback/route.ts`, `src/app/api/test/outbox/route.ts`, `src/app/terms/page.tsx`, `src/app/privacy/page.tsx`, and components under `src/client/components/auth/` (`AuthCard`, `TextField`, `PasswordField` with show/hide, `SubmitButton` with pending state, `GoogleButton`, `InAppBrowserNotice`, `FormMessage`)
- Modify: `playwright.config.ts`, `e2e/shell.spec.ts` (keep passing)
- Test: `e2e/auth.spec.ts`

**Interfaces:**
- Consumes: the use-cases and `getAuthProvider` (Tasks 5 and 6), `safeNextPath`, `isInAppBrowser`, `TERMS_VERSION`, `CONTACT_EMAIL`.
- Produces routes: `/signup`, `/login`, `/forgot-password`, `/reset-password`, `/welcome`, `/terms`, `/privacy`, `GET /auth/confirm?token_hash&type&redirect_to`, `GET /auth/callback?code&next`, `GET /api/test/outbox?email=` (JSON `{ url }`, 404 unless `SERVICES_MODE=fake`).
- Behaviour:
  - Forms use `useActionState`, show field errors tied to the field with `aria-describedby`, keep typed values after an error, disable the button while pending, and use these attributes: email `type=email inputmode=email autocomplete=email autocapitalize=none`; sign-up password `autocomplete=new-password`; login password `autocomplete=current-password`; name `autocomplete=name`.
  - `/auth/confirm` verifies the token, then redirects to `safeNextPath(redirect_to)` (taking only its path and query). Failure redirects to `/login?error=link_expired`, which shows "This link has expired or was already used" and a resend form. `recovery` links go to `/reset-password`.
  - `/auth/callback` exchanges the code, then redirects to the safe `next`, or to `/welcome?next=` when the person has not accepted the Terms.
  - `/welcome` shows the single checkbox and redirects away when terms are already accepted. Sign-up sets the terms through user metadata at sign-up; Google users accept here.
  - `GoogleButton` is replaced by `InAppBrowserNotice` (with a copy-link button) when the user agent is an in-app browser.
  - Pages carry the highlighter look from `globals.css` (see the Phase 0 design), skeleton and error states, and read well in light and dark.

- [ ] **Step 1: Set up Playwright for real phone checks.** In `playwright.config.ts` set projects `desktop` (1280x800), `phone-360` (Pixel 5 profile with viewport 360x740, touch, mobile user agent) and `phone-412` (Pixel 7). In `webServer.env` set `SERVICES_MODE=fake`, `APP_ENV=dev` and valid-shaped dummy values for every required setting, all pointing at the fake project id `e2eproj` (for example `NEXT_PUBLIC_SUPABASE_URL=https://e2eproj.supabase.co`, `STORAGE_ENDPOINT=https://e2eproj.storage.supabase.co/storage/v1/s3`, `DATABASE_URL=postgres://postgres.e2eproj:x@localhost:6543/postgres`).
- [ ] **Step 2: Write the failing browser tests** in `e2e/auth.spec.ts` (all three projects unless noted):
  - Sign-up with the fake provider: fill the form, submit, see "Check your email"; fetch the link from `/api/test/outbox`, open it, land on `/` signed in with the name visible.
  - Sign-up with an email that already exists shows the identical "Check your email" screen.
  - Wrong password shows one generic error and keeps the email typed in; correct login lands on the `next` path; a `next=//evil.com` lands on `/`.
  - Unconfirmed account login shows the "confirm your email" message with a Resend button.
  - Expired or reused confirmation link lands on `/login?error=link_expired` with the explanation and resend form (Review Focus 2).
  - Forgot password for an unknown and a known address show the same message; the reset link opens `/reset-password`; setting a new password logs the person in; the old password no longer works.
  - Terms: sign-up without the checkbox shows the field error; the Google fake flow goes through `/welcome` once, and a second visit skips it.
  - Google button hidden and "Open in your browser" shown when the user agent contains `Instagram`.
  - Every field has the right `autocomplete`/`type`; the first invalid field receives focus on submit.
  - `/terms` and `/privacy` load without sign-in and show `CONTACT_EMAIL`.
- [ ] **Step 3: Run; expected: FAIL** `npm run test:e2e -- e2e/auth.spec.ts`
- [ ] **Step 4: Implement** the pages, routes and components. Draft short plain-language Terms and Privacy text (what is collected: name, email, group membership; files and messages arrive in later phases; who sees it; 18+; how to ask for deletion; contact). Mark both pages with a visible line "Pilot version, to be reviewed before public launch".
- [ ] **Step 5: Run; expected: PASS on all three projects.** Also run `npm run lint && npm run typecheck && npm test && npm run build`.
- [ ] **Step 6: Commit** `feat: add sign-up, log-in, reset and terms pages`

---

### Task 8: Home, account menu and installable icon

**Files:**
- Create: `src/client/components/auth/account-menu.tsx`, `src/app/account/page.tsx`, `src/app/manifest.ts`, icon route(s) for 192px and 512px PNGs
- Modify: `src/app/page.tsx`, `src/client/components/app-shell/app-shell.tsx`
- Test: `e2e/account.spec.ts`

**Interfaces:**
- Consumes: `getCurrentUser`, `requireUser`, `requireAcceptedTerms`, `updateProfile`.
- Produces: `/` signed out shows a short pitch with Sign up and Log in (phone-first, same look); signed in shows the app shell with the empty state "Create a group" and "Join with a code" (both disabled with an honest "Coming in the next step" note until Task 1b); the header holds `AccountMenu` (name, Account, Log out); `/account` edits the display name and logs out; `manifest.ts` returns name, short name, start URL `/`, `display: "standalone"`, theme and background colours from the palette, and icons 192 and 512; the icons are generated (for example with `next/og` `ImageResponse`) showing the highlighter mark.

- [ ] **Step 1: Write the failing browser tests**
  - Signed out: `/` shows Sign up and Log in; signed in: the account menu shows the name; Log out returns to `/` signed out; `/account` redirects to `/login?next=/account` when signed out.
  - Display name change persists and shows in the menu.
  - Review Focus 4: sign in as a user named with 120 characters, then `"राम राम राम राम राम राम राम राम राम"`, then `"Ana 🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂"`: at `phone-360` the menu button text is truncated (its `scrollWidth` exceeds `clientWidth` only inside the truncating element) and the document has no sideways scroll.
  - `GET /manifest.webmanifest` returns JSON with `display: "standalone"` and two icons whose URLs return `image/png` of the right sizes.
- [ ] **Step 2: Run; expected: FAIL**
- [ ] **Step 3: Implement.** Keep the Phase 0 sidebar and bottom area behaviour working; this task does not build the group tabs (step 1b does).
- [ ] **Step 4: Run; expected: PASS on all three projects.** Run the full checks.
- [ ] **Step 5: Commit** `feat: add home states, account page, menu and web app manifest`

---

### Task 9: Phone quality sweep and CI

**Files:**
- Create: `e2e/phone-quality.spec.ts`
- Modify: `.github/workflows/ci.yml`, the existing shell test (`e2e/shell.spec.ts`)

**Interfaces:**
- Produces: one reusable helper `auditPage(page)` in the spec that fails a test when, on the current page: the document scrolls sideways; any visible button, link or input is smaller than 44px in height or width (inline text links inside paragraphs excepted); any visible text input has a computed font size under 16px; any visible control lacks an accessible name; the `<html>` has no `lang`.

- [ ] **Step 1: Write the failing sweep.** Run `auditPage` on `/`, `/login`, `/signup`, `/forgot-password`, `/reset-password` (via a fake recovery link), `/welcome` (Google fake user), `/account`, `/terms`, `/privacy`, at `phone-360` and `desktop`, in light and dark. Replace the vacuous 360px test in `shell.spec.ts` by opening the sidebar sheet and asserting the long group name is truncated (the Phase 0 deferred finding).
- [ ] **Step 2: Run; expected: FAIL** where tap targets or font sizes are short. Fix the components (not the audit) until it passes.
- [ ] **Step 3: Update `ci.yml`:** add `permissions: contents: read`; run e2e against `npm run build && npm run start` (production build) instead of `next dev`; keep the artifact upload on failure. Give the e2e job the same dummy settings through the Playwright config, not secrets.
- [ ] **Step 4: Run the whole suite locally; push; confirm all CI jobs pass.**
- [ ] **Step 5: Commit** `test: add phone quality sweep and run browser tests on a production build`

---

### Task 10: Owner setup, live acceptance and wrap-up

**Files:**
- Modify: `src/shared/legal.ts` (`CONTACT_EMAIL`), `README.md`, `.env.example`
- Create: `docs/SETUP_AUTH.md` (the owner steps below, kept for later environments)

- [ ] **Step 1: [You] Supabase, in both the dev and the production project.** Authentication → URL Configuration: Site URL is the project's address; add redirect URLs for production, localhost and Vercel previews (`https://study-share-amber.vercel.app/**`, `http://localhost:3000/**`, and the preview pattern for your Vercel team). Authentication → Sign In / Providers: Email enabled, **Confirm email ON**, minimum password length 8. Authentication → SMTP: custom SMTP with the Gmail account (host `smtp.gmail.com`, port 465, the app password). Authentication → Rate Limits: set the emails-per-hour limit to a value Gmail can sustain but that still fits the class on launch day, and **raise the per-IP Auth rate limits** (sign-up/sign-in, token verification, token refresh) to fit the class: every auth call comes from Vercel's servers, so Supabase may count all users under Vercel's egress IP as one visitor. (The app adds its own one-email-a-minute cooldown per address, and when Supabase refuses an email the person is told it could not be sent.)
  - **Site URL is ONE value per Supabase project**, and email links are built from it. Preview confirm links therefore go to the dev project's Site URL: during acceptance set the dev project's Site URL to the stable branch alias `https://study-share-git-feature-phase-1a-accounts-amos-6f52.vercel.app` and add that address (with `/**`) to the dev project's redirect URLs.
- [ ] **Step 2: [You] Email templates**, in both projects: replace the links in **Confirm signup** and **Reset password** with server links so they work on any device:
  - Confirm signup: `<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&redirect_to={{ .RedirectTo }}">Confirm your email</a>`
  - Reset password: `<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&redirect_to={{ .SiteURL }}/reset-password">Choose a new password</a>`
  Confirm in Supabase's reference that `recovery` is the right type name; if it differs, update `confirmEmailToken` and its tests.
  The link shape is unchanged by the Continue page: opening `/auth/confirm` shows a "Continue" button and only that button uses the token, so mail scanners (Outlook / Microsoft 365 Safe Links) cannot use up the link. Send yourself a sign-up whose `next` contains `&` (for example `/signup?next=%2Fprivacy%3Fa%3D1%26b%3D2`) and check in the received email that `{{ .RedirectTo }}` arrives URL-encoded (`%26`, not a bare `&` that would cut `redirect_to` short).
- [ ] **Step 3: [You] Google.** Google Cloud: a project, OAuth consent screen (External), **publish it to production** (not "Testing"), scopes `openid`, `email` and `profile` only; create a Web OAuth client with the authorised redirect URI shown in Supabase's Google provider page (`https://<project-ref>.supabase.co/auth/v1/callback`); paste the client id and secret into Supabase's Google provider, in dev and production. Also confirm Supabase "Allow manual linking" and "Automatically link accounts with same verified email" behave as the spec says (Google into an existing confirmed password account signs into that account).
- [ ] **Step 4: [You] Vercel.** Add `NEXT_PUBLIC_SITE_URL` for **Production only** (the live address). It is now **required** when `APP_ENV=production`: production refuses to start without it. Leave it unset for Preview so each preview uses its own branch address. Then redeploy.
- [ ] **Step 5: [You] Migrations.** `CONTACT_EMAIL` has already been set to the project mailbox (done, owner-approved; it is shown publicly on the Privacy and Terms pages). Run `npm run db:migrate` for dev, then for production (the production run uses only `.env.production.local`, as before: `node --env-file=.env.production.local ./node_modules/drizzle-kit/bin.cjs migrate`). The local `.env.production.local` must also contain `NEXT_PUBLIC_SITE_URL` (the live address), because production settings now require it; without it `check:services` on production fails. The owner guide `docs/SETUP_AUTH.md` supersedes the in-folder command shown here: it recommends keeping the production file outside the OneDrive-synced folder and passing its full path. **Migrations 0001 to 0003 must be applied to PRODUCTION before anything merges to main**: without them production has no `profiles` or `rate_limits` tables.
- [ ] **Step 6: Live acceptance on the Vercel preview, then production**, on a real phone and a desktop: sign up by email and open the email link on a different device than the sign-up; tap Continue, see "Your email is confirmed. Log in to continue." and log in (the link confirms but does not sign in, see the spec's "Same email, two ways in"); open the confirmation and reset links from an **Outlook / Microsoft 365 mailbox as well as Gmail** (the Continue page exists for their link scanners), and check an expired or reused reset link ends on "This reset link has expired or was already used"; sign up with Google (check the `/welcome` step and the "Open in your browser" notice by opening the link inside an Instagram or Facebook in-app browser if you can); log out and back in; request a password reset and use it; change the display name; open `/terms` and `/privacy`; add the site to the home screen and open it.
- [ ] **Step 7: Verify** `/api/health` still returns `ok` on production. Run `npm run check:auth-behaviour` and `npm run check:services` on **dev**, and `npm run check:services` only on production (`check:auth-behaviour` creates and deletes test users and refuses production settings). The local `.env.production.local` must also contain `NEXT_PUBLIC_SITE_URL` (the live address) or `check:services` on production fails. As in Step 5, `docs/SETUP_AUTH.md` supersedes the in-folder file path and recommends keeping the production file outside the OneDrive-synced folder. If `check:auth-behaviour` ever reports that the LATEST password wins, revisit the spec's "Same email, two ways in".
- [ ] **Operations (from the pilot on):** delete unconfirmed users older than 7 days (Supabase dashboard, or SQL on `auth.users` where `email_confirmed_at is null and created_at < now() - interval '7 days'`), so a pending account someone created with another person's address does not linger; and watch the logs for "Auth provider refused to send an email (rate limited)".
- [ ] **Merge gate:** the first merge to main happens only after all of the above: Steps 1 to 5 done in both projects, production migrations 0001 to 0003 applied, `NEXT_PUBLIC_SITE_URL` set for Production, `CONTACT_EMAIL` filled, the live checks of Step 7 on dev, and acceptance passed on the preview.
- [ ] **Step 8: Update `README.md`** (new settings, `SERVICES_MODE`, `npm run check:services` covers auth). The README part is done (see the updated `README.md` and the new `docs/SETUP_AUTH.md`); the rest is still to do. Commit `docs: add auth setup guide`, open the pull request, wait for CI, and ask the owner to approve the merge. After merging, confirm the live site again.

**Phase 1a is done when:** two real people can sign up (one by email, one with Google), confirm, log in, reset a password and see their account on the live site on a phone and on a desktop, and every unit, database and browser test passes in CI at phone and desktop sizes.
