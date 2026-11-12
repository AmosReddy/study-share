# Study Material Sharing Platform: Project Plan

Working title only. The product name, domain and GitHub repo name are still to be chosen.

## 1. Context

Students share notes, previous year papers (PYQs) and study material in WhatsApp groups. Files get buried under chat, and nothing can be organised by subject, semester, year or type. This platform gives each group an organised, searchable library alongside its chat.

The project starts with students, grows to teachers and colleges, and later to workplaces where file sharing is a daily task. AI features come only after the main problem is solved.

**Success for version 1:** a real class stops digging through WhatsApp and finds any file in a few seconds using search or filters.

### Goals
- Create or join a private group safely and quickly.
- Upload files with details the group owner defines, so they stay findable.
- Let members download any file they can access, and preview PDFs and images in the browser.
- Find any file fast through search and filters.
- Talk and ask for material in group chat.
- Give teachers and admins control over who joins and what gets uploaded.
- Start free, and grow without rebuilding.

### Non-goals for now
- Native mobile apps. Phones use the website.
- Public groups or a public library of notes.
- Voice or video calls, and direct messages.
- Payments, or real-time document editing.

### Anti-goals: failure even if it technically works
- Uploading feels like more work than dropping a file in WhatsApp.
- A member who has been removed can still reach a group's files.
- Pages feel slow, or files fail silently.
- It becomes a place to pirate textbooks or share harmful content.

## 2. Decisions

**Decided by you**
| Decision | Choice |
|---|---|
| Platform | A website for both desktop and mobile. The site is built for both screen sizes from the start |
| Pilot focus | **Phones and desktop are both polished from the start** (changed on 2026-11-06). Every screen is designed phone-first, since most of the owner's class will use phones, then scaled up for desktop. The pilot must feel good on a phone, including upload, search and chat |
| Invitations | Sent through WhatsApp and email |
| Budget | Free plans at launch, pay if it grows, no rebuild needed |
| Domain | No spending for now: use the free Vercel address and send email through Gmail during the pilot. Buy a domain and move email before public launch |
| Joining | Owner chooses per group: link + password (default) or link only. The link can be reset at any time |
| Upload form misfit | Only Title is strictly required. Missing details mark the file "needs details", and the owner or an admin completes them |
| Stack | Next.js + Supabase (database, sign-in, chat and file storage) |
| File storage | Supabase Storage for now, because Cloudflare R2 asked for a payment method. Built behind our own interface so it can move to R2 or another service later by changing settings |
| Design principle | Ports and adapters: every outside service sits behind our own interface, so switching vendors is easy (see section 5) |

**My calls, please check these**
- Sign-in uses email and password plus Google.
- New groups start from an editable template: Type (Notes, PYQ, Study Material, Assignment, Other), Semester 1 to 8, Year, and Subject. The owner adds the subjects, and is prompted to on creating the group.
- If the owner adds a field later, older files stay visible and are marked "needs details".
- Removing a member also blocks them from rejoining until an owner or admin lifts the block. There is no separate "ban" action.
- Sign-up requires confirming you're 18 or over and accepting short terms and a privacy notice, and we record this. These are in place before the pilot, so classmates under 18 can't join it until the legal check in section 11 is done.
- Limits are sized for Supabase's free storage (1 GB in total, 50 MB cap per file, 5 GB of downloads a month shared with the rest of Supabase): 25 MB per file, 100 MB per group, an alert at 700 MB total, and new uploads stop at 900 MB. All numbers live in `src/shared/limits.ts` and are raised when storage moves to a paid plan.
- Allowed files: PDF, Word, PowerPoint, Excel, text and common images. No ZIP, executables or SVG at first.
- A teacher's group is the same as any group, with stricter settings switched on, rather than a separate product.
- We test with your own class after Phase 3, before opening to everyone.
- College students (18+) come first. School students come after a legal check (section 11).

## 3. Approaches considered

- **A. Next.js + Supabase (chosen by you).**
- **B. Next.js + own NestJS backend, Postgres and Redis.** Most control, but much more work and hard to host free.
- **C. Next.js + Firebase.** Quick for chat, but weak at filtering on custom fields, which is the heart of this product, and hard to leave.

## 4. Technology stack

| Area | Choice | Why |
|---|---|---|
| App | Next.js (App Router), TypeScript | One codebase for pages and server code |
| UI | Tailwind CSS, shadcn/ui, lucide icons | Polished, accessible components we own |
| Client data | TanStack Query | Caching and instant-feeling updates |
| Forms and validation | React Hook Form, Zod | The same rules run in the browser and on the server |
| Database | Supabase Postgres (Mumbai region) | Strong filtering, search and JSON support |
| Database code | Drizzle ORM and migrations | Typed queries, tracked schema changes |
| Sign-in | Supabase Auth | Email, Google, verification and password reset |
| Live chat | Supabase Realtime (private Broadcast) | Live delivery with per-group access control |
| Files | Supabase Storage (S3-compatible) | 1 GB free. Same S3 standard as R2, so moving later is a settings change. Pro includes 100 GB |
| Search | Postgres full-text and trigram search | Good enough for a long time, with no extra service |
| Hosting | Vercel (functions in Mumbai) | Simple deploys and a preview for every pull request |
| Email | Gmail SMTP for the pilot, Resend or similar after buying a domain | Supabase's built-in email is too limited for real use. All email goes through one `sendEmail` module, so switching is a settings change |
| Errors | Sentry free plan | See real errors from real users |
| Tests | Vitest, Playwright | Unit, integration and full browser tests |
| CI | GitHub Actions | Checks every pull request |

Plan limits checked on 5 Nov 2026:
- **Supabase Storage (free):** 1 GB storage, 50 MB cap per file, 5 GB of downloads a month shared across database, sign-in and storage. Pro includes 100 GB storage and 250 GB downloads. Cloudflare R2 (10 GB free, free downloads) asked for a payment method, so it is the planned move once storage outgrows the free plan.
- **Supabase free:** 500 MB database, 50,000 monthly users, 200 live connections at once, 2M chat messages a month, and projects pause after a week without activity. Pro starts at $25 a month.
- **Vercel Hobby:** non-commercial only. A Pro seat is $20 a month.

## 5. Architecture

```
Browser (Next.js pages, TanStack Query)
   |  normal requests             |  file upload/download
   v                              v  (short-lived signed URL)
Next.js server code  --------->  File storage (Supabase Storage today)
(one permissions module)
   |
   v
Supabase: Postgres, Auth, Realtime  ----> live chat to browser
```

Code layout (enforced by ESLint `no-restricted-imports`):

```
src/app/      Routes only: pages, layouts, API handlers. No business logic.
src/client/   Browser code: components, hooks, UI. Never imports src/server.
src/server/   Server code: database, permissions, email, storage, env. Never imports src/client.
src/shared/   Types and Zod schemas used by both. Imports neither.
```

Key rules:
1. **All data goes through server code.** The browser never queries tables directly. Every action calls one `can(user, action, group)` permissions module, so rules live in one place.
2. **Row Level Security is on for every table, with no public access,** as a safety net. The only browser access is Realtime, limited to groups the user belongs to.
3. **Files never pass through our server.** The browser sends them straight to file storage using a signed URL. This avoids server limits, keeps uploads fast and gives real progress bars.
4. **Files are private.** Download links are created per request after a membership check and expire in 5 minutes. They use a different domain from the app, so an uploaded file can never run as part of the site.
5. **Lists use cursor-based pagination,** so a group with 50,000 files or messages stays as fast as a small one.

### Main screen sketch

```
+--------+-------------------------------------------------------------+
| Groups | CSE 2nd Year         [Library] [Chat] [Members] [Settings]  |
|        | Search files...                               [+ Upload]    |
| CSE 2Y |-------------------------------------------------------------|
| DBMS   | Subject v  Semester v  Year v  Type v      3 filters [Clear]|
| Friends|-------------------------------------------------------------|
|        | [PDF] DBMS Unit 3 Notes     DBMS  Sem 4  Notes  Ravi  2d    |
| + New  | [PDF] OS PYQ 2024           OS    Sem 4  PYQ    Asha  5d    |
| + Join | [DOC] CN Lab Manual         CN    Sem 4  Study  Sam   1w    |
+--------+-------------------------------------------------------------+
```

On phones, the group list collapses into a menu and filters open in a slide-up panel.

Design standards: skeleton loaders rather than spinners, optimistic updates, clear empty states, keyboard support, light and dark themes, WCAG AA contrast. Every screen is designed phone-first at 360px, then scaled up for desktop, and both are polished in every phase. On phones, a group uses bottom tabs with a floating Upload button and a group switcher in the header.

### Design principles

1. **Ports and adapters.** Our code depends on small interfaces we own (`FileStorage`, `EmailSender` in `src/server/ports`). One adapter per vendor implements each (`src/server/adapters`). `src/server/services.ts` is the only place that chooses which one is used.
2. **Vendor code in one folder.** `@aws-sdk/*` and `nodemailer` may only be imported in `src/server/adapters`. `drizzle-orm` and `postgres` may only be imported in `src/server/db`. ESLint fails the build otherwise.
3. **Vendor-neutral settings.** `STORAGE_*` works for any S3-compatible service (Supabase Storage, Cloudflare R2, AWS S3). `SMTP_*` works for any SMTP service (Gmail, Resend, Brevo). Switching is a change to settings, with no code change.
4. **Standard formats underneath.** Plain Postgres, the S3 protocol and SMTP, so no data format belongs to one vendor.
5. **One place per decision.** Permissions in `can()`, limits in `src/shared/limits.ts`, environment in `src/server/env.ts`.
6. **Same plan for later services.** Sign-in (Phase 1) and chat (Phase 4) get ports of their own (for example `AuthProvider`, `ChatBroadcaster`) before any feature uses them.
7. **Swapping is tested.** Each adapter has tests, and `npm run check:services` exercises every service through the same ports the app uses.

## 6. Data model

| Table | Purpose |
|---|---|
| `profiles` | Name and avatar, linked to the Supabase user, plus `age_confirmed_at`, `terms_accepted_at`, `terms_version` |
| `groups` | Name, description, `join_mode`, password hash, invite token, `require_join_approval`, `require_upload_approval`, `used_bytes`, `quota_bytes`, `deleted_at` |
| `group_members` | User, group, `role` (owner, admin, member), `status` (active, pending, removed) |
| `email_invites` | Group, email address, inviter, token hash, expiry, status |
| `group_fields` | The owner-defined upload form: label, type (single choice, multi choice, text, number), options, expected, order, archived. A missing "expected" field marks the file `needs_details` and never blocks upload |
| `resources` | Title, description, file key, name, type, size, SHA-256, `metadata` (JSONB), `status`, `needs_details`, search vector, `deleted_at` |
| `messages` | Group, sender, text, reply target, linked resource, client ID, `deleted_at` |
| `field_change_requests` | A member's proposed change to the form, with status |
| `reports` | Reports on files or messages, with status |
| `notifications` | In-app notifications per user |
| `audit_log` | Who did what: removals, role changes, deletions, settings |
| `rate_limits` | Attempt counters for password guesses and uploads |

Details that matter:
- **Metadata is keyed by stable field and option IDs,** never labels. Renaming "Sem" to "Semester" changes nothing in old files.
- **Fields and options are archived, not deleted,** so old files keep their details.
- **Indexes:** `(group_id, created_at DESC, id)` for lists, a GIN index on `metadata`, a GIN index on the search vector, and trigram on title and filename.
- **Communities come later** as a new table plus a nullable `community_id` on groups, with no redesign needed.

## 7. Key flows

**Inviting**
- **WhatsApp:** a "Share on WhatsApp" button opens WhatsApp with the invite message already written. There's also a copy-link button.
- **Email:** the owner or an admin enters addresses, and each person gets a personal link that expires after 7 days. Limited to 50 emails per user per day. Email invites follow the group's password and approval settings.

**Joining**
1. A person opens the link. If not signed in, they register, then return to the same invite.
2. In link + password mode, they enter the password. Passwords are stored hashed, with 5 attempts per 15 minutes.
3. If approval is required, they become `pending` and an admin decides. Otherwise they join.
- Removed members see "You can't join this group" and can't rejoin through any link.
- Invite tokens are long and random. Resetting one kills the old link.
- Changing the password doesn't remove existing members.
- People can also join by typing a short group code on the Join page, which follows the same rules.

**Upload**
1. The user drops files and fills in the group's form. Details can be applied to several files at once, and recent choices are remembered, to keep uploading as easy as WhatsApp. Only Title is mandatory, and it defaults to the filename. If a detail doesn't fit, they can skip it and the file is marked "needs details" for the uploader, owner or an admin to complete.
2. The server checks membership, file type, size and quota, then reserves the space and creates a record with status `uploading`.
3. The browser sends the file directly to file storage with a progress bar.
4. The server confirms the file's real size and type, then marks it `ready`, or `pending` if the group requires upload approval.
5. A daily job cleans up abandoned uploads and returns their reserved space.

**Chat:** messages save to the database, then broadcast to the group. The browser connects only while chat is open, to protect the 200-connection limit. Client-generated IDs prevent duplicates on retry, and reconnecting fetches anything missed.

## 8. Phases

Each phase ends deployed, tested and merged. Each gets its own detailed task plan before building starts.

### Phase 0: Foundation
- Git repo, GitHub repo, branch protection and CI.
- Next.js, TypeScript, Tailwind and shadcn/ui, with the design tokens and a responsive app layout.
- Separate Supabase projects for dev and production, plus Supabase Storage, Vercel, Sentry and Gmail sending.
- Vercel's free built-in environments only: Preview uses the dev project and settings, Production uses the production ones. Custom environments need Pro and aren't used. If a permanent test site is needed, use a free `staging` preview branch.
- Storage and email set up behind our own interfaces (ports and adapters), with the lint rules that keep vendor code in one place.
- Drizzle migrations and the permissions module skeleton.
- **Done when:** a pull request runs CI, gets a preview link, and merging deploys to production.

### Phase 1: Accounts and groups
- **Status:** Phase 1a (accounts) is done. Phase 1b (create group, invite link and code, join, member list, leave, owner settings) is built and awaiting live acceptance ([PHASE_1B_ACCEPTANCE.md](PHASE_1B_ACCEPTANCE.md)). Phase 1c (remove a member and block rejoining, hand a group over, delete a group with 30-day soft delete) is built on branch `feature/phase-1c-member-management` and awaiting acceptance ([PHASE_1C_ACCEPTANCE.md](PHASE_1C_ACCEPTANCE.md)). Email invites were dropped from scope by the owner on 2026-11-12.
- Register, Google sign-in, email verification, password reset and profile.
- Age confirmation, short terms and privacy notice, with acceptance recorded.
- Create group, group list, join mode setting, invite link and code, join by password.
- Share on WhatsApp, email invites and rate limits.
- Member list, leave group, remove member (with rejoin block), transfer ownership, delete group.
- Every screen phone-first: the invite page puts the group first with Continue with Google and Sign up with email, and a group's bottom tab bar (Library, Members, Settings) appears. Details in `docs/superpowers/specs/2026-11-06-phase-1-accounts-and-groups-design.md`.
- **Done when:** two people can register and form a private group through a WhatsApp link and through an email invite.

### Phase 2: Library and upload
- Owner's form builder with templates, and drag-to-reorder.
- Bulk upload with progress, retry and duplicate warnings.
- Library list, in-browser preview for PDFs and images, download for others.
- Edit and delete files, storage meter, quotas, "needs details" list for owners and admins.
- Owners and admins can add a missing option directly from a file's details.
- Polished on phones from the start: upload from files, photos or the camera, the library list, preview and download, with the floating Upload button.
- **Done when:** a group defines its own form and members upload, preview and download, and a member can upload a file the form doesn't fit.

### Phase 3: Search and filters
- Search by title, description and filename, tolerating typos.
- Filters generated from each group's own fields, with counts.
- Sorting, shareable filter URLs, and cursor pagination.
- Search and filters are polished on phones, with filters in a slide-up panel.
- **Done when:** results appear in under 300 ms on a seeded group of 50,000 files.

**Milestone: pilot with your own class,** on the free Vercel address with Gmail email. Collect feedback and fix what's found before Phase 4.

### Phase 4: Chat
- Live messages, history, replies, unread counts, and linking a file into chat. Polished on phones, including a chat box that stays visible above the keyboard.
- Rate limits and message deletion.
- **Done when:** two browsers chat live and survive a dropped connection without losing or duplicating messages.

### Phase 5: Admins and moderation
- Owner, admin and member roles, WhatsApp-style.
- Join approval, upload approval, and lifting rejoin blocks.
- Members request form changes, the owner approves.
- In-app notifications, audit log, and reporting files or messages.
- **Done when:** a teacher can run a class group with full control and every rule is covered by tests.

### Phase 6: Public launch readiness
- Full terms, privacy policy and a copyright takedown process.
- Buy a domain, then move the site and email to it.
- A final phone and desktop polish pass, with testing on real devices.
- Admin page for you: reports, group lookup, usage.
- Security review, rate limits everywhere, load test, accessibility pass.
- Nightly database backups to a separate private bucket (ideally at another provider), tested with a real restore.
- Landing page and onboarding.
- **Done when:** the launch checklist passes and you open sign-ups.

### Phase 7: Communities
A college creates a community containing many class groups, with community admins, member lists and announcements.

### Phase 8: Workplaces
Reword templates and labels for teams, add audit exports and organisation controls, and consider paid plans. Vercel Pro is required before charging money.

### Phase 9: AI assistant
Extract text from files, then summaries, questions about a file, and quick quizzes, each scoped to files the user can already access. Adds search inside documents. Needs a usage budget per group, as AI has a real cost per use.

**Later ideas:** favourites, version history for files, folders, weekly digest emails, mobile app, Office file previews.

## 9. Edge cases and where they are handled

| Case | Handling | Phase |
|---|---|---|
| Removed member still has a download link | Links expire in 5 minutes, and every new link rechecks membership | 2 |
| Owner wants to leave or delete their account | Must transfer ownership or delete the group first | 1 |
| Member leaves or deletes their account | Their files stay, shown as "Former member" | 1 |
| Invite link forwarded to the wrong people | Reset the link, require a password or approval | 1, 5 |
| Removed member tries to rejoin | Blocked on every join path until the block is lifted | 1 |
| Email invite goes to spam or never arrives | Inviter can still share the WhatsApp or copy link | 1 |
| Email invite sent to an existing member or expired | Friendly message, and they go to the group or ask for a new invite | 1 |
| Google sign-up skips the age and terms step | Shown once before the first group action | 1 |
| Upload fails or the tab closes | Retry, and the daily cleanup returns the reserved space | 2 |
| Two uploads hit the quota at once | Space is reserved inside a database transaction | 2 |
| Same file uploaded twice | SHA-256 warning, and the user can still proceed | 2 |
| File disguised as an allowed type | The real type is checked from file contents after upload | 2 |
| Owner renames or removes a field or option | Stable IDs and archiving keep old files intact | 2 |
| Field added later, or a file's details don't fit the form | File marked "needs details", and editors are prompted | 2 |
| Two people edit a file's details | Version check, and the second person is told to refresh | 2 |
| Group deleted by accident | Restorable for 30 days, then files are permanently removed | 1 |
| Message resent after a dropped connection | Client ID makes it a no-op | 4 |
| Group reaches its storage limit | Clear message before upload, with what to do next | 2 |
| Pending member reaches private data | Every read requires `status = active` | 5 |
| Copyright or abuse report | Hide quickly, review, record in the audit log | 5, 6 |

## 10. How we work

- **Branches:** `main` is always deployable. Work happens on `feature/...` or `fix/...` branches, one pull request per feature.
- **Commits:** small, with [Conventional Commits](https://www.conventionalcommits.org) messages such as `feat: add invite links`.
- **Every pull request:** lint, type check, tests and build must pass, and it gets a preview deployment.
- **Secrets:** never committed. They live in Vercel settings and a git-ignored `.env.local`, with a `.env.example` listing the names.
- **Database:** every change is a migration, tested on dev first.
- **Docs:** a README with setup steps, and this plan kept up to date.

### Testing
- **Unit:** permissions module, validation and metadata logic.
- **Integration:** a table of every role against every action, run against real Postgres. This is the most important suite.
- **Browser:** Playwright covers register, join, upload, search and chat.

Docker isn't installed, so day-to-day development uses the dev Supabase project, and CI runs Postgres itself.

## 11. Risks

| Risk | Plan |
|---|---|
| Copyright | Invite-only groups, terms, a takedown process, and reporting before public launch |
| Under-18 users | India's DPDP Act has parental consent rules for children. Check the current requirements, ideally with a legal adviser, before opening to school students or classmates under 18 |
| Gmail email during the pilot | Emails may land in spam, and Gmail limits daily sending. Use a dedicated account, keep the rate limits, and tell pilot users to check spam. WhatsApp links are the backup. Replace it before public launch |
| Supabase free project pausing | A scheduled health check keeps a quiet project visible. Move to Pro once real users rely on it |
| Free plan backups | Assume none are included, so we run our own nightly backup |
| Supabase free storage is small | 1 GB in total and 5 GB of downloads a month. Limits in `src/shared/limits.ts` stop uploads at 900 MB. Watch usage after the pilot. Plan the move to Supabase Pro or R2 before launch. Free-plan files are not backed up, so keep the backup job on the Phase 6 list |
| Vendor lock-in | Every outside service sits behind our own interface. Vendor libraries can only be imported in one folder each, enforced by lint. Settings use vendor-neutral names (`STORAGE_*`, `SMTP_*`), so S3-compatible storage and SMTP email can be swapped by changing values only |
| Malware | No antivirus on free plans. Strict file list, downloads as attachments, and reports. Add scanning when budget allows |
| One person doing support | Admin page and audit log from Phases 5 and 6 |

## 12. When to start paying

| Trigger | Move | Approx. cost |
|---|---|---|
| Preparing for public launch | Buy a domain and move email to Resend or similar | Small yearly domain cost |
| Real users depend on it, or the database reaches 400 MB | Supabase Pro | $25 a month |
| Storage nears 700 MB, or downloads near 5 GB a month | Supabase Pro ($25 a month, 100 GB), or move files to Cloudflare R2 by changing the `STORAGE_*` settings | $25 a month, or about $1.50 per 100 GB |
| Charging money, or free limits reached | Vercel Pro | $20 a month per seat |
| Live connections near 200 | Supabase Pro first, a dedicated chat service if needed much later | varies |
| Search slows down despite indexes | Add Meilisearch or Typesense | varies |

All of these are plan changes or additions. None requires rebuilding the product.

## 13. What I need from you

**Before Phase 0**
1. A GitHub account, and the GitHub CLI installed: run `winget install GitHub.cli`, then `gh auth login`.
2. A product name, or tell me to use a temporary one.

**During Phase 0, with me guiding you**
3. Free accounts on Supabase, Vercel and Sentry.
4. A new Gmail account just for the platform, with 2-step verification and an app password.
5. A Google Cloud project for "Continue with Google".
6. Nothing to pay: storage now uses Supabase's free plan, so no payment method is needed.

Secrets go directly into `.env.local` or the provider dashboards, never into chat.

## 14. First steps after approval

1. Create the git repo and save this plan in it as `docs/PROJECT_PLAN.md`.
2. Write the detailed task plan for Phase 0.
3. Build Phase 0, and commit and push to GitHub.

## 15. Verification

- **Each phase:** CI passes, the phase's "done when" is demonstrated on a preview link, and it's then merged.
- **Security:** the role-against-action test table passes, and a manual check confirms a non-member and a removed member can't reach files, messages or Realtime.
- **Screen sizes:** browser tests run at desktop and phone sizes (touch device profile, 360px and up) and must really check the phone layout. Every screen works with no sideways scrolling, with tap targets of at least 44px.
- **Email:** verification and invite emails are tested on Gmail and Outlook addresses before the pilot.
- **Performance:** run against seeded data of 50,000 files and 100,000 messages. Target under 300 ms for search and under 2 seconds for first page load.
- **Before public launch:** a real backup restore, a load test, a full run of the browser tests, and your class's pilot feedback resolved.
