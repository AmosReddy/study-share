# study-share

A place for a class to share notes, previous year papers and study material, organised by subject, semester and type, with search, filters and group chat. Built to replace digging through WhatsApp.

`study-share` is a temporary name.

The full plan, with phases, design principles and edge cases, is in [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md).

## Stack

Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui, Drizzle ORM, Supabase (Postgres, auth, realtime, file storage), Vitest, Playwright.

## Getting started

You need Node 26 (see `.nvmrc`).

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev                  # http://localhost:3000
```

Never commit `.env.local`. It holds secrets.

Accounts need setup outside the code (Supabase Auth settings, Gmail for email, Google sign-in, Vercel variables). The click-by-click guide is [docs/SETUP_AUTH.md](docs/SETUP_AUTH.md).

### Settings

`.env.example` lists every setting with a comment. The ones that are easy to get wrong:

| Setting | What it does |
|---|---|
| `APP_ENV` | `dev` for local runs and Preview deployments, `production` for Production only. The app refuses to start when this does not match the Supabase project the other settings point at. |
| `SERVICES_MODE` | `real` (the default) uses the outside services. `fake` swaps sign-in, email and rate limits for in-memory test doubles. For local runs and automated tests only: the app refuses it on any Vercel deployment, on production and with production settings. |
| `NEXT_PUBLIC_SITE_URL` | The public address of the site, used in email links, Google sign-in and cookies. **Required when `APP_ENV=production`.** Elsewhere leave it empty, and the app uses the Vercel address or `http://localhost:3000`. **Never set an `https` `NEXT_PUBLIC_SITE_URL` for a local `http` run**: the sign-in cookies are then marked secure, the browser drops them over `http`, and you are sent back to the login page in a loop. |
| `SMTP_FROM` | The address email is sent from. Leave empty to use `SMTP_USER` (right for Gmail). Needed for services whose login is not an address. |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app locally |
| `npm run build` | Production build |
| `npm run lint` | ESLint, including the architecture rules below |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests |
| `npm run test:int` | Database tests. Needs `TEST_DATABASE_URL` pointing at a Postgres |
| `npm run test:e2e` | Browser tests at desktop and phone widths (see below) |
| `npm run db:generate` | Create a migration after changing `src/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations using `DATABASE_MIGRATION_URL` |
| `npm run check:services` | Check the database, file storage, email login and auth (it creates a throwaway confirmed user, signs in, signs out and deletes it) against the settings in `.env.local` |
| `npm run check:auth-behaviour` | Probe how the real Supabase Auth behaves in the cases our test double copies. **Dev project only**: it creates and deletes test users, sends about three emails to plus-addresses of the project mailbox, and refuses production settings |

## How the code is organised

```
src/app/      Routes only: pages, layouts, API handlers
src/client/   Browser code. Never imports src/server
src/server/   Server code. Never imports src/client
  ports/      Interfaces we own (FileStorage, EmailSender, AuthProvider, RateLimiter)
  adapters/   One implementation per vendor. The only place vendor SDKs are imported
  db/         Database access. The only place drizzle and postgres are imported
  services.ts Chooses which adapter backs each port
src/shared/   Types and limits used by both sides
```

ESLint enforces these boundaries, so switching a vendor means editing one adapter and some settings. Settings use vendor-neutral names (`STORAGE_*`, `SMTP_*`), so any S3-compatible storage and any SMTP email service can be swapped by changing values only.

## Browser tests

`npm run test:e2e` builds the app, starts a production build of it on port 3917 and runs the tests against that. The test server runs in `SERVICES_MODE=fake`, so sign-in, email and rate limits are in-memory test doubles and no real service (Supabase, Google, Gmail) is ever called. The Playwright config sets every setting itself with dummy values, so the run never reads `.env.local` or `.env.production.local`. Never point these tests at real credentials. The test server is never reused, so it cannot be mixed up with your own `npm run dev` server, but port 3917 must be free.

## Working on it

Work happens on a `feature/...` or `fix/...` branch and reaches `main` through a pull request. Commits use [Conventional Commits](https://www.conventionalcommits.org). Every pull request runs lint, type check, unit tests, database tests and browser tests.
