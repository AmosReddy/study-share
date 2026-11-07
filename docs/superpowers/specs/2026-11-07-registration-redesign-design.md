# Registration redesign: code or link, Google, forgot password

Status: approved by the owner in conversation on 2026-11-07 (flows and the "tell them clearly" choice). This **replaces** the sign-up, confirmation and reset behaviour described in [the Phase 1 design](2026-11-06-phase-1-accounts-and-groups-design.md), sections 4.2, 6.1 and the "Same email, two ways in" decision. Everything else in that design (phones first, rate limits, cookies, ports and adapters, the quality bar) still applies.

## 1. Why

The first version confirmed email through a link only, and a live probe showed Supabase keeps the FIRST password when someone signs up twice with the same unconfirmed email, so a stranger who pre-registered an address could keep access. Real people also expect the registration model they already know from large platforms: enter email and password, get a code, type it in, you are in; or continue with Google; and a forgot-password flow that sends a code. This redesign delivers that model and closes the takeover gap properly.

## 2. Goals, non-goals

### Goals
- Email sign-up with a **6-digit code** (primary) or a **verification link** (alternative) in the same email.
- **Continue with Google** with an account chooser every time.
- **Forgot password** with a code (or link), then a new password.
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
| Email sign-up | Enter name, email and password, tick 18+ and Terms, tap Create account, then enter the emailed code. The same email also carries a verification link. |
| After the code | The person is signed in and lands on the home page. |
| After the link | A page says "Your email is verified. You can log in now." with a Log in button (no automatic sign-in, because the link may be opened on another device). |
| Google | Tap Continue with Google, choose which Google account, confirm, land on the home page. |
| Forgot password | Enter email, enter the emailed code, create a new password. |
| Existing email on sign-up | Tell the person clearly: "This email already has an account. Log in or reset your password." Log-in errors and Forgot password stay private ("email or password is wrong"; "if an account exists we sent a code"). |

**My calls, for the owner to check**
- Codes are 6 digits, last **10 minutes**, and a wrong-code limit of **5 tries per 15 minutes per email** applies; "Resend code" has the existing 60-second cooldown and a visible countdown.
- Google users accept the 18+ and Terms by the sentence "By continuing you confirm you are 18 or older and accept the Terms and Privacy Notice" shown under both buttons; the acceptance is recorded automatically when the Google sign-up completes. The `/welcome` step remains only for people whose accepted terms version is out of date.
- After a password reset the person is signed in and **every other device is signed out**.
- An email that exists only as a Google account: sign-up says "This email is registered with Google. Continue with Google, or reset your password to add one." The same hint ("Signed up with Google? Use Continue with Google.") sits on the log-in page.
- Log-in for an email that is registered but unconfirmed: "Your email is not confirmed yet" with a button that sends a new code and opens the code screen.

## 4. The flows

### 4.1 Email sign-up
1. `/signup`: name, email, password, one checkbox. Validation errors appear next to the field.
2. On submit the server checks the email's state (no account, unconfirmed sign-up, confirmed account, Google-only account):
   - **No account:** create the pending account (Supabase `signUp`), which emails the code and the link.
   - **Unconfirmed sign-up:** delete that pending account first, then create a new one, so the newest sign-up always wins (closes the pre-registration gap; the real owner's mailbox is the only place a working code goes).
   - **Confirmed account or Google-only account:** show the clear "already has an account" message and send nothing.
3. The person moves to `/signup/verify` (a short-lived cookie remembers the address, so a reload or a closed tab can resume): a code box (`autocomplete="one-time-code"`, numeric keypad, paste accepted with spaces or dashes), **Verify**, **Resend code** with a countdown, and **Change email**.
4. A correct code verifies and signs the person in (Supabase `verifyOtp`), then they go to the page they were heading for (`next`) or home.
5. The link in the same email opens `/auth/confirm` (a Continue page, so mail scanners cannot use it up); Continue verifies and shows `/verified` ("Your email is verified. You can log in now.").

### 4.2 Continue with Google
Sign-up and log-in pages both show the button. The request always asks Google to show the account chooser (`prompt=select_account`). After Google returns:
- The account is created or opened (an email that already has a confirmed password account signs into that same account).
- **Pre-registration repair:** if the account has any unconfirmed email sign-up attached (a stranger's pending password), the password is cleared and the pending identity removed, so only Google proves ownership.
- Terms are recorded (see section 3); the person lands on the home page.

### 4.3 Forgot password
1. `/forgot-password`: email. The reply is always "If an account exists for that email, we sent a code" (nothing reveals whether it exists).
2. `/reset-password`: code box (same behaviour as 4.1), then, once the code is accepted, "Create a new password" (8 or more characters, show/hide). Accounts that exist only through Google can add a password this way.
3. On success the password is changed, **other devices are signed out**, the person is signed in here and lands on home with a "Password updated" message.
4. The link in the same email opens the Continue page, then goes straight to the "Create a new password" step.

### 4.4 Log in
Unchanged: one generic error for a wrong email or password; a hint for Google users; the unconfirmed case above.

## 5. Security model
- A pending account's password is only usable after the code or link proves control of the mailbox, and the newest sign-up replaces older pending ones, so a stranger's earlier password is never the one that works.
- Wrong codes are limited (5 per 15 minutes per email) on top of Supabase's own limits; codes are single-use and expire in 10 minutes.
- Sign-up deliberately tells the person when an email is already registered (the owner's choice). It is protected by the existing per-IP and per-email limits and the shared one-email-a-minute cooldown, and sign-up lookups never return anything beyond the state needed for the message.
- Log-in, Forgot password and resend keep the private (identical) responses.
- The server needs read access to who has an account and the power to remove a pending sign-up: this lives behind a new port (an account directory and admin interface) with a Supabase adapter, using the service role key that already exists. No service key reaches the browser.
- All earlier rules stay: cookies httpOnly, same-site paths only for `next`, secrets never logged, the test mode refused in production.

## 6. Edge cases the redesign must handle
- Wrong code, expired code, used code, a code from an older email after a resend, too many wrong tries: each a clear message and a way to get a new code.
- Resend before the cooldown ends (countdown shown, button disabled).
- Reload or close the tab on the code screen: resume through the remembered address; "Change email" starts over.
- Typo in the email: Change email; the abandoned pending account is replaced or swept.
- Sign-up while already signed in: go home. Log-in page while signed in: go home.
- Code entered on a different device than the sign-up (works: the address is in the cookie only for convenience; the verify form also accepts the address typed in).
- Link opened on another device or after the code was already used: the verified page or a clear "link expired" with a way to request a new code.
- The same email through email and Google: one account (Google into an existing password account signs into it; email sign-up for a Google-only address gets the Google message).
- Double submit of every form (button disabled while pending; server-side idempotence for the code check).
- Browser back button, autofill and password managers, show/hide password, very long names, other scripts, emoji.
- Provider limits or outages: honest "we couldn't send the email right now" (existing behaviour) and the code screen still allows "I already have a code".
- Disabled cookies: the code screen still works because the verify form includes the address.

## 7. What changes in the project
- **Supabase settings (owner):** the **Confirm signup** and **Reset password** email templates now contain the 6-digit `{{ .Token }}` code AND the existing server link; **Email OTP expiration** is set to 600 seconds; code length stays 6. Exact template HTML goes into `docs/SETUP_AUTH.md`.
- **Code:** a new account-directory/admin port and adapter; `AuthProvider` gains code verification (`verifyEmailCode`, `verifyRecoveryCode`, a password change that signs out other devices) and Google account-chooser support; sign-up, verify, forgot-password and reset pages; `/verified`; use-cases and rate limits for code attempts; the fake provider and browser tests updated; the live probe script extended; the setup guide updated.
- **Unchanged:** profiles and the database trigger, rate-limit table, cookies, the phone quality sweep (extended to the new pages), CI.

## 8. Known risks accepted
- Sign-up reveals whether an email is registered (owner's choice).
- The response-time difference between existing and unknown addresses on Forgot password, and the targeted lockout of per-email limits, stay as recorded in the Phase 1 design.
- Unconfirmed sign-ups older than 7 days are swept by hand (operations note), not automatically.

## 9. Acceptance ("done when")
On the live site, on a phone and a desktop, with real inboxes: (1) sign up by email, enter the code, land home signed in; (2) sign up by email and use the link instead, see the verified page, log in; (3) a wrong code, an expired code and a resend each behave as described; (4) signing up with an email that already has an account shows the clear message; (5) Continue with Google shows the account chooser and lands home; (6) an email registered through Google gets the Google message on email sign-up; (7) Forgot password by code and by link both end with a new password, signed in, other devices signed out; (8) a stranger's pending sign-up cannot be used: sign up with address A and password P1, sign up again with P2, confirm: only P2 works; and tests pass in CI at phone and desktop sizes.
