# Registration redesign: email codes, Google, forgot password

Status: approved by the owner in conversation on 2026-11-07 (flows, the "tell them clearly" choice, and **codes only: no verification link anywhere**). This **replaces** the sign-up, confirmation and reset behaviour described in [the Phase 1 design](2026-11-06-phase-1-accounts-and-groups-design.md), sections 4.2, 6.1 and the "Same email, two ways in" decision. Everything else in that design (phones first, rate limits, cookies, ports and adapters, the quality bar) still applies.

## 1. Why

The first version confirmed email through a link only, and a live probe showed Supabase keeps the FIRST password when someone signs up twice with the same unconfirmed email, so a stranger who pre-registered an address could keep access. Real people also expect the registration model they already know from large platforms: enter email and password, get a code, type it in, you are in; or continue with Google; and a forgot-password flow that sends a code. This redesign delivers that model and closes the takeover gap properly.

## 2. Goals, non-goals

### Goals
- Email sign-up with a **6-digit code** emailed to the person. Emails contain the code only: no verification link.
- **Continue with Google** with an account chooser every time.
- **Forgot password** with an emailed code, then a new password.
- A pending sign-up can never give anyone access to an address they do not control; the newest sign-up always wins.
- One account per email address, whichever way the person arrives.
- All the everyday edge cases handled with clear messages (section 6).
- Phones first, as before: 44px targets, 16px inputs, one-tap code autofill.

### Non-goals
SMS codes, two-factor authentication, CAPTCHA, passwordless "email me a login code", other social providers (Apple, Microsoft), account deletion by the user, and automating the unconfirmed-account sweep (it stays an operations note).

## 3. Decisions

**Decided by the owner**
| Decision | Choice |
|---|---|
| Email sign-up | Enter name, email and password, tick 18+ and Terms, tap Create account, then enter the emailed 6-digit code. The email contains the code only, no link. |
| After the code | The person is signed in and lands on the home page. |
| Google | Tap Continue with Google, choose which Google account, confirm, land on the home page. |
| Forgot password | Enter email, enter the emailed code, create a new password. |
| Existing email on sign-up | Tell the person clearly: "This email already has an account. Log in or reset your password." Log-in errors and Forgot password stay private ("email or password is wrong"; "if an account exists we sent a code"). |

**My calls, for the owner to check**
- Codes are 6 digits (the Supabase project setting "Email OTP length" must be 6; the app rejects other lengths), last **10 minutes**, and a wrong-code limit of **5 tries per 15 minutes per email** applies; "Resend code" has the existing 60-second cooldown and a visible countdown.
- Google users accept the 18+ and Terms by the sentence "By continuing you confirm you are 18 or older and accept the Terms and Privacy Notice" shown under both buttons; the acceptance is recorded automatically when the Google sign-up completes. The `/welcome` step remains only for people whose accepted terms version is out of date.
- After a password reset the person is signed in and **every other device is signed out**.
- An email that exists only as a Google account: sign-up says "This email is registered with Google. Continue with Google, or reset your password to add one." The same hint ("Signed up with Google? Use Continue with Google.") sits on the log-in page.
- Log-in for an email that is registered but unconfirmed: "Your email is not confirmed yet" with a button that sends a new code and opens the code screen.

## 4. The flows

### 4.1 Email sign-up
1. `/signup`: name, email, password, one checkbox. Validation errors appear next to the field.
2. On submit the server checks the email's state (no account, unconfirmed sign-up, confirmed account, Google-only account):
   - **No account:** create the pending account (Supabase `signUp`), which emails the code.
   - **Unconfirmed sign-up:** delete that pending account first, then create a new one, so the newest sign-up always wins (closes the pre-registration gap; the real owner's mailbox is the only place a working code goes).
   - **Confirmed account or Google-only account:** show the clear "already has an account" message and send nothing.
3. The person moves to `/signup/verify` (a short-lived cookie remembers the address, so a reload or a closed tab can resume): a code box (`autocomplete="one-time-code"`, numeric keypad, paste accepted with spaces or dashes), **Verify**, **Resend code** with a countdown, and **Change email**.
4. A correct code verifies and signs the person in (Supabase `verifyOtp`), then they go to the page they were heading for (`next`) or home.

### 4.2 Continue with Google
Sign-up and log-in pages both show the button. The request always asks Google to show the account chooser (`prompt=select_account`). After Google returns:
- The account is created or opened (an email that already has a confirmed password account signs into that same account).
- **Pre-registration repair:** if the account has any unconfirmed email sign-up attached (a stranger's pending password), the password is cleared and the pending identity removed, so only Google proves ownership.
- Terms are recorded (see section 3); the person lands on the home page.

### 4.3 Forgot password
1. `/forgot-password`: email. The reply is always "If an account exists for that email, we sent a code" (nothing reveals whether it exists).
2. `/reset-password`: code box (same behaviour as 4.1), then, once the code is accepted, "Create a new password" (8 or more characters, show/hide). Accounts that exist only through Google can add a password this way.
3. On success the password is changed, **other devices are signed out**, the person is signed in here and lands on home with a "Password updated" message.

### 4.4 Log in
Unchanged: one generic error for a wrong email or password; a hint for Google users; the unconfirmed case above.

## 5. Security model
- A pending account's password is only usable after the code proves control of the mailbox, and the newest sign-up replaces older pending ones, so a stranger's earlier password is never the one that works.
- Wrong codes are limited (5 per 15 minutes per email) on top of Supabase's own limits; codes are single-use and expire in 10 minutes.
- Sign-up deliberately tells the person when an email is already registered (the owner's choice). It is protected by the existing per-IP and per-email limits and the shared one-email-a-minute cooldown, and sign-up lookups never return anything beyond the state needed for the message.
- Log-in, Forgot password and resend keep the private (identical) responses.
- The server needs read access to who has an account and the power to remove a pending sign-up: this lives behind a new port (an account directory and admin interface) with a Supabase adapter, using the service role key that already exists. No service key reaches the browser.
- All earlier rules stay: cookies httpOnly, same-site paths only for `next`, secrets never logged, the test mode refused in production.

### 5.1 Binding a code to the person who signed up (builder-check finding, binding)
"Newest sign-up wins" only protects the owner when the owner signs up LAST. If a stranger signs up the victim's address just after the victim, the victim's inbox would hold a code for the stranger's pending account, with the stranger's password. Rules:
- The sign-up creates a **signed, httpOnly, short-lived "pending sign-up" cookie** that holds the pending user's id and the address (nothing secret beyond that). It is trusted only to decide the rule below and to pre-fill the address, never to authenticate anyone.
- After creating the pending account, the server **checks the password on it** by trying to sign in with the password the person just typed: an unconfirmed account answers "email not confirmed" only when the password is right and "invalid credentials" when it is not. If it is not right (another sign-up got there first), the pending account is removed (only if still unconfirmed) and created again, once. This also closes the race of two sign-ups at once.
- When a **code confirms a user who matches the cookie**, everything is normal: the person is signed in.
- When a code confirms a user who does NOT match the cookie, or when there is no cookie (another device or a cleared browser), the server **replaces the account's password with a random one** immediately, and the person must **create a password** on the spot before finishing (they are already signed in by the code). A stranger's password never survives, and a real owner on a second device sets a password in one extra step.
- Resend and the code box always act on the pending user in the cookie.

### 5.2 Reading account state and replacing pending sign-ups
- The server reads "no account / unconfirmed sign-up / confirmed account / Google-only account" and removes pending sign-ups through a new port with an implementation in `src/server/db` that runs **SQL on the `auth` schema** over the existing database connection (read `auth.users` and `auth.identities`; delete with `... where id = $1 and email_confirmed_at is null` so a just-confirmed account can never be deleted by a race). The Supabase Admin API has no lookup by email and no conditional delete, so it is used only where SQL cannot do the job (setting a random password).
- "Google-only" means no usable password: decide it from the account's identities and whether a password has been set, not from the identities alone, so a Google user who later added a password through Forgot password is shown the right message.

### 5.3 Google repair details (builder-check finding, binding)
- Whether Supabase already clears an unconfirmed password when a Google identity links is unknown and cannot be tested without a real Google account, so the app does it itself, defensively: after a Google sign-in the server checks the account for a pending email sign-up (unconfirmed email identity or a password set before any confirmation) and, if found, sets a random password, removes the pending email identity, and **overwrites the display name and terms with the Google user's own** (so nothing the stranger entered survives, and terms are recorded as accepted by the Google user).
- If the repair step fails after Google has issued a session, the server signs the person out and shows "Something went wrong signing you in with Google. Please try again."
- Google terms rule: a Google user whose accepted terms version is empty is recorded as accepted at sign-in (they pressed the button under the "By continuing you confirm..." sentence); a user whose version is out of date goes to `/welcome` to read and accept the new version.

### 5.4 Session and lifetime notes (accepted for the pilot)
- "Sign out other devices" revokes refresh tokens; a session already open elsewhere can keep working until its short access token expires (up to an hour). A recovery code signs the person in before they choose a password; if they leave at that point nothing changes elsewhere.
- Codes last 10 minutes (Supabase's "Email OTP expiration"); a person who types a late code sees "This code has expired" and can request a new one.

## 6. Edge cases the redesign must handle
- Wrong code, expired code, used code, a code from an older email after a resend: Supabase answers all four identically, so the app shows one honest message ("That code is wrong or has expired. Request a new one.") with a way to get a new code; too many wrong tries has its own lock message from our own counter.
- Resend before the cooldown ends (countdown shown, button disabled).
- Reload or close the tab on the code screen: resume through the remembered address; "Change email" starts over.
- Typo in the email: Change email; the abandoned pending account is replaced or swept.
- Sign-up while already signed in: go home. Log-in page while signed in: go home.
- Code used on a different device than the sign-up (works, with the one-step password creation of section 5.1; the verify form also accepts the address typed in).
- The same email through email and Google: one account (Google into an existing password account signs into it; email sign-up for a Google-only address gets the Google message).
- Double submit of every form (button disabled while pending; server-side idempotence for the code check).
- Browser back button, autofill and password managers, show/hide password, very long names, other scripts, emoji.
- Provider limits or outages: honest "we couldn't send the email right now" (existing behaviour) and the code screen still allows "I already have a code".
- Disabled cookies: the code screen still works because the verify form includes the address.

## 7. What changes in the project
- **Supabase settings (owner):** the **Confirm signup** and **Reset password** email templates now contain the 6-digit `{{ .Token }}` code ONLY (no link at all); **Email OTP expiration** is set to 600 seconds; code length stays 6. Exact template HTML goes into `docs/SETUP_AUTH.md`.
- **Code:** a new account-directory/admin port and adapter; `AuthProvider` gains code verification (`verifyEmailCode`, `verifyRecoveryCode`, a password change that signs out other devices) and Google account-chooser support; sign-up, verify, forgot-password and reset pages; **the whole link flow is deleted** (`/auth/confirm`, its Continue page, `readEmailLink`/`confirmLinkTarget` and their tests, the `/login?confirmed` notice), because emails carry codes only; use-cases and rate limits for code attempts; the fake provider and browser tests updated; the live probe script extended; the setup guide updated.
- **Unchanged:** profiles and the database trigger, rate-limit table, cookies, the phone quality sweep (extended to the new pages), CI.

## 8. Known risks accepted
- Sign-up reveals whether an email is registered (owner's choice).
- The response-time difference between existing and unknown addresses on Forgot password, and the targeted lockout of per-email limits, stay as recorded in the Phase 1 design.
- Unconfirmed sign-ups older than 7 days are swept by hand (operations note), not automatically.

## 9. Acceptance ("done when")
On the live site, on a phone and a desktop, with real inboxes: (1) sign up by email, enter the code, land home signed in; (2) sign up on one device and enter the code on another (the one-step password creation); (3) a wrong code, an expired code and a resend each behave as described; (4) signing up with an email that already has an account shows the clear message; (5) Continue with Google shows the account chooser and lands home; (6) an email registered through Google gets the Google message on email sign-up; (7) Forgot password by code and by link both end with a new password, signed in, other devices signed out; (8) a stranger's pending sign-up cannot be used: sign up with address A and password P1, sign up again with P2, confirm: only P2 works, and a code or link that confirms an account this browser did not create forces a new password; and tests pass in CI at phone and desktop sizes.
