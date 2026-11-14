# Prototype plan: a friend group can share files and chat (2 days)

Goal: a friend group can use study-share for real. Create or join a group (done), **upload files with a title, type and subject**, **find them with search and filters**, **preview or download them**, and **chat live**. Owner and member roles only. No admin roles, no form builder.

## What is in, what is out

| In | Out (later) |
|---|---|
| Upload one file at a time with Title, Type (Notes, PYQ, Study Material, Assignment, Other) and Subject (typed) | Custom fields, form builder, templates |
| Library list per group, newest first | Semester and year, "needs details", bulk upload, duplicate warnings |
| Preview PDFs and images in the browser; download everything else | Storage meter, per-group quotas |
| Edit own file's details; delete own file; owner can delete any file | Approval flows, reports, admin role, audit log |
| Search (title, subject, file name) and filters (Type, Subject) | Typo-tolerant search, filter counts, shareable filter links |
| Live text chat per group, history kept, works on phones | Replies, unread counts, linking a file into chat, editing messages |
| Owner can delete any chat message | Report a message |
| Everything works on a phone | Landing page, Sentry, full launch checklist |

One safety item stays even though you chose no storage limits: **a 25 MB cap per file and a fixed list of allowed types** (PDF, Word, PowerPoint, Excel, text, common images). Without it one big upload could fill the free storage.

## Three slices, each merged and tested before the next

### Slice 1: Upload and library (Day 1)
- **Database (migration 0005):** `resources` table (group, uploader, title, subject, type, file key, file name, verified content type, size, status, created time, deleted time). Private, accessed only through server code, like the groups tables.
- **Upload flow:** the server checks membership, type and size, creates a record as "uploading" and hands the browser a short-lived upload link. The browser sends the file straight to storage with a progress bar. The server then confirms the real size and type and marks it "ready". Abandoned "uploading" records never show.
- **Library tab** on the group page: list of files (title, type, subject, uploader, size, date), an Upload button and a form with the three fields.
- **Preview and download:** a short-lived link created per request after a membership check. PDFs and images open in a viewer page; everything else downloads. A removed member can never get a link.
- **Edit and delete:** uploader edits own details or deletes own file; owner deletes any file. Deleting removes the file from storage.
- **Permissions:** new actions in the permissions module (`file.upload`, `file.edit.own`, `file.delete.own`, `file.delete.any`), with the role table tested.
- **Done when:** two accounts in a group upload, preview, download, edit and delete, on desktop and a 360px phone, and a non-member or removed member gets "not found".

### Slice 2: Search and filters (Day 2, morning)
- Search box over title, subject and file name, plus Type and Subject dropdowns (Subject choices come from what the group already uses). Works with the list's page-by-page loading, and survives reload via the address.
- **Done when:** a group with a few hundred seeded files answers instantly and filters combine correctly.

### Slice 3: Live chat (Day 2, afternoon)
- **Database (migration 0006):** `messages` table (group, sender, text up to 2000 characters, client id to prevent duplicates, created time, deleted time).
- **Sending:** server action saves the message after a membership and rate-limit check; a unique client id makes a retry harmless.
- **Live delivery:** Supabase Realtime Broadcast on a private channel per group, with a database rule so only active members can listen. The browser connects only while the Chat tab is open. A refresh every few seconds backs it up, so a dropped connection never loses messages.
- **Chat tab:** message list with sender names and times, a box at the bottom that stays above the phone keyboard, "Former member" for people who left, owner can delete any message.
- **Time box:** if live delivery turns out harder than expected (it needs the browser to hold a sign-in token), I fall back to the refresh-only version, tell you, and the chat still works.
- **Done when:** two browsers chat live, one goes offline and catches up with nothing lost or duplicated.

## How we work (same as before)
- One branch and pull request per slice. CI must pass (lint, types, unit, real-Postgres database tests, browser tests at desktop and phone sizes).
- Sonnet or below for every helper. I'll say which model does what.
- Each slice gets a short step-by-step test guide in `docs/`. You test on the preview, then say "merge PR N". Migrations are applied to production by you (a command I give you) before each merge, like migration 0004.

## What I need from you
1. **Slice 1:** run one command I give you to check that the production storage bucket works (same as the earlier production check). If it's missing I'll walk you through creating it.
2. **Slices 1 and 3:** run the new migration on production before each merge.
3. **Testing:** about 20 minutes per slice with two accounts, one on a phone.

## Risks to watch
- **Browser upload to storage** needs the storage bucket to accept requests from the site's address. I test this first, before building anything else on top.
- **Live chat sign-in token in the browser** (slice 3), covered by the fallback above.
- **Time:** Day 1 and Day 2 are full. If anything slips, chat is the part that shrinks (refresh-only version), not slices 1 or 2.
- **Free limits:** Supabase Storage free plan holds 1 GB. Plenty for a friend group; tell me if it fills.
- **Left alone for now:** deleted groups' files stay in storage (no clean-up job), and a group owner's account being deleted from the dashboard leaves the group ownerless. Neither affects a friend group.
