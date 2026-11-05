# Phase 0: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed, empty but polished app shell with CI, a dev and production database, and verified connections to every service, so a pull request gets checks and a preview link, and merging deploys to production.

**Architecture:** One Next.js App Router app. Server code reaches Postgres through Drizzle, with Row Level Security on every table. All authorisation goes through a single `can()` function. Vercel's Preview environment points at the dev Supabase project, and Production points at the production one.

**Tech Stack:** Next.js, TypeScript, Tailwind CSS, shadcn/ui, next-themes, Drizzle ORM, postgres.js, Supabase, Cloudflare R2, Sentry, Zod, Vitest, Playwright, GitHub Actions, Vercel. Node 26.

**Spec:** `docs/PROJECT_PLAN.md`

## Global Constraints

- Node `26.x`, set in `package.json` `engines` and `.nvmrc`.
- Install current stable package versions with `@latest`; the lockfile pins them.
- Supabase region Mumbai (`ap-south-1`). Vercel functions region `bom1`.
- Secrets never enter git or chat. They live in `.env.local` (git-ignored), Vercel settings and GitHub Actions secrets. `.env.example` lists names only.
- Code layout: `src/client/` (components, hooks, browser-only code), `src/server/` (database, permissions, env, email, storage; every file starts with `import "server-only"`), `src/shared/` (types and Zod schemas used by both), `src/app/` (thin routes only). Client and server never import each other, and shared imports neither. ESLint enforces this.
- Row Level Security is enabled on every table in `public`, with no public access.
- Layout has no sideways scrolling from 360px upward. Polish targets 1024px and up.
- Light and dark themes, WCAG AA contrast, visible keyboard focus.
- No spending: Vercel Hobby built-in environments only, no custom environments.
- Conventional Commits. Work reaches `main` by pull request once Task 7 is complete.
- Steps marked **[You]** need the project owner, because they involve accounts, payment methods or secrets. Give exact click-by-click guidance and wait for confirmation.

## Review Focus

1. A required environment variable is missing: the app fails with a message naming the variable, and never prints any secret's value. Test in Task 3.
2. A Preview deployment is accidentally given production settings: it refuses to start rather than touching real data. Test in Task 3.
3. The database is down or paused: `/api/health` returns 503 with no connection details in the body. Test in Task 5.
4. A very long group name appears on a 360px phone: it truncates and the page doesn't scroll sideways. Test in Task 2.
5. Browser storage is blocked, or a dark theme was saved earlier: the page still renders with no crash or hydration error. Test in Task 2.

---

## File Structure

```
.github/workflows/ci.yml             Checks for every pull request
.github/workflows/health-check.yml   Scheduled health request
drizzle/                             Generated and hand-edited migrations
drizzle.config.ts
e2e/shell.spec.ts                    Browser tests at both screen sizes
playwright.config.ts
scripts/check-services.ts            Verifies real service connections
scripts/test-db-setup.sql            Stub of Supabase's auth schema for CI
sentry.client.config.ts, sentry.server.config.ts, instrumentation.ts
src/app/layout.tsx, page.tsx, globals.css
src/app/api/health/route.ts
src/client/components/app-shell/app-shell.tsx, group-sidebar.tsx, theme-toggle.tsx
src/server/db/client.ts, schema.ts, rls.int.test.ts
src/server/env.ts, env.test.ts
src/server/health.ts, health.test.ts
src/server/permissions/index.ts, index.test.ts
vercel.json, vitest.config.ts, .env.example, .nvmrc
```

---

### Task 1: Project scaffold

**Files:**
- Create: Next.js scaffold, `.nvmrc`, `vitest.config.ts`, `src/shared/smoke.test.ts`, `.gitattributes`
- Modify: `package.json`, `.gitignore`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `lint`, `typecheck`, `test` (unit, `vitest run --exclude "**/*.int.test.ts"`), `test:int` (`vitest run --include "**/*.int.test.ts"`), `test:e2e`, and the `@/*` import alias.

- [ ] **Step 1: Commit the plans to `main` first**

```bash
git add docs
git commit -m "docs: add project plan and phase 0 plan"
git checkout -b feature/phase-0-foundation
```

- [ ] **Step 2: Generate the app**

Run: `npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes`
Expected: app created with `docs/` intact. If the tool refuses because the folder isn't empty, generate in a temporary folder and move the files in.

- [ ] **Step 3: Configure the project**

Set `package.json` `name` to the chosen product slug, `private: true`, and `engines.node` to `26.x`. Write `26` to `.nvmrc`. Add `* text=auto eol=lf` to `.gitattributes`. Confirm `.gitignore` ignores `.env*` except `!.env.example`. Add the scripts listed above. Install `vitest` and configure the `@/*` alias.

- [ ] **Step 4: Write a smoke test in `src/shared/smoke.test.ts`**

```ts
import { expect, test } from "vitest";
test("test runner works", () => expect(1 + 1).toBe(2));
```

- [ ] **Step 5: Verify**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all exit 0.

Run: `git check-ignore .env.local`
Expected: prints `.env.local`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold next.js app with typescript and vitest"
```

---

### Task 2: Design system and responsive app shell

**Files:**
- Create: `src/client/components/app-shell/app-shell.tsx`, `group-sidebar.tsx`, `theme-toggle.tsx`, `e2e/shell.spec.ts`, `playwright.config.ts`, shadcn components under `src/client/components/ui/`
- Modify: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`

**Interfaces:**
- Produces: `AppShell({ groups, activeGroupId, children })` where `groups: { id: string; name: string }[]`. `ThemeToggle()`. Colour tokens in `globals.css` under `:root` and `.dark`: background, foreground, muted, border, primary, destructive.

The shell follows the "Main screen sketch" in section 5 of the spec. Below 1024px the sidebar collapses into a shadcn `Sheet` opened by a menu button. `page.tsx` renders a placeholder empty state, with sample groups passed as props including one 120-character name. Use `next-themes` with `attribute="class"` and `suppressHydrationWarning` on `<html>`.

- [ ] **Step 1: Set up Playwright**

Install `@playwright/test`. Configure projects `desktop` (1280x800) and `phone` (360x740) on Chromium, with `webServer` running `npm run dev`. Run `npx playwright install chromium`.

- [ ] **Step 2: Write the failing tests in `e2e/shell.spec.ts`**

```ts
test("no sideways scroll, including a very long group name", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("group list is reachable at this screen size", async ({ page }, info) => {
  await page.goto("/");
  if (info.project.name === "phone") {
    await page.getByRole("button", { name: "Open group list" }).click();
  }
  await expect(page.getByRole("navigation", { name: "Groups" })).toBeVisible();
});

test("saved dark theme loads with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(errors).toEqual([]);
});

test("page renders when browser storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() { throw new Error("blocked"); },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /theme/i })).toBeVisible();
});

test("theme toggle switches theme with the keyboard", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: /theme/i });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveClass(/dark/);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:e2e`
Expected: FAIL, the shell doesn't exist yet.

- [ ] **Step 4: Run `npx shadcn@latest init` and add `button`, `sheet`, `dropdown-menu`, `skeleton`, `sonner`**

- [ ] **Step 5: Implement the tokens, `ThemeToggle`, `GroupSidebar` and `AppShell`**

Long names truncate with an ellipsis, and the full name is available through `title`. Both themes must meet WCAG AA contrast. Apply the `frontend-design` skill so the shell has a distinct look rather than a default template.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:e2e`
Expected: PASS on both `desktop` and `phone`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add design tokens and responsive app shell"
```

---

### Task 3: Environment validation

**Files:**
- Create: `src/server/env.ts`, `src/server/env.test.ts`, `.env.example`

**Interfaces:**
- Produces: `parseServerEnv(source: Record<string, string | undefined>): ServerEnv`, and `getServerEnv(): ServerEnv` (parses `process.env` once and caches). Throws `EnvError`.
- `ServerEnv` keys: `APP_ENV` (`"dev" | "production"`), `DATABASE_URL`, `DATABASE_MIGRATION_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `SMTP_USER`, `SMTP_APP_PASSWORD`, `NEXT_PUBLIC_SENTRY_DSN`.
- `getServerEnv()` is read only when needed, never at import time, so `next build` works without secrets.

- [ ] **Step 1: Write the failing tests in `src/server/env.test.ts`**

```ts
const valid = { /* every key above, with fake values */ };

test("returns parsed values when all are present", () => {
  expect(parseServerEnv(valid).APP_ENV).toBe("dev");
});

test("names the missing variable and hides other values", () => {
  const { DATABASE_URL, ...rest } = valid;
  const message = captureError(() => parseServerEnv({ ...rest, R2_SECRET_ACCESS_KEY: "s3cret" }));
  expect(message).toContain("DATABASE_URL");
  expect(message).not.toContain("s3cret");
});

test("refuses production settings on a Preview deployment", () => {
  expect(() =>
    parseServerEnv({ ...valid, APP_ENV: "production", VERCEL_ENV: "preview" }),
  ).toThrow(/preview/i);
});

test("refuses dev settings on a Production deployment", () => {
  expect(() =>
    parseServerEnv({ ...valid, APP_ENV: "dev", VERCEL_ENV: "production" }),
  ).toThrow(/production/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/env.test.ts`
Expected: FAIL, `parseServerEnv` not defined.

- [ ] **Step 3: Implement `src/server/env.ts` with Zod, and write `.env.example` with every key and blank values**

Report only the names of invalid variables.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/env.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/env.ts src/server/env.test.ts .env.example
git commit -m "feat: validate server environment variables"
```

---

### Task 4: Permissions module

**Files:**
- Create: `src/server/permissions/index.ts`, `src/server/permissions/index.test.ts`

**Interfaces:**
- Produces:
  - `type Role = "owner" | "admin" | "member"`
  - `type MemberStatus = "active" | "pending" | "removed"`
  - `type Action = "group.view"` (later phases add to this union)
  - `type Actor = { id: string } | null`
  - `type GroupContext = { membership: { role: Role; status: MemberStatus } | null }`
  - `can(user: Actor, action: Action, group: GroupContext): boolean`

- [ ] **Step 1: Write the failing tests in `src/server/permissions/index.test.ts`**

```ts
const user = { id: "u1" };
const member = (status: MemberStatus, role: Role = "member") => ({ membership: { role, status } });

test.each(["owner", "admin", "member"] as const)("active %s can view", (role) => {
  expect(can(user, "group.view", member("active", role))).toBe(true);
});
test("signed-out visitor is denied", () => {
  expect(can(null, "group.view", member("active"))).toBe(false);
});
test("non-member is denied", () => {
  expect(can(user, "group.view", { membership: null })).toBe(false);
});
test.each(["pending", "removed"] as const)("%s member is denied", (status) => {
  expect(can(user, "group.view", member(status))).toBe(false);
});
test("unknown action is denied", () => {
  expect(can(user, "group.nuke" as Action, member("active", "owner"))).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/permissions`
Expected: FAIL, `can` not defined.

- [ ] **Step 3: Implement `can()`**

Deny by default. Look up the action in a `Record<Action, Role[]>` table, and allow only for an actor with an `active` membership whose role is listed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/permissions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/permissions
git commit -m "feat: add deny-by-default permissions module"
```

---

### Task 5: Database foundation and health check

**Files:**
- Create: `drizzle.config.ts`, `src/server/db/schema.ts`, `src/server/db/client.ts`, `src/server/db/rls.int.test.ts`, `scripts/test-db-setup.sql`, `src/server/health.ts`, `src/server/health.test.ts`, `src/app/api/health/route.ts`, `vercel.json`, `.github/workflows/health-check.yml`, `drizzle/`

**Interfaces:**
- Consumes: `getServerEnv()` from Task 3.
- Produces:
  - `getDb()` in `src/server/db/client.ts`: a lazily created Drizzle client using `postgres(DATABASE_URL, { prepare: false, max: 1 })`, because Supabase's transaction pooler doesn't support prepared statements.
  - `profiles` table: `id uuid primary key references auth.users(id) on delete cascade`, `display_name text not null`, `avatar_url text`, `age_confirmed_at timestamptz`, `terms_accepted_at timestamptz`, `terms_version text`, `created_at timestamptz not null default now()`.
  - `checkHealth(pingDatabase: () => Promise<void>): Promise<{ httpStatus: 200 | 503; body: { status: "ok" | "degraded"; db: "ok" | "error" } }>`.
  - Scripts `db:generate` and `db:migrate` (`db:migrate` uses `DATABASE_MIGRATION_URL`).

- [ ] **Step 1: Write the failing test in `src/server/health.test.ts`**

```ts
test("reports healthy when the database responds", async () => {
  expect(await checkHealth(async () => {})).toEqual({
    httpStatus: 200, body: { status: "ok", db: "ok" },
  });
});

test("reports 503 and hides connection details when the database fails", async () => {
  const result = await checkHealth(async () => {
    throw new Error("connect postgres://user:hunter2@db.example.com failed");
  });
  expect(result.httpStatus).toBe(503);
  expect(result.body).toEqual({ status: "degraded", db: "error" });
  expect(JSON.stringify(result)).not.toContain("hunter2");
});
```

- [ ] **Step 2: Write the failing test in `src/server/db/rls.int.test.ts`**

Runs only when `TEST_DATABASE_URL` is set, and CI must set it. In CI, fail rather than skip if it's missing.

```ts
test("every table in public has Row Level Security enabled", async () => {
  const rows = await sql`
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;
  expect(rows.map((r) => r.relname)).toEqual([]);
});

test("the profiles table exists", async () => {
  const [row] = await sql`select to_regclass('public.profiles') as t`;
  expect(row.t).toBe("profiles");
});
```

- [ ] **Step 3: Run the unit test to verify it fails**

Run: `npx vitest run src/server/health.test.ts`
Expected: FAIL, `checkHealth` not defined.

- [ ] **Step 4: Implement `checkHealth`, the schema and the client**

Reference `auth.users` using Drizzle's Supabase helper. Run `npm run db:generate`, then edit the migration to add `ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;`. `scripts/test-db-setup.sql` creates `auth` schema and a minimal `auth.users (id uuid primary key)`, for plain Postgres in CI only.

- [ ] **Step 5: Implement `src/app/api/health/route.ts`**

`GET` calls `checkHealth` with a `select 1`, sets `Cache-Control: no-store`, and uses `export const dynamic = "force-dynamic"`. Wrap `getServerEnv()` inside the ping so a missing variable returns 503 rather than crashing.

- [ ] **Step 6: Add `vercel.json` and the scheduled workflow**

`vercel.json`: `{ "regions": ["bom1"] }`.

`health-check.yml`: runs on `schedule` at `0 6 */3 * *`, plus `workflow_dispatch`, and sends `curl --fail` to the `HEALTH_URL` repository secret. Every 3 days stays well inside Supabase's one-week pause window.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/server/health.test.ts`
Expected: PASS. The integration test is verified by CI in Task 7.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add database foundation and health endpoint"
```

---

### Task 6: External services and connection check

**Files:**
- Create: `scripts/check-services.ts`, `.env.local` (git-ignored), `sentry.client.config.ts`, `sentry.server.config.ts`, `instrumentation.ts`
- Modify: `next.config.ts`, `package.json`

**Interfaces:**
- Consumes: `parseServerEnv` from Task 3, `src/server/db/client.ts` from Task 5.
- Produces: script `check:services`.

Google sign-in setup moves to Phase 1, because nothing can test it until sign-in exists.

- [ ] **Step 1: [You] Create the dev Supabase project**

Name it `<product>-dev`, region Mumbai. Put the pooled URL in `DATABASE_URL`, the direct URL in `DATABASE_MIGRATION_URL`, and the project URL and keys in `.env.local`, with `APP_ENV=dev`.

- [ ] **Step 2: [You] Create Cloudflare R2**

Enable R2. **Stop and tell me if a payment method is required, and whether your payment method is accepted.** If it can't be completed, use the Supabase Storage fallback from section 11 of the spec. Create the bucket `<product>-dev`, private, and an API token limited to that bucket. Set a budget alert at the lowest amount offered.

- [ ] **Step 3: [You] Create the Gmail account**

A new account just for the platform, with 2-step verification and an app password. Add `SMTP_USER` and `SMTP_APP_PASSWORD` to `.env.local`.

- [ ] **Step 4: [You] Create the Sentry project, and add the DSN to `.env.local`**

- [ ] **Step 5: Write `scripts/check-services.ts`**

Run with `tsx`, loading `.env.local`. Using `@aws-sdk/client-s3` and `nodemailer`, it checks in order:
1. Database: `select 1`.
2. R2: put, get and delete `healthcheck/<timestamp>.txt`, confirming the contents match.
3. SMTP: `transporter.verify()` for `smtp.gmail.com:465`.

Print `PASS` or `FAIL` per service and exit non-zero on any failure. Print the failing service's error message without credentials. Always try to delete the test object.

- [ ] **Step 6: Apply the first migration to dev**

Run: `npm run db:migrate`
Expected: migration applied. Check in the Supabase table view that `profiles` exists and shows RLS enabled.

- [ ] **Step 7: Run the connection check**

Run: `npm run check:services`
Expected: `PASS` for database, R2 and SMTP.

- [ ] **Step 8: Add Sentry**

Install `@sentry/nextjs`. Initialise from `NEXT_PUBLIC_SENTRY_DSN`, skip when it's empty, and set `sendDefaultPii: false` so user details aren't collected. Don't let a missing DSN fail the build.

- [ ] **Step 9: Verify**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all exit 0, and `git status` doesn't list `.env.local`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: add sentry and service connection check"
```

---

### Task 7: GitHub, CI and deployments

**Files:**
- Create: `.github/workflows/ci.yml`, `README.md`
- Modify: `docs/PROJECT_PLAN.md` if anything changed during setup

**Interfaces:**
- Consumes: all npm scripts from earlier tasks, and `scripts/test-db-setup.sql`.

- [ ] **Step 1: Write `ci.yml`**

On `pull_request` and pushes to `main`, using Node from `.nvmrc` with npm caching:
- `quality` job: `npm ci`, lint, typecheck, `npm test`, `npm run build`.
- `integration` job: a `postgres:17` service, run `scripts/test-db-setup.sql`, apply migrations, then `npm run test:int` with `TEST_DATABASE_URL` set.
- `e2e` job: install Chromium, then `npm run test:e2e`.

Before running, replace `postgres:17` with the Postgres major version shown in the dev Supabase project if different.

- [ ] **Step 2: Write `README.md`**

What the project is, prerequisites, setup steps, every npm script, and a link to `docs/PROJECT_PLAN.md`.

- [ ] **Step 3: Commit and push**

```bash
git add -A
git commit -m "ci: add pull request checks and readme"
gh repo create <repo-name> --source . --<visibility> --push
git push -u origin feature/phase-0-foundation
```

Before pushing, confirm that `git ls-files` lists no `.env` file other than `.env.example`.

- [ ] **Step 4: [You] Create the production services**

A second Supabase project `<product>-prod` in Mumbai, an R2 bucket `<product>-prod` with its own token. Use Gmail SMTP as the custom SMTP sender in both Supabase projects.

- [ ] **Step 5: [You] Import the repo into Vercel**

Add Production variables with `APP_ENV=production` and Preview variables with `APP_ENV=dev`, pointing at the matching services. Confirm the Node version is 26.x.

- [ ] **Step 6: Apply migrations to production**

Run `npm run db:migrate` with the production `DATABASE_MIGRATION_URL` in the shell for that command only.
Expected: migration applied. Nothing else touches production data.

- [ ] **Step 7: Open the pull request**

```bash
gh pr create --base main --title "feat: phase 0 foundation" --body "<summary and test results>"
```

Expected: all three CI jobs pass and Vercel comments a preview link. Investigate any failure rather than re-running blindly.

- [ ] **Step 8: Verify the preview**

Open the preview's `/api/health`.
Expected: `{"status":"ok","db":"ok"}`. Open the home page at desktop and phone widths and check both themes.

- [ ] **Step 9: Merge, then protect `main`**

Merge the pull request. Add the `HEALTH_URL` repository secret, pointing at the production `/api/health`. Turn on branch protection requiring the three CI jobs, if the repo type allows it.

- [ ] **Step 10: Verify production**

Open the production `/api/health`, and run the Health check workflow manually.
Expected: `{"status":"ok","db":"ok"}` and a passing workflow. Then trigger one test error and confirm it appears in Sentry.

Phase 0 is done when a pull request runs CI, gets a preview link, and merging deploys to production.
