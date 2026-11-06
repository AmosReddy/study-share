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

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app locally |
| `npm run build` | Production build |
| `npm run lint` | ESLint, including the architecture rules below |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests |
| `npm run test:int` | Database tests. Needs `TEST_DATABASE_URL` pointing at a Postgres |
| `npm run test:e2e` | Browser tests at desktop and phone widths |
| `npm run db:generate` | Create a migration after changing `src/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations using `DATABASE_MIGRATION_URL` |
| `npm run check:services` | Check the database, file storage and email connections |

## How the code is organised

```
src/app/      Routes only: pages, layouts, API handlers
src/client/   Browser code. Never imports src/server
src/server/   Server code. Never imports src/client
  ports/      Interfaces we own (FileStorage, EmailSender)
  adapters/   One implementation per vendor. The only place vendor SDKs are imported
  db/         Database access. The only place drizzle and postgres are imported
  services.ts Chooses which adapter backs each port
src/shared/   Types and limits used by both sides
```

ESLint enforces these boundaries, so switching a vendor means editing one adapter and some settings. Settings use vendor-neutral names (`STORAGE_*`, `SMTP_*`), so any S3-compatible storage and any SMTP email service can be swapped by changing values only.

## Working on it

Work happens on a `feature/...` or `fix/...` branch and reaches `main` through a pull request. Commits use [Conventional Commits](https://www.conventionalcommits.org). Every pull request runs lint, type check, unit tests, database tests and browser tests.
