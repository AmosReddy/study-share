# Phase 1 Design: Accounts and Groups

Status: draft for the owner's approval. Part of [docs/PROJECT_PLAN.md](../../PROJECT_PLAN.md). Phase 0 is live (see that plan's section 8); this phase builds on it.

## 1. Intent and why

Students share notes in WhatsApp groups and then cannot find them. The product gives each class a private, organised library. Before any file can be shared, people need accounts and a way to form and join private groups.

Phase 1 delivers exactly that: **two people can sign up and form a private group through a WhatsApp link or an email invite, on their phones.** The owner will test this with their own class, and most of those friends will use phones, so phones are a first-class target from the first screen, not a later polish pass.

## 2. Goals, non-goals, anti-goals

### Goals
- Sign up and log in with email and password, or with Google.
- Confirm email addresses, reset forgotten passwords, and keep a simple profile (a name).
- Record that each person confirmed they are 18 or over and accepted the Terms and Privacy Notice.
- Create a group, with a join mode of password or link-only.
- Join by invite link or by a short group code, passing through sign-up or login and returning to the same invite.
- Share an invite on WhatsApp in one tap, and invite people by email.
- Manage members: list, leave, remove (with a block on rejoining), transfer ownership, delete the group.
- Every screen is designed phone-first and works well from 360px wide up to desktop.

### Non-goals (later phases)
- Uploads, the library, search, chat (Phases 2 to 4). Phase 1 shows honest empty states, never fake data.
- The admin role, join approval, reports, notifications, audit log, lifting a rejoin block (Phase 5).
- Profile photos, account deletion by the user (before public launch, Phase 6), communities, AI.
- A native app. Phones use the website.

### Anti-goals (failure even if it technically works)
- A friend taps the WhatsApp link on a phone and gives up before reaching the group.
- A removed member can get back in, or any non-member can read any group data.
- A group password, token or key appears in a log, an error message or a URL that is shared.
- Someone gets into another person's account by pre-registering their email address.
- The phone layout scrolls sideways, has buttons smaller than a thumb, or the keyboard hides the field being typed in.

## 3. Constraints

- **Existing architecture applies.** Client, server and shared folders stay separate; vendor libraries stay in their adapters; outside services sit behind our own interfaces (see PROJECT_PLAN section 5, "Design principles"). Sign-in gets an `AuthProvider` interface, with Supabase Auth as its adapter.
- **Free plans only.** Supabase free (database, auth), Vercel Hobby, Gmail SMTP. No spend.
- **Email.** Supabase sends sign-up and password-reset emails itself, so its custom SMTP setting must point at the project's Gmail account (its built-in sender is too limited). Our own server sends invite emails through the `EmailSender` interface. Gmail's daily sending limit is shared by both, so every email path is rate limited.
- **Vercel.** Functions run in Mumbai (`bom1`). SMTP on ports 465 and 587 works there. Await every email send before returning a response.
- **Two Supabase projects** (dev and production) exist and the environment guard from Phase 0 must keep passing. New settings follow the vendor-neutral naming rule.
- **Limits** (owner-approved defaults): a person can be in 20 groups, a group has at most 300 members. Group name 2 to 60 characters, description up to 300.
- **Browsers.** The latest two versions of Chrome, Safari (iOS 16 and later) and Samsung Internet, plus desktop Chrome, Edge and Firefox.

## 4. Approaches considered

### 4.1 Account system

- **A. Supabase Auth behind our `AuthProvider` interface (chosen).** Email and Google sign-in, email confirmation and password reset are provided. It matches the database and the Phase 4 chat, whose access checks use Supabase's login.
- **B. A separate auth library with our own users table.** More vendor-neutral, but it would need its own confirmation and reset emails and a custom bridge to Supabase Realtime for chat. More work with no benefit for the pilot.
- **C. Writing our own login.** Rejected: security-sensitive and unnecessary.

### 4.2 When to confirm an email (owner's choice)

- **Join first, confirm before uploading.** Rejected because Supabase cannot do this natively. It would need our own confirmation system plus protection against pre-registered addresses.
- **Confirm first, and the confirmation link returns the person to the group (chosen).** Supabase's built-in check. The link carries the invite, so the person returns to the same invite page. In link-only mode they join at once. In password mode they type the group password there.
- **One-time code instead of passwords.** Rejected: changes login for everyone and still needs an email-app switch.

### 4.3 Order of work

One phase, three working steps, each deployed and tested before the next: **1a accounts, 1b groups and joining, 1c invites and member management.**

## 5. Decisions

**Decided by the owner**
| Decision | Choice |
|---|---|
| Invite page for a signed-out person | **Layout A, group first**: the group name is the hero, two big buttons (Continue with Google, Sign up with email), then "Already have an account? Log in". No typing on this page. Email sign-up opens on the next screen. |
| Navigation inside a group on a phone | **Layout A, bottom tabs and an Upload button**: tabs under the thumb, group switcher in the header, Upload floating over the library. |
| Phones vs desktop | Both are polished from the start. Phone-first design, scaled up for desktop. This replaces the plan's earlier "desktop polished first" pilot focus. |
| Email confirmation | Confirm first. The confirmation link returns the person to the group they were joining. |
| Order of work | Three steps: 1a, 1b, 1c. |
| Group password | **Shown once, and the owner shares it separately.** When a group is created, or its password changed, the password is shown once with a Copy button and a note to send it apart from the invite link. It is stored only in hashed form, so it can never be shown again. The owner can set a new one at any time. New groups default to password mode. |
| Defaults | Limits in section 3. Join approval stays in Phase 5, so Phase 1 offers only password or link-only. |

**My calls, for the owner to check**
- Sign-up asks for name, email and password. A single checkbox covers "I'm 18 or older and I accept the Terms and Privacy Notice", stored with the date and the terms version. Google users see it once, before their first group action.
- The profile is only a display name (2 to 50 characters). Photos come with Phase 2's storage.
- Group codes are 8 characters from an easy-to-read alphabet (no 0, O, 1, I, L) and case-insensitive.
- A group password is 6 to 64 characters. Account passwords need at least 8.
- Resetting a group's invite link also replaces its short code. The old link and code stop working immediately. Changing the group password does not remove existing members.
- A removed member sees only "You can't join this group". Rejoining stays blocked until an owner lifts it, which arrives in Phase 5. Leaving is different from being removed: a person who leaves can rejoin.
- A deleted group disappears at once and its links stop working. It is kept for 30 days and restored by the project owner directly in the database for now. Permanent purge comes with Phase 2 (files).
- Only the tabs that work are shown: Library (an empty state), Members, Settings. Chat and the Upload button appear when those phases ship.
- Terms and Privacy Notice are short plain-language drafts written for the pilot. They need a legal review before public launch.
- A web app manifest and icons so friends can add the site to their home screen. No offline mode and no service worker.
- **Email invite links** are single-use and not tied to the invited address, because a friend may sign up with a different address than the one the invite was sent to. They expire after 7 days and are revoked when the group's link is reset, when the group is deleted, or when the owner revokes them. The owner sees a simple list of pending invites with Revoke and Resend. A resent invite replaces the old one.
- **Same email, two ways in.** Confirm-first alone does not stop pre-registration. Supabase keeps the FIRST password when an unconfirmed address signs up again (checked live on the dev project with `npm run check:auth-behaviour`, 2026-11-06). So someone could sign up with another person's address and their own password and never confirm; when the real owner later signs up, the email they receive confirms that pending account, and the stranger's password would then work. Mitigation: the confirmation link (`type=email`) confirms the address but never leaves the person signed in. It signs out again and sends them to log in ("Your email is confirmed. Log in to continue."). An owner whose address was pre-registered finds that their own password does not work and uses Forgot password, which replaces the stranger's password. Reset links (`type=recovery`) still sign in, so a new password can be chosen. Operations: delete unconfirmed users older than 7 days (Supabase dashboard or SQL), so a stranger's pending account does not wait indefinitely for the owner. Google sign-in for an address that already has a confirmed password account signs into that same account. Signing up with an address that already exists shows a neutral "check your email" message that does not reveal whether it exists.
- **Open sign-up from step 1a is accepted.** Abuse is limited with database-backed rate limits per email and per account, plus a generous per-IP cap (about 30 sign-up attempts an hour) so a whole college Wi-Fi network is not locked out. No CAPTCHA in Phase 1. If abuse appears, a CAPTCHA goes behind its own interface later. The real risk is exhausting Gmail's daily sending limit, so lower the hourly email limit in Supabase's Auth settings and watch for it during the pilot.

## 6. How it behaves

### 6.1 Screens

| Screen | Who sees it | What it does |
|---|---|---|
| `/` | Everyone | Signed out: a short pitch with Sign up and Log in. Signed in: the group list, or an empty state with "Create a group" and "Join with a code". |
| `/signup`, `/login` | Signed out | Email and password forms, with Google. Password managers work. Inputs are at least 16px so phones do not zoom. |
| `/forgot-password`, `/reset-password` | Signed out | Request a reset email, then set a new password from the link. |
| email confirmation link | Anyone | Opens a small page with a Continue button (only the button uses the link, so mail scanners cannot). Continue confirms the address and asks the person to log in, then continues to the group they were joining, or home. A reset link's Continue goes to "Choose a new password"; an expired reset link explains itself and offers a new one. |
| `/invite/[token]` | Anyone with the link | Signed out: layout A. Signed in: the group name and "Join" (with a password field in password mode). |
| `/join` | Signed in | Enter a short code, then the same steps as an invite link. |
| `/groups/new` | Signed in | Name, optional description, join mode (password is the default), password. After creating, a "Group created" screen shows the invite link, the short code and, once, the password with a Copy button and a reminder to send it separately. |
| `/groups/[id]` | Members | The group shell: header with group switcher, bottom tabs on phones, a side list on desktop. Library tab shows an empty state. |
| Members tab | Members | The member list. Owners can remove people and transfer ownership. Anyone can leave. |
| Settings tab | Owner | Edit name and description, change join mode, set a new password (shown once), see and reset the invite link and code, share on WhatsApp, copy link, invite by email and manage pending invites, delete the group. |
| `/account` | Signed in | Edit display name, log out. |
| `/terms`, `/privacy` | Everyone | The two short documents. |

### 6.2 Joining

1. The person opens the invite link or enters a code.
2. If signed out, they sign up or log in (including the email confirmation round trip) and come back to the same invite page automatically.
3. In password mode they enter the group password. Five wrong attempts in 15 minutes lock that person out of that group for the rest of the window. In link-only mode they join at once.
4. They land inside the group.

A banned (removed) person, a deleted group, an unknown or reset link and a full group each get a clear message that says what happened without revealing details (for example, it never reveals the member list to a non-member).

### 6.3 Sharing and inviting

- **Share on WhatsApp** opens WhatsApp with the message already written (a `wa.me` link carrying the invite URL). In password mode the message reads like "Join CSE 2nd Year on study-share: <link>. Ask <owner name> for the group password." The password itself is never in the message. On phones that support it, the system share sheet is offered as well. A copy-link button and the short code are also shown.
- **Email invites:** the owner enters email addresses (up to 50 a day per person). Each person gets a personal link that expires after 7 days. It obeys the same password rule as the group link.

### 6.4 Member management

- The owner can remove a member (blocks rejoining), transfer ownership to another active member, and delete the group.
- The owner cannot leave without transferring ownership or deleting the group.
- Any other member can leave. Their data stays, shown as "Former member" where it appears later.

## 7. Data and security requirements

These say what must be true, not how the tables are laid out. The builder designs the schema within the existing Drizzle and RLS rules.

- Every table has Row Level Security on and no public access. All access goes through server code that calls `can()`.
- The group password is stored only as a salted slow hash (for example scrypt), compared in constant time, and never logged. It is shown to the owner exactly once, at creation or when changed, and can never be read back.
- Invite tokens and email-invite tokens are long random values. Email-invite tokens are stored hashed, since they are shown only once. A reset kills the old value at once.
- Join attempts, sign-up, password reset, email invites and group creation are rate limited using the existing `rate_limits` approach (the database, no new vendor).
- Every authenticated person has a profile row, including those who sign up with Google. The age confirmation and terms acceptance are recorded with a timestamp and version, and are required before the first group action.
- Membership has roles (owner, member) and statuses (active, removed). Pending and the admin role are reserved for Phase 5 and unused now. Every read of group data requires an active membership.
- A removed person cannot rejoin by any path: link, code or email invite.
- Account and group data never appears in URLs other than the invite token, and error messages never contain secrets or other people's details.

### Known risks accepted for the pilot

- **Response time can hint whether an address has an account.** Sign-up, resend and reset give the same words for every address, but Supabase sends a Gmail message only for new addresses or real targets, and that send takes time. Someone timing many requests could guess which addresses are registered. Accepted for the pilot (no artificial padding); revisit before public launch.
- **Targeted lockout of password log-in.** Log-in is limited per email (10 tries in 15 minutes, counting every attempt), so anyone can lock a known address out of password log-in for 15 minutes. Accepted: Google sign-in and the reset link still work, and the limit stops password guessing.
- **Supabase's own limits are shared by everyone.** Every auth call comes from our server on Vercel, not from the person's phone, so Supabase's per-IP limits (and its per-address email limit) may count all our users as one visitor. The app adds its own one-email-a-minute cooldown per address and says honestly when an email could not be sent; Supabase's per-IP and email limits must be raised to fit the class (plan Task 10).

## 8. Phones and quality bar

- Designed at 360px first. No sideways scrolling anywhere, from 360px up.
- Tap targets at least 44px. Inputs at least 16px. Correct `autocomplete`, `inputmode` and `type` attributes on every field.
- The bottom tab bar respects the phone's safe area and is not hidden by the keyboard. Long names truncate and never push the layout wider.
- Google sign-in does not work inside some apps' built-in browsers. Detect that case and show "Open in your browser" with a copy-link fallback, so nobody gets stuck.
- Performance target on a mid-range Android phone over 4G: the sign-up and invite pages reach a usable state in under about 3 seconds. The builder sets a measured budget and checks it with Lighthouse mobile.
- Accessibility: keyboard-reachable, visible focus, WCAG AA contrast, labelled fields, errors announced and tied to the field.
- Empty, loading and error states are designed, with skeletons and plain-language messages.
- **Browser tests run at phone and desktop sizes** with a touch device profile, and they must really check the phone layout (the Phase 0 phone test was too weak; see the deferred findings). They must run in CI without real Google, real email or the real Supabase project, so the `AuthProvider` interface needs a test implementation that is refused when `APP_ENV` is production.

## 9. Setup the owner does (with guidance)

- In the dev and production Supabase projects: set the Site URL and allowed redirect URLs (production address, local address, and Vercel preview addresses), point Auth's SMTP at the project Gmail account, and set minimum password length 8.
- A Google Cloud project with an OAuth client for "Continue with Google". The consent screen must be **published** (not left in "testing"), because testing mode only lets 100 named test users in. Only the basic sign-in scopes (email and profile) are requested, which need no Google review.
- Vercel settings: nothing new unless a new setting is added.

## 10. Edge cases the phase must handle

- The invite link is opened while already signed in, signed out, or after signing up in another tab.
- Email confirmation link opened on a different device than the sign-up, or after it expired: clear message and a "resend" option.
- Someone signs up with an email that already exists, or with Google using an email that already has a password account.
- Two people join at the same moment the group reaches 300 members, or the same person double-taps Join: never exceed the limit and never create two memberships.
- The owner resets the link while someone is mid-way through joining.
- The owner removes someone who is on the Members page, or deletes the group while members are using it.
- A person already in the group opens the invite link again: they are taken to the group.
- Wrong group password repeatedly, from several devices.
- The owner loses the password they set: they set a new one. Existing members are unaffected.
- An email invite is forwarded to someone else, or opened by a person who signed up with a different address: it still works once, until it expires or is revoked.
- A group with a very long name, or names in other scripts (Hindi, Telugu, emoji), on a 360px phone.
- Browser storage blocked, or cookies disabled: a clear message instead of a loop.

## 11. Acceptance: "done when"

Phase 1 is done when, on the live site and on both a phone and a desktop, two real people can:
1. sign up (one with email and password, one with Google), confirm email, and log in;
2. have one create a group in password mode and the other join it from a WhatsApp link, then from a short code;
3. invite a third person by email and see them join;
4. remove a member and see that they cannot rejoin, transfer ownership, and delete a group;

and the unit, database and browser tests pass in CI at phone and desktop sizes.

## 12. Left to the builder

Database layout and migrations; page-level component structure; exact copy and microcopy; token and code generation details; the rate-limit windows beyond those stated; how the `AuthProvider` test implementation works; the performance budget numbers; the draft wording of Terms and Privacy.
