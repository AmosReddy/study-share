# Setting up accounts (owner guide)

This guide walks you through everything outside the code that sign-up, log-in, password reset and "Continue with Google" need: Supabase Auth settings, Gmail for sending email, a Google sign-in client and Vercel settings. It is written so you can follow it one tick box at a time. Keep it for later: you will repeat parts of it for any new environment.

Nothing here needs you to write code. You will click through three dashboards and run a few commands in a terminal in the project folder.

**How registration works now (so the settings make sense).** Nobody clicks a link in an email any more. Sign-up and Forgot password send an email that contains only a **6-digit code**. The person types the code into the site. Supabase makes and checks the codes, Gmail delivers them, and the two email templates in Supabase decide what the email looks like. That is why this guide has you change two templates and two code settings.

## If you finished the first version of this guide (read this first)

You already completed Parts 1 to 5 of the first version: the Gmail app password, the Supabase dev settings, Google Cloud, the production Supabase project, the production settings file (outside OneDrive) and the production database migrations. **You do not need to redo any of that.**

What is new is collected in **Part 0: What changed (do these now)**. Do Part 0, then Part 6 (Vercel, still open), then Parts 7, 8 and 9. Parts 1 to 5 stay below as reference and are marked "already done: skip unless you are starting from scratch". Where their old text was wrong for codes, it has been corrected.

If you are setting up from nothing, do Parts 1 to 5 first (they point you to Part 0 for the code settings), then the rest in order.

## How to read this guide

Each step starts with a label that says where you do it.

| Label | Where |
|---|---|
| **[DEV]** | The Supabase project named like `study-share-dev` |
| **[PROD]** | The Supabase project named like `study-share-prod` |
| **[GOOGLE]** | Google Cloud Console |
| **[GMAIL]** | The project Gmail account |
| **[VERCEL]** | The Vercel project |
| **[TERMINAL]** | A terminal opened in the project folder on your computer |
| **[PHONE]** | A real phone, plus a desktop browser |
| **[CONTROLLER]** | Something the developer or controller does and reports back to you. You do not need to do it |

After most steps you will see **You should see** (what a correct result looks like) and **If it looks different** (what to try). Dashboards change their names and menus now and then, so the words in this guide may differ slightly from what you see. If a menu has moved, use the dashboard's search box or look at the nearby menu items for the same word. If you cannot find a setting at all, stop and ask the developer: do not guess.

**Never paste a password, key, token or email code into a chat, a document or a commit.** Secrets go into the dashboards and into `.env.local` or the production settings file on your computer only. Those files are not committed.

### Names used in this guide

These are placeholders. Replace them with your real values as you go, and keep the real ones somewhere private.

| Placeholder | Meaning |
|---|---|
| `<project Gmail address>` | The Gmail account made just for this project |
| `<app password>` | The 16-character Gmail app password (Part 1) |
| `<your-dev-project-ref>` | The dev Supabase project's reference id. In Supabase: Project Settings, General, "Reference ID". It is also the first part of `https://<your-dev-project-ref>.supabase.co` |
| `<your-prod-project-ref>` | The same for the production project |
| `<your-vercel-team-slug>` | The last part of your Vercel preview addresses, before `.vercel.app` |
| `<production env file>` | The full path to the FILE (folder and file name, not just the folder) that holds your production settings (Part 5, step 5.2.1), for example the path of a `.env.production.local` in a private folder outside the project folder |
| `<live address>` | The production site address, for example `https://study-share-amber.vercel.app` |
| `<dev alias>` | `https://study-share-git-feature-phase-1a-accounts-amos-6f52.vercel.app`, the stable address of the branch preview |

### The order, at a glance

Use this as your tick list.

- [x] Part 1: Gmail app password (done)
- [x] Part 2: Supabase dev settings (done, except what Part 0 changes)
- [x] Part 3: Google sign-in (done)
- [x] Part 4: Supabase production settings (done, except what Part 0 changes)
- [x] Part 5: Database migrations, dev and production (done)
- [ ] **Part 0: What changed (do these now): codes instead of links, in BOTH Supabase projects**
- [ ] Part 6: Vercel settings and redeploy (still open)
- [ ] Part 7: Checks from your computer (run again)
- [ ] Part 8: Live acceptance on a phone and a desktop
- [ ] Part 9: The merge gate
- [ ] Part 10: Operations from the pilot on

After the parts, read **Known risks you accept for the pilot** and keep the **Troubleshooting** table for later.

---

## Part 0: What changed (do these now)

Everything in this part is new. You do each step in the **dev** project first and then again in the **production** project. Tick both boxes of every step.

### What you will change, at a glance

| Setting | Where in the dashboard (names may differ slightly) | Value | Dev | Prod |
|---|---|---|---|---|
| **Confirm signup** email template | Authentication, Emails, Templates | The code template in step 0.1 | [ ] | [ ] |
| **Reset password** email template | Authentication, Emails, Templates | The code template in step 0.2 | [ ] | [ ] |
| **Email OTP Length** | Authentication, Sign In / Providers, Email | **6** (required, see step 0.3) | [ ] | [ ] |
| **Email OTP Expiration** | Authentication, Sign In / Providers, Email | **600** seconds | [ ] | [ ] |
| **Rate limit for token verifications** | Authentication, Rate Limits | **100** (recommendation, see step 0.4) | [ ] | [ ] |
| Require current password when updating | Authentication, Sign In / Providers, Email | Check that it matches dev (step 0.5) | [ ] | [ ] |

Settings that stay exactly as you already have them (just look at them in step 0.6): Confirm email ON, minimum password length 8, Gmail SMTP, the raised sign-up, sign-in and token-refresh limits, and the redirect URLs.

**Timing.** The old link-style templates stop working once the new code is on the preview, and the new code templates do not suit the old pages. Nothing is live for real users yet, so it does not matter, but do all of Part 0 before you start Part 8.

### 0.1 Replace the Confirm signup template

**[DEV]** then **[PROD]**.

- [ ] **0.1.1** Open the project in the Supabase dashboard. Go to Authentication, then Emails, then **Templates** (older dashboards: Authentication, Email Templates), and open **Confirm signup**.
- [ ] **0.1.2** Set the **Subject** to exactly: `Your study-share code`
- [ ] **0.1.3** Select everything in the message body (HTML) box, delete it, and paste exactly this. Do not keep any old line that contains a link:

```html
<h2>Your study-share code</h2>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>This code expires in 10 minutes. If you did not create an account, ignore this email.</p>
```

  `{{ .Token }}` is the Supabase placeholder for the code. Keep the double curly braces and the spaces as shown. The email must contain **no link**: no `{{ .ConfirmationURL }}`, no `{{ .SiteURL }}`, no `<a>` tag.
- [ ] **0.1.4** If the dashboard also shows a **plain text** version of the template (some versions have a second tab or box for it), put this single line in it: `Your study-share code is {{ .Token }}. It expires in 10 minutes. If you did not create an account, ignore this email.` If there is no plain text box, skip this step.
- [ ] **0.1.5** Save.
  - **You should see:** a "saved" message. After you reload the page, the subject and the code template are still there, and the preview shows a large number in place of `{{ .Token }}` (the preview may show a sample value).
  - **If it looks different:** if the old link text is still there after a reload, the save did not work: paste again and save again. If the editor does not accept the `style=` part, tell the developer; the email still works without the styling, only the code looks smaller.

### 0.2 Replace the Reset password template

**[DEV]** then **[PROD]**.

- [ ] **0.2.1** In the same Templates list, open **Reset password** (the old name may be "Reset Password").
- [ ] **0.2.2** Set the **Subject** to exactly: `Your study-share code`
- [ ] **0.2.3** Replace the whole body with exactly this:

```html
<h2>Your study-share code</h2>
<p>Use this code to reset your password.</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>This code expires in 10 minutes. If you did not ask to reset your password, ignore this email.</p>
```

- [ ] **0.2.4** If there is a plain text box, put this line in it: `Your study-share code to reset your password is {{ .Token }}. It expires in 10 minutes. If you did not ask for this, ignore this email.` Otherwise skip.
- [ ] **0.2.5** Save.
  - **You should see:** the same kind of result as step 0.1.5, for this template.
  - **If it looks different:** the same hints as step 0.1.5.

Leave the other templates (Magic link, Invite user, Change email address, Reauthentication) as they are: the app does not use them.

### 0.3 Email OTP length and expiration

**[DEV]** then **[PROD]**. The app only accepts codes of exactly 6 digits and rejects any other length before it asks Supabase. **If a project issues codes of another length, registration cannot work.** The dev project was found issuing 8-digit codes, so this step is required in **both** projects, even if production already shows 6.

- [ ] **0.3.1** Go to Authentication, then Sign In / Providers, then **Email** (older dashboards: Authentication, Providers, Email) and open the Email provider's settings.
- [ ] **0.3.2** Set **Email OTP Length** to **6**.
- [ ] **0.3.3** Set **Email OTP Expiration** to **600** (seconds, which is 10 minutes, the number the email says).
- [ ] **0.3.4** Save.
  - **You should see:** the two values still there after you reload. The next sign-up email shows a 6-digit code (you will see this in Part 8; Part 7 also checks it).
  - **If it looks different:** if you only find an expiration setting of 3600 seconds or more, it is the wrong field (that one is for something else). Look for the word "OTP" on the Email provider page, or search the dashboard for "OTP". Codes already emailed before the change keep their old length: ask for a new code after saving.

### 0.4 Lower the code-check rate limit (a recommendation)

**[DEV]** then **[PROD]**. The app limits wrong codes itself (5 tries per 15 minutes per email). But anyone who knows the public Supabase address of your project can also try codes straight against Supabase, bypassing the app. For that path, Supabase's own rate limit is the only protection, and a 6-digit code has only one million possibilities. So make that limit modest.

- [ ] **0.4.1** Go to Authentication, then **Rate Limits**.
- [ ] **0.4.2** Find **Rate limit for token verifications** (it may be worded "OTP and magic link verifications"; it is counted per IP address over a short window, shown on the page). If you raised it to 500 in the first version of this guide, lower it now. Set it to **100**.
- [ ] **0.4.3** Leave the others as they are: emails per hour (60), sign-ups and sign-ins (500), token refreshes (500). Save.
  - **You should see:** the new number saved, and the other numbers unchanged after a reload.
  - **If it looks different:** the exact wording and the time window are the dashboard's, so treat 100 as a starting recommendation, not a magic number. Why not lower? Every check made through the app comes from Vercel's servers, so Supabase counts everyone who confirms a code at the same moment as one visitor. 100 leaves room for a whole class registering within a few minutes. If people see "Too many attempts" while many register at once, raise it (for example to 200) and tell the developer. Never put it back to 500.

### 0.5 Check "require current password when updating"

**[DEV]** then **[PROD]**. On the dev project there is a setting that makes Supabase refuse a password change from a normal password log-in unless the current password is given. The app is built around that: a password can only be changed through a code (Forgot password). Production must behave the same. **Do not turn this setting off.**

- [ ] **0.5.1** **[DEV]** On the Email provider page (Authentication, Sign In / Providers, Email), find the toggle that says something like **Require current password when updating** (the exact name may differ; a nearby toggle named like "Secure password change" is a different, related setting). Write down whether it is ON.
- [ ] **0.5.2** **[PROD]** Open the same page in the production project. Make every toggle on this page match the dev project: especially this one (expected ON), Confirm email (ON) and the minimum password length (8). Save if you changed anything.
  - **You should see:** the two projects' Email provider pages look the same.
  - **If it looks different:** if one project has this toggle and the other does not show it at all, or you cannot tell which toggle is meant, stop and tell the developer. The check script cannot be run on production (it refuses), so the developer will look at it with you.

### 0.6 Look over the settings that must not change

**[DEV]** then **[PROD]**.

- [ ] **0.6.1** Email provider: enabled, **Confirm email ON**, **Minimum password length 8**.
- [ ] **0.6.2** Authentication, Emails, SMTP Settings: **Enable custom SMTP** is on (Gmail: host `smtp.gmail.com`, port `465`, your Gmail address, the app password).
- [ ] **0.6.3** Authentication, Rate Limits: emails per hour still at your value (60 recommended), sign-ups and sign-ins and token refreshes still raised (500).
- [ ] **0.6.4** Authentication, URL Configuration: Site URL and Redirect URLs as in step 2.3 (dev) and step 4.3 (production). **Redirect URLs are now used for Google sign-in only** (the page `/auth/callback`). The addresses ending in `/**` you already added cover it, so there is nothing to add or remove. Emails no longer contain any address from this page.
  - **You should see:** nothing changed from before.
  - **If it looks different:** if the dev Site URL is `http://localhost:3000` or the production Site URL is the dev alias, fix it as in Part 2.3 or Part 4.3.

### 0.7 What else is open

- [ ] **Part 6: Vercel.** Still open: `NEXT_PUBLIC_SITE_URL` for **Production only**, then redeploy. See Part 6 below.
- [ ] **Part 7: the checks.** Run both on dev, the services check on production. See Part 7 below.
- [ ] **Part 8: the live acceptance.** See Part 8 below.

---

## Part 1: Gmail app password

*Already done: skip unless you are starting from scratch.*

**[GMAIL]** Supabase will send the code emails through the project Gmail account. Gmail does not let other programs use your normal password, so you create an app password.

- [ ] **1.1** Sign in to the project Gmail account and turn on 2-step verification (Google Account, Security, 2-Step Verification). Skip this if it is already on.
- [ ] **1.2** Go to `https://myaccount.google.com/apppasswords`, name the password `study-share`, and create it.
  - **You should see:** a 16-character password shown once.
  - **If it looks different:** if the page says app passwords are not available, 2-step verification is not fully on (step 1.1), or the account is a managed work or school account. Use a normal personal Gmail account for this project.
- [ ] **1.3** Copy the password into your private notes as `<app password>`. You will paste it into Supabase twice (dev and production) and into your `.env.local` files as `SMTP_PASSWORD`. Google will not show it again, but you can always create a new one.

---

## Part 2: Supabase dev settings

*Already done: skip unless you are starting from scratch. Part 0 changes the templates (2.5), the code settings and one rate limit (2.4).*

**[DEV]** Open the dev project in the Supabase dashboard. Do these in this order, with SMTP first, because every later step that sends an email would otherwise hit the built-in limit (a couple of emails an hour).

### 2.1 Custom SMTP (Gmail)

- [ ] **2.1.1** Go to Authentication, then Emails, then the **SMTP Settings** tab (older dashboards: Authentication, SMTP). Turn on **Enable custom SMTP**.
- [ ] **2.1.2** Fill in:
  - Sender email: `<project Gmail address>`
  - Sender name: `study-share`
  - Host: `smtp.gmail.com`
  - Port: `465`
  - Username: `<project Gmail address>`
  - Password: `<app password>`
- [ ] **2.1.3** Leave "Minimum interval per user" at its default (about a minute). Save.
  - **You should see:** a "saved" message, and the settings stay filled in after you reload the page (the password shows as dots).
  - **If it looks different:** if saving fails with an authentication error, the app password was copied wrongly. Create a new one (Part 1) and paste it again with no spaces.

### 2.2 Email sign-in

- [ ] **2.2.1** Go to Authentication, then Sign In / Providers, then **Email** (older dashboards: Authentication, Providers, Email).
- [ ] **2.2.2** Make sure the Email provider is **enabled**, **Confirm email is ON**, and **Minimum password length is 8**. Save.
- [ ] **2.2.3** Set **Email OTP Length** to 6 and **Email OTP Expiration** to 600 (Part 0, step 0.3), and check "require current password when updating" (Part 0, step 0.5).
  - **You should see:** the settings keep their values after you reload.
  - **If it looks different:** the password length field can live under Authentication, Sign In / Providers, in a section above the provider list. Look for "Password" or "Minimum password length".

### 2.3 URL configuration

Site URL is **one value per Supabase project**. Emails no longer contain any link, so it matters less than before, but Supabase still wants a sensible value, and Google sign-in comes back to an address that must be on the Redirect URLs list. During acceptance, the dev project's Site URL is the branch preview address, so everything the dev project does points at the preview.

- [ ] **2.3.1** Go to Authentication, then URL Configuration.
- [ ] **2.3.2** Set **Site URL** to `<dev alias>` (the address given in the table at the top).
- [ ] **2.3.3** Under **Redirect URLs**, add these three, each on its own line (the `/**` at the end matters). They are used for **Continue with Google** only: after Google, the person returns to the page `/auth/callback` on the site, and Supabase only allows addresses on this list.
  - `<dev alias>/**`
  - `http://localhost:3000/**`
  - `https://study-share-*-<your-vercel-team-slug>.vercel.app/**` (covers other preview addresses of your team)
- [ ] **2.3.4** Save.
  - **You should see:** Site URL and all three redirect URLs listed.
  - **If it looks different:** the preview pattern is optional for acceptance. If Supabase rejects the `*`, leave that line out and add only the first two.

### 2.4 Rate limits

Every sign-up and log-in reaches Supabase from Vercel's servers, not from the person's phone. Supabase may therefore count the whole class as one visitor and block them together. Raise the per-IP limits so the class fits, but keep the code-check limit modest (reason in Part 0, step 0.4).

- [ ] **2.4.1** Go to Authentication, then Rate Limits.
- [ ] **2.4.2** Set **Rate limit for sending emails** (per hour) to a value that Gmail can sustain but that still fits the class on launch day. A starting point is **60**. A normal Gmail account sends roughly 500 emails a day, so do not go much higher than the class really needs.
- [ ] **2.4.3** Raise the per-IP limits, for example to **500** each: **sign-ups and sign-ins** and **token refreshes**. Set **token verifications** to **100** (not 500: see Part 0, step 0.4). Save.
  - **You should see:** the new numbers saved.
  - **If it looks different:** if the email limit field is greyed out, custom SMTP (step 2.1) is not on yet.

The app adds its own limits on top (one email a minute per address, hourly caps per address and per network address, and 5 wrong codes per 15 minutes per address). If Supabase still refuses an email, the person is told "We couldn't send the email right now."

### 2.5 Email templates (replaced by Part 0)

The first version of this guide used templates with a link to the site. **Those templates are wrong now and must not be used**: the app has no confirmation-link page any more, so an old link would lead nowhere. The two templates are now code-only. Use Part 0, step 0.1 (**Confirm signup**) and step 0.2 (**Reset password**). If you are starting from scratch, do those two steps here and carry on.

### 2.6 Google provider (done in Part 3)

You will turn on Google for this project in Part 3, once you have a client id and secret.

---

## Part 3: Google sign-in

*Already done: skip unless you are starting from scratch.*

**[GOOGLE]** "Continue with Google" needs a Google Cloud project with an OAuth client. Use the project Gmail account.

### 3.1 Project and consent screen

- [ ] **3.1.1** Go to `https://console.cloud.google.com`, create a new project (name it `study-share`) and select it.
- [ ] **3.1.2** Open **Google Auth Platform** (older console: APIs & Services, OAuth consent screen) and start the setup. Fill in the app name (`study-share`), the user support email (`<project Gmail address>`) and the developer contact email (`<project Gmail address>`).
- [ ] **3.1.3** For audience / user type choose **External**.
- [ ] **3.1.4** Under **Data Access** (older console: Scopes) add only these three scopes: `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile`. They appear as `openid`, `email` and `profile`. Add no others.
- [ ] **3.1.5** Under **Audience** (older console: the first consent screen page), set the publishing status to **In production** (the button is "Publish app"). Do not leave it on "Testing".
  - **You should see:** publishing status **In production**. Because only the basic sign-in scopes are used, Google does not ask you for a review.
  - **If it looks different:** if the status says "Testing", only up to 100 named test users can sign in and everyone else sees "Access blocked". Publish it. If Google asks for verification, check that you added no scope beyond the three.

### 3.2 The OAuth client

- [ ] **3.2.1** Go to Google Auth Platform, **Clients** (older console: APIs & Services, Credentials, Create credentials, OAuth client ID). Create a client of type **Web application**, named `study-share`.
- [ ] **3.2.2** Under **Authorised redirect URIs** add both of these (one client can serve both projects):
  - `https://<your-dev-project-ref>.supabase.co/auth/v1/callback`
  - `https://<your-prod-project-ref>.supabase.co/auth/v1/callback`

  Supabase shows the exact address on its Google provider page (step 3.3.2). Compare it with what you typed. Leave "Authorised JavaScript origins" empty.
- [ ] **3.2.3** Create the client and copy the **client id** and **client secret** into your private notes.
  - **You should see:** the client listed, with both redirect URIs.
  - **If it looks different:** if you cannot find the secret later, create a new secret on the client's page.

### 3.3 Paste the client into Supabase (dev and production)

- [ ] **3.3.1** **[DEV]** Go to Authentication, then Sign In / Providers, then **Google**. Turn it on.
- [ ] **3.3.2** Paste the client id and client secret. Check that the **Callback URL (for OAuth)** shown on this page is exactly the redirect URI you added in step 3.2.2. Save.
- [ ] **3.3.3** **[PROD]** Do the same in the production project: Authentication, Sign In / Providers, Google, on, paste the same client id and secret, save.
  - **You should see:** Google shown as enabled in both projects.
  - **If it looks different:** a mismatch between Supabase's Callback URL and Google's redirect URI is the most common cause of a failed Google sign-in. They must be identical, letter for letter.
- [ ] **3.3.4** In both projects, leave "Allow manual linking" and "Automatically link accounts with same verified email" at their defaults. The behaviour we rely on is: if someone signs in with Google using an address that already has a confirmed password account, they land in that same account. Part 8 checks this.

The app asks Google to show the **account chooser** every time (so a phone with several Google accounts never silently picks one). That needs no setting here.

---

## Part 4: Supabase production settings

*Already done: skip unless you are starting from scratch. Part 0 covers what changed here.*

**[PROD]** Open the production project and repeat the same settings as Part 2. The differences are marked.

- [ ] **4.1** Authentication, Emails, SMTP Settings: the same Gmail settings as step 2.1.
- [ ] **4.2** Authentication, Sign In / Providers, Email: enabled, **Confirm email ON**, minimum password length 8 (step 2.2), **Email OTP Length 6 and Email OTP Expiration 600** (Part 0, step 0.3), and the same "require current password when updating" as dev (Part 0, step 0.5).
- [ ] **4.3** Authentication, URL Configuration:
  - **Site URL:** `<live address>`.
  - **Redirect URLs (Google sign-in only):** `<live address>/**`, `http://localhost:3000/**` and `https://study-share-*-<your-vercel-team-slug>.vercel.app/**`.
- [ ] **4.4** Authentication, Rate Limits: the same as step 2.4 (token verifications **100**).
- [ ] **4.5** Authentication, Emails, Templates: the **Confirm signup** and **Reset password** templates from Part 0, steps 0.1 and 0.2 (code only).
- [ ] **4.6** Google provider: already done in step 3.3.3.
  - **You should see:** the same results as in Part 2, with `<live address>` as the Site URL.
  - **If it looks different:** see the "If it looks different" hints in Part 2. The usual slip is leaving the dev alias as the production Site URL.

---

## Part 5: Database migrations

*Already done (dev and production): skip unless you are starting from scratch.*

The app needs the `profiles` and `rate_limits` tables, a trigger that creates a profile for each new user, and a later fix to that trigger. They come from migrations 0001 to 0003 (0000 creates the first table). Without them, sign-up fails.

### 5.1 Dev

- [ ] **5.1.1** **[TERMINAL]** Run:

```bash
npm run db:migrate
```

This uses `DATABASE_MIGRATION_URL` from `.env.local`, which must point at the **dev** project.

  - **You should see:** the command ends without an error. In the dev project's Table Editor (public schema) there are `profiles` and `rate_limits` tables.
  - **If it looks different:** an error about a connection means `DATABASE_MIGRATION_URL` is wrong or missing. Use the session pooler or direct connection string, not the transaction pooler.

### 5.2 Production

Migrations 0001 to 0003 **must be applied to production before anything is merged to `main`**: without them production has no `profiles` or `rate_limits` tables and sign-up breaks. They have been applied.

- [ ] **5.2.1** Create the file of production settings, **outside the project folder**. This file holds the production service-role key, the database address and the email password. The project folder is inside OneDrive, which copies its files to the cloud, and Next.js loads a `.env.production.local` that sits in the project folder automatically for `npm run build` and `npm run start`, so a local build or start would quietly use production settings. So:
  - **Recommended: keep it outside OneDrive.**
    1. In File Explorer, open `C:\Users\<you>\` (your user folder, where Desktop, Documents and Downloads live) and create a new folder directly inside it, for example `study-share-secrets`. Do **not** use Desktop, Documents, Downloads or Pictures: OneDrive normally syncs those, and so does the project folder itself (it is inside OneDrive\Desktop).
    2. In Explorer, turn on file name extensions: View, Show, **File name extensions**. Otherwise Windows hides a `.txt` ending and you cannot see it.
    3. Open Notepad, paste the settings (see "What goes in the file" below), then File, Save as. Choose the new folder, set **Save as type** to **All files**, and type the file name exactly `.env.production.local`. Save.
    4. Check in Explorer that the file is called `.env.production.local` and not `.env.production.local.txt`. If it ends in `.txt`, rename it and remove the `.txt`.
    5. Get its full path: hold Shift, right-click the file, choose **Copy as path**. The path is copied with quotes around it, for example `"C:\Users\<you>\study-share-secrets\.env.production.local"`.
    6. In the commands below, replace the **whole** `<production env file>` token with that full path, including the file name, and keep exactly **one** pair of quotes around it. The commands already show `--env-file="<production env file>"`, so if you paste the path with its own quotes, delete the extra pair: you want `--env-file="C:\Users\<you>\study-share-secrets\.env.production.local"`, never two pairs of quotes.
  - **Fallback only: in the project folder.** You can instead create `.env.production.local` in the project folder. It is still not committed, but OneDrive syncs it to the cloud, and you must not run `npm run build` or `npm run start` on your computer while it is there. In that case write `.env.production.local` in place of `<production env file>` in the commands below, keeping the quotes.

  **What goes in the file.** All the production settings, copied from the list in `.env.example`: `APP_ENV=production`; `DATABASE_URL` and `DATABASE_MIGRATION_URL`; `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`; the `STORAGE_*` settings; the `SMTP_*` settings; and **`NEXT_PUBLIC_SITE_URL`** set to `<live address>`. Every value points at the **production** project. Put each setting on its own line as `NAME=value`, with no spaces around `=` and no quotes around the value. `NEXT_PUBLIC_SITE_URL` is needed because production settings require it: without it, `check:services` on production fails and the app refuses to start. Nothing about the registration change adds a setting to this file.

- [ ] **5.2.2** **[TERMINAL]** Run, using only the production file:

```bash
node --env-file="<production env file>" ./node_modules/drizzle-kit/bin.cjs migrate
```

  - **You should see:** the command ends without an error. In the production project's Table Editor (public schema) there are `profiles` and `rate_limits` tables.
  - **If it looks different:** if it says a file cannot be found, check the full path in quotes (one pair only), check that the file name does not secretly end in `.txt` (step 5.2.1, point 4), and run the command from the project folder (the migrate script is looked up there). If the run is reported as nothing to apply, the migrations were already applied. If it fails to connect, check `DATABASE_MIGRATION_URL` in the production file.

---

## Part 6: Vercel (still open)

**[VERCEL]** Open the project's Settings, then Environment Variables.

- [ ] **6.1** Add **`NEXT_PUBLIC_SITE_URL`** with the value `<live address>`, and tick **Production only**. Untick Preview and Development. Previews must use their own branch address, so this setting stays unset for Preview. Production requires it: without it the production app refuses to start.
  - **You should see:** the variable listed with only "Production" beside it.
  - **If it looks different:** if you created it with "All Environments", edit it and untick the others. A production address in Preview can send preview users to the live site.
- [ ] **6.2** Check that the other variables from `.env.example` exist for the right environments, and add any that are missing: `APP_ENV` (`production` for Production, `dev` for Preview), `DATABASE_URL`, `DATABASE_MIGRATION_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, the `STORAGE_*` settings, and `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` (and `SMTP_FROM` only if you need it). Production values point at the production Supabase project, Preview values at the dev project. Do not set `SERVICES_MODE` on Vercel: the app refuses `fake` there, and the default is `real`.
- [ ] **6.3** Redeploy so the new values are used. Go to Deployments, open the menu on the latest Production deployment, choose **Redeploy**, and untick "Use existing build cache" (some settings are baked in when the site is built).
- [ ] **6.4** Open `<live address>/api/health`.
  - **You should see:** `{"status":"ok","db":"ok"}`.
  - **If it looks different:** a 503 with `{"status":"degraded","db":"error"}` means a setting is missing or wrong. Open the deployment's logs in Vercel for the reason. The usual cause is a missing `NEXT_PUBLIC_SITE_URL` (see Troubleshooting).

Vercel applies a changed variable only to deployments made afterwards. If you added or fixed a Preview variable, **redeploy the latest Preview deployment too (or push a commit) before you start Part 8**, otherwise you would be testing the old settings. The stable address `<dev alias>` always points at the latest build of the `feature/phase-1a-accounts` branch.

---

## Part 7: Checks from your computer

These commands test the real services from your terminal. They never print passwords, keys, codes or full email addresses. Run them after Part 0, because the second one also shows the length of the codes your dev project issues.

### 7.1 Dev: both checks

**[TERMINAL]** Your `.env.local` must point at the **dev** project, and `SMTP_USER` must be the project Gmail address.

- [ ] **7.1.1** Run:

```bash
npm run check:services
```

  This checks four things: the database (a simple ping), file storage (uploads, reads, downloads through a signed link, and deletes a small test file), email (it logs in to the Gmail SMTP server without sending anything) and auth (it creates one throwaway confirmed user, signs in, reads the user, signs out, and deletes the user).
  - **You should see:** four lines: `PASS  database`, `PASS  file storage`, `PASS  email (SMTP login)`, `PASS  auth`.
  - **If it looks different:** a `FAIL` line names the check and the error name and message. `FAIL environment` lists missing settings in `.env.local`. For `email`, check `SMTP_USER` and `SMTP_PASSWORD` (the app password).

- [ ] **7.1.2** Run:

```bash
npm run check:auth-behaviour
```

  This asks the real Supabase Auth how it behaves in the cases the app relies on (codes, passwords, sessions) and prints labelled `FACT` lines. **It creates and deletes test users, sends up to about a dozen real emails, but only to plus-addresses of the project Gmail (nobody else gets email), waits about a minute at several points (expect it to take several minutes), and refuses to run against production settings.** Run it on dev only, and let it finish: if you press Ctrl-C it stops and deletes its test users first.
  - **You should see:** a list of `FACT` lines, no line saying `PROBE FAILED`, and at the end `Clean-up: ... test user(s) deleted, 0 left.` Find the two lines that start `(i) signup code shape` and `(i) recovery code shape`: both must end with **6 characters, digits only**. If they say 8 characters, Part 0 step 0.3 was not saved on the dev project.
  - **If it looks different:** a `PROBE FAILED` line names the probe: tell the developer and send them the printed lines (they contain no secrets). If a line says `WARN  test user ... was not deleted`, delete that user in Authentication, Users. If it says it refuses production settings, your `.env.local` points at production: fix it.

**`npm run check:auth-behaviour` must NEVER be pointed at production.** It creates and deletes users and would refuse, but do not try.

### 7.2 Production: `check:services` only

`check:services` is safe on production, but it creates and deletes one throwaway confirmed user and one small test file.

- [ ] **7.2.1** **[TERMINAL]** Run, loading only the production file (use the same full path as in step 5.2.1; `npm run check:services` would load `.env.local`, which is the dev project):

```bash
npx tsx --conditions=react-server --env-file="<production env file>" scripts/check-services.ts
```

  - **You should see:** the same four `PASS` lines.
  - **If it looks different:** `FAIL environment ... NEXT_PUBLIC_SITE_URL` means the production file is missing that setting (step 5.2.1). `FAIL database` right after a fresh project usually means a wrong connection string.

---

## Part 8: Live acceptance on a phone and a desktop

Test on the dev preview first (`<dev alias>`), then on the live site after the merge. Use a **real phone** and a **desktop browser**, and addresses you own and can read in a real inbox (Gmail is fine; an Outlook address is a good extra). Do not use made-up addresses.

**Before you begin:** Part 0 is done in the dev project (templates, OTP length 6, expiration 600), Part 6 is done and the latest Preview deployment is redeployed, and Part 7 passed. For tests 1 to 8 you need: one address that has no account yet (a fresh `you+test1@gmail.com`-style address works with Gmail, and each plus-address counts as its own address), a Google account that has never been used on the site, and a second inbox for test 6 if you have one.

**What the screens are called.** You will meet these, in this order for a new sign-up: **Create your account** (`/signup`), **Enter the code** (`/signup/verify`), and, only when you enter the code on a different device from the one you signed up on, **Create your password** and then **One last step** (the Terms). Forgot password: **Reset your password**, **Enter the code**, **Create a new password**.

**Who does what.** Tests 1 to 8 are yours ([PHONE]). The four "live verifications" at the end are the controller's ([CONTROLLER]); the controller reports the result to you.

Waiting rules to keep in mind: you can only get one email per address about once a minute (the **Resend code** button shows a countdown), and wrong codes are limited to 5 per 15 minutes per address. If a step says to wait, wait.

### 8.1 Sign up by email and enter the code (test 1)

- [ ] **8.1.1** On the **phone**, open `<dev alias>/signup`. Enter a name, a new email address you own, and a password of at least 8 characters. Tick the box (18 or older, Terms and Privacy Notice). Tap **Create account**.
  - **You should see:** a page **Enter the code** with a large box for the code, a **Verify** button, a **Resend code in 0:xx** countdown and **Change email**.
  - **If it looks different:** an error about the address, see test 4. "We couldn't send the email right now" means the email settings (Part 0, step 0.6) or a limit (Troubleshooting).
- [ ] **8.1.2** Open the email on the same phone. Look at it.
  - **You should see:** the subject **Your study-share code**, a big **6-digit** number, the words "This code expires in 10 minutes", and **no link anywhere**.
  - **If it looks different:** a link in the email means the old template is still saved (Part 0, step 0.1). A code with 8 digits means the OTP length is still 8 (Part 0, step 0.3). Check the spam folder if nothing arrives (wait the minute first).
- [ ] **8.1.3** Go back to the site and type the code (or tap the code suggestion your phone's keyboard shows above it), then tap **Verify**.
  - **You should see:** you land on the home page, signed in (your name appears in the account menu).
  - **If it looks different:** see Troubleshooting for "That code is wrong or has expired".

### 8.2 Sign up on one device, enter the code on another (test 2)

- [ ] **8.2.1** On the **desktop**, open `<dev alias>/signup` and sign up with another new address you own: name **Test Person**, a password you write down. Stop on the **Enter the code** page.
- [ ] **8.2.2** On the **phone**, open `<dev alias>/signup/verify`. This page now asks for the **email address** as well as the code. Type the address you used, then the code from the email, then tap **Verify**.
  - **You should see:** the page **Create your password** ("Your email is confirmed. Choose a password to finish signing up"). Choose a new password (it can be the same as before or different) and tap **Save password**.
  - **If it looks different:** if it goes straight to the home page, the phone's browser had a leftover sign-up for that address (use a private tab). If it says "That code is wrong or has expired", see test 3.
- [ ] **8.2.3** Next you should see **One last step**: the Terms page with the 18-or-older and Terms tick box. Tick it and continue.
  - **You should see:** the home page, signed in. Open `/account`: the **display name is the part of the email before the @**, not "Test Person". This is on purpose: someone else's name or Terms acceptance from another device is not trusted, so the person finishing on the second device accepts the Terms themselves.
  - **If it looks different:** if your typed name shows instead, tell the developer: the foreign-code path did not run.
- [ ] **8.2.4** On the **desktop**, go back to the old **Enter the code** tab and type the **same code** there too, then tap **Verify**.
  - **You should see:** "That code is wrong or has expired. Request a new one." A code works only once, so you are not signed in on the desktop.
- [ ] **8.2.5** Log out on the phone, then log in on the phone with the new password.
  - **You should see:** you are signed in. The password the desktop sign-up used must **not** work any more if you chose a different one in step 8.2.2: try it on the log-in page and see "That email and password do not match."

### 8.3 Wrong code, expired code, Resend (test 3)

Use a new address and start a sign-up so you are on **Enter the code**.

- [ ] **8.3.1** **Wrong code.** Type six digits that are not the code (for example `000000`) and tap **Verify**.
  - **You should see:** exactly one message: **"That code is wrong or has expired. Request a new one."** Your own address stays shown. The message is the same whether the code was wrong, old or used.
  - **If it looks different:** a message "Enter the 6-digit code from the email" means you typed fewer or more than 6 digits.
- [ ] **8.3.2** **Resend.** Wait for the countdown to reach zero (about a minute), then tap **Resend code**.
  - **You should see:** a message that a new code was sent, and the countdown starts again. Before the countdown ends, the button is greyed out. A second email arrives with a **different** code.
- [ ] **8.3.3** **Superseded code.** Type the code from the **first** email (the one before Resend) and tap **Verify**.
  - **You should see:** the same "That code is wrong or has expired. Request a new one." Only the newest code works.
- [ ] **8.3.4** **Expired code.** Request one more code if needed, **do not use it**, and wait **11 minutes**. Then type it.
  - **You should see:** the same message again. Then tap **Resend code**, use the new code, and you are in.
  - **If it looks different:** if a code still works after 11 minutes, the expiration is not 600 (Part 0, step 0.3).
- [ ] **8.3.5** **Locked after too many wrong tries.** Only if you want to test it: on a spare address, type wrong codes until the message changes to **"Too many wrong codes. Try again in 15 minutes."** (5 tries). The right code is also refused until the 15 minutes have passed. Leave this test for last.

### 8.4 An email that already has an account (test 4)

- [ ] **8.4.1** Log out. Open `/signup` and sign up with the address from test 1 (it already has a confirmed account), with any name and password.
  - **You should see:** a clear message: **"This email already has an account. Log in or reset your password."** No email is sent, and the existing account is untouched.
- [ ] **8.4.2** Try to log in with that address and a **wrong** password.
  - **You should see:** the one generic message "That email and password do not match." (log-in never says whether the address exists).
- [ ] **8.4.3** Log in with the right password to check the account still works.

### 8.5 Continue with Google (test 5)

- [ ] **8.5.1** On the **phone**, log out, open `/signup` (or `/login`) and tap **Continue with Google**. Under the buttons you should see "By continuing you confirm you are 18 or older and accept the Terms and Privacy Notice".
  - **You should see:** Google shows an **account chooser** ("Choose an account"), even if the phone is signed in to only one Google account. Choose the Google account that has never used the site and confirm.
  - **If it looks different:** "Access blocked" or an error page from Google: see Troubleshooting. If Google signs you in without showing the chooser, tell the developer.
- [ ] **8.5.2** After Google.
  - **You should see:** the home page, signed in, with no **One last step** page (the sentence under the button counts as accepting the Terms).
- [ ] **8.5.3** Log out. **Continue with Google** again with the Google account whose address matches the **confirmed password account from test 1**.
  - **You should see:** you land in that same account (same name), not a second one.
- [ ] **8.5.4** If you can, open the site's address inside an **Instagram or Facebook in-app browser** (send it to yourself in a message and tap it there).
  - **You should see:** an **"Open in your browser"** notice with a copy-link button, instead of a Google error.

### 8.6 An email registered through Google (test 6)

- [ ] **8.6.1** Log out. Open `/signup` and sign up **by email** with the address of the Google account from step 8.5.1 (the one that has no password).
  - **You should see:** **"This email is registered with Google. Continue with Google, or reset your password to add one."** No email is sent.
- [ ] **8.6.2** Open `/login`.
  - **You should see:** the hint "Signed up with Google? Use Continue with Google."

### 8.7 Forgot password by code (test 7)

- [ ] **8.7.1** Before you start, be signed in to the test 1 account on **two devices** (log in on the desktop and on the phone with the password). Then open `/forgot-password` in a **private tab on the phone** and enter the test 1 address.
  - **You should see:** **"If an account exists for that email, we sent a code."** and the **Enter the code** page.
- [ ] **8.7.2** Open the email (subject **Your study-share code**, "Use this code to reset your password", 6 digits, **no link**), type the code and continue.
  - **You should see:** the page **Create a new password**. Choose a new password (at least 8 characters, two boxes that must match) and tap **Save password**.
- [ ] **8.7.3** After saving.
  - **You should see:** the home page with **"Password updated"**, and you are signed in on the phone.
- [ ] **8.7.4** Try the **old** password on the log-in page, then the new one.
  - **You should see:** the old one fails with "That email and password do not match", the new one works.
- [ ] **8.7.5** On the **desktop**, which was signed in before, reload a page.
  - **You should see:** the desktop is signed out (you land on the log-in page or the pitch). **It can take up to an hour to show**, because a signed-in browser carries a pass that stays valid for up to an hour; the server has already refused to renew it. If the desktop still looks signed in, come back after an hour and reload: it must be signed out then. Tell the developer if it is not.
- [ ] **8.7.6** Check that a used code is dead: open `/forgot-password` again in a private tab, enter the address, and when the code page appears type the **previous** (already used) code.
  - **You should see:** "That code is wrong or has expired. Request a new one." Then close the tab without finishing.

### 8.8 The pre-registration checks (test 8)

This is the test that proves a stranger cannot pre-register your address and keep access. You need an address you own that has no account, and two browsers (or one normal and one private window).

**8.8.A Newest sign-up wins.**

- [ ] **8.8.A.1** In browser 1, sign up with address A and password **P1** (a password you write down as "P1"). Stop on **Enter the code**. Do not enter the code. An email arrives.
- [ ] **8.8.A.2** In browser 2 (or a private window), sign up again with address A and a different password **P2**. A second email arrives (wait a minute between the two sign-ups if you see "We just sent you an email. Please wait a minute").
- [ ] **8.8.A.3** Use the code from the **latest** email (the second one) in browser 2 and tap **Verify**.
  - **You should see:** you are signed in. (The first email's code no longer works: try it in browser 1 to see the one standard "wrong or expired" message.)
- [ ] **8.8.A.4** Log out. Try to log in with address A and **P1**.
  - **You should see:** "That email and password do not match."
- [ ] **8.8.A.5** Log in with address A and **P2**.
  - **You should see:** you are in. **Only P2 works.**

**8.8.B A code that confirms an account this browser did not create.** This is test 2 above (8.2.2 and 8.2.3): you must have been asked to create a password and then to accept the Terms. Tick it off if you did that.

**8.8.C Forgot password on an address with someone else's unconfirmed sign-up.**

- [ ] **8.8.C.1** In browser 1, sign up with a new address B and password **P1**, name "Stranger". Stop on **Enter the code** (never enter it).
- [ ] **8.8.C.2** In browser 2, open `/forgot-password`, enter address B, get the code from the email, type it, and **stop** when you reach **Create a new password**. Do not choose a password. Close the tab.
- [ ] **8.8.C.3** In browser 1 (or any), try to log in with address B and password **P1**.
  - **You should see:** "That email and password do not match." The stranger's password does **not** work.
- [ ] **8.8.C.4** Go back and use Forgot password again for address B, finish with a new password.
  - **You should see:** the home page, signed in, with the name set to the part of the address before the @ (not "Stranger"), possibly after the **One last step** page to accept the Terms.

### 8.9 The rest of the account

- [ ] **8.9.1** Log out and back in with email and password.
- [ ] **8.9.2** Open `/account` and change the display name. Reload to check it stuck.
- [ ] **8.9.3** Open `/terms` and `/privacy`.
- [ ] **8.9.4** On the phone, add the site to the home screen (browser menu, "Add to Home screen" or "Install") and open it from there.
  - **You should see:** it opens as its own app window with the icon, and you are still signed in.
- [ ] **8.9.5** Open the code screen on the phone and check the keypad: it should be a **number keypad**, and the field should not make the page zoom.

### 8.10 The controller's live verifications ([CONTROLLER])

These cannot be seen from the site, so the developer or controller does them and reports the results. You do not need to do anything, but you should not consider the work finished until they are reported.

| | What is checked | Why |
|---|---|---|
| (a) | That the "nulls" the app writes to clear the Terms acceptance in Supabase's user metadata really remove those keys (read the user back in the dashboard or by a script) | The app clears a stranger's Terms acceptance when a code confirms an account from another device. It is only unit-tested so far |
| (b) | What real Google sign-in does to a pre-registered, still unconfirmed email sign-up: whether Supabase marks the email identity verified or confirms the user when Google links | The Google repair (removing a stranger's password and name) assumes the pending email identity stays unconfirmed when Google links. If Supabase marks it verified, the repair never triggers. This needs a real Google account |
| (c) | That the app's database role (the `DATABASE_URL` login) can update `profiles` under row-level security, as the migration role can | The app records Terms acceptance in the `profiles` row. It was tested with the migration role |
| (d) | How the email provider's per-address interval behaves on a real phone, for example a Resend at exactly 60 seconds, and Forgot password shortly after a sign-up from another device | Supabase refuses a second email to one address within about a minute; the app's own countdown is meant to decide first |

### 8.11 After the merge

- [ ] **8.11.1** Repeat tests 1, 2, 5 and 7 (sign-up with a code, code on a second device, Google, Forgot password) on `<live address>` (production project), on a real phone and a desktop. Also check the code email there shows 6 digits and no link.
- [ ] **8.11.2** Open `<live address>/api/health` once more and see `{"status":"ok","db":"ok"}`.

---

## Part 9: The merge gate

The first merge to `main` happens only when **all** of these are true:

- [ ] **Both** Supabase projects (dev and production) have the new **Confirm signup** and **Reset password** code templates (Part 0, steps 0.1 and 0.2).
- [ ] **Both** projects have **Email OTP Length 6** and **Email OTP Expiration 600** (step 0.3).
- [ ] **Both** projects have Confirm email ON, minimum password length 8 and Gmail SMTP working (steps 0.6, 2.1, 2.2, 4.1, 4.2).
- [ ] **Both** projects have the raised rate limits **and** the lowered token-verification limit (steps 0.4, 2.4, 4.4), and "require current password when updating" matches dev (step 0.5).
- [ ] Redirect URLs for Google sign-in are set in both projects (steps 2.3 and 4.3), and the Google consent screen is **published** ("In production", step 3.1.5).
- [ ] `NEXT_PUBLIC_SITE_URL` is set in Vercel for **Production only** (step 6.1), and the production deployment has been redeployed.
- [ ] Migrations 0001 to 0003 are applied to **production** (step 5.2). Done.
- [ ] The contact address is filled in (done: it is set to the project mailbox in `src/shared/legal.ts` and shown publicly on the Privacy and Terms pages).
- [ ] The checks in Part 7 passed: `npm run check:services` and `npm run check:auth-behaviour` on dev, and the `check-services.ts` command on production.
- [ ] The controller's live verifications (Part 8.10) are reported.
- [ ] The live acceptance in Part 8 (tests 1 to 8) passed on the **preview**, then (8.11) on **production**, on a real phone and a desktop.
- [ ] **You have said clearly that you approve the merge.**

Then the developer opens the pull request, CI runs, and you approve the merge. After the merge, do 8.11.

### Site URL after the merge

Site URL is one value per Supabase project. After the merge, the **production** project keeps `<live address>`. The **dev** project can keep the branch alias (useful if you still want to test from previews) or go back to `http://localhost:3000` (right for local-only testing). Emails no longer contain addresses, so this only affects where Supabase sends people by default and which addresses Google sign-in may return to.

---

## Part 10: Operations from the pilot on

- [ ] **Sweep unconfirmed users every week.** Someone can sign up with another person's address and never confirm. That account can no longer give anyone access (the newest sign-up replaces it, and a code only works from the mailbox), but it still sits in the list. Delete users who are still unconfirmed after 7 days. In the Supabase dashboard open Authentication, Users and look for users without a confirmed email, or use the SQL editor. First look:

```sql
select id, created_at from auth.users
where email_confirmed_at is null and created_at < now() - interval '7 days';
```

  Then, if the list looks right, delete them in the dashboard, or with the same condition:

```sql
delete from auth.users
where email_confirmed_at is null and created_at < now() - interval '7 days';
```

  Do this in the production project (and dev if you like). It is a manual task during the pilot; automating it is not part of this work.
- [ ] **Watch the logs for the email-limit line.** In Vercel open the project, then Logs, and search for `Auth provider refused to send an email (rate limited)`. If it appears, people were told "We couldn't send the email right now." Raise the email-per-hour limit (step 2.4.2), or wait for the hourly window to pass. If it appears often, tell the developer.
- [ ] **Watch Gmail's daily limit.** A normal Gmail account sends roughly 500 emails a day. Every sign-up, resend and reset is one email.

---

## Known risks you accept for the pilot

In plain words, these are the things that are not fully closed and that you have chosen to live with for now.

1. **Sign-up tells people whether an email is registered.** The sign-up page says "This email already has an account". That is your choice, because it is much clearer for real people. It means someone can check whether an address is registered. Log-in and Forgot password do not say.
2. **Codes can be guessed directly against Supabase, limited only by its rate limit.** The app allows 5 wrong codes per 15 minutes per address. But anyone who knows the project's public address can send code guesses straight to Supabase, skipping the app. A 6-digit code has a million possibilities. The protection is the token-verification rate limit you lowered (Part 0, step 0.4): from one network address that allows only a few hundred guesses during a code's 10-minute life, about 1 chance in several thousand, and the attacker needs the address and a fresh code request. Someone using many network addresses could try more. If this ever worries you, the later option is longer codes (this needs a code change as well as the Supabase setting).
3. **A person who confirms from another device loses the name they typed and accepts the Terms again.** This is by design: if someone else could have typed that name and ticked those boxes, they are not trusted. The display name becomes the part of the email before the @, and the person ticks the Terms on **One last step**. It happens even when it was really the same person using two devices.
4. **A phone that is still signed in from a code can be used to change the password.** The page "Create a new password" works for anyone signed in from a sign-up code or a reset code (not for someone signed in with a password). So a person holding someone's **unlocked** phone that is signed in that way could change the password and sign out the owner's other devices. The real owner can recover through the mailbox with Forgot password. Logging out, or logging in again with the password, ends the risk on that phone.
5. **Google and an earlier stranger's sign-up.** If a stranger signed up with someone's address and a password, and the real owner then uses Continue with Google, the app removes the stranger's password and name and replaces the Terms record with the Google person's own, so nothing of the stranger's survives. This relies on a guess about how Supabase handles Google sign-in onto an unconfirmed address; it has not been confirmed with a real Google account yet (the controller's check (b) in Part 8.10). Until it is confirmed, treat this case as not fully proven.
6. **Someone can lock a known address out of entering codes.** The wrong-code limit is per address, so someone typing wrong codes for your address can stop you entering codes for 15 minutes. Google sign-in still works and the lock ends by itself.
7. **Unconfirmed accounts older than 7 days are cleaned up by hand** (Part 10), not automatically.
8. **Other devices can look signed in for up to an hour after a password change or reset.** The server refuses to renew them straight away, but the browser carries a pass that stays valid until it runs out (up to an hour).
9. **Timing and "couldn't send" hints.** The response-time difference on Forgot password and the "We couldn't send the email" message can hint that an address exists. These were accepted in the first design (see the Phase 1 design's known risks).

---

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| The code email never arrives | It went to spam; the address was mistyped; Gmail refused the login (SMTP broken); the hourly or daily email limit is used up; Supabase only sends about one email a minute to one address | Wait a minute and check spam. Tap **Change email** if the address is wrong. Check Authentication, Emails, SMTP Settings is on and saved (step 2.1) and the hourly limit (step 2.4.2). Then tap **Resend code** after the countdown. An address that already has an account gets no sign-up email at all (use Log in or Forgot password) |
| "We couldn't send the email right now" | Supabase refused to send: the hourly email quota is used up, the dev project is still on its built-in sender (a couple of emails an hour), the per-address interval of about a minute, or Gmail rejected the login | Check custom SMTP is on (step 2.1), the app password is current, and the hourly limit (step 2.4.2). Look for the log line in Part 10. Wait a few minutes. The code screen still lets you enter a code you already have |
| "We just sent you an email. Please wait a minute before trying again." | The app's own one-email-a-minute limit per address, working as intended | Wait for the countdown, then try again |
| "Too many attempts. Please try again later." | The app's hourly limits (for sign-up 5 an hour per address, for resend and for Forgot password 3 an hour per address) or the per-network limits | Wait an hour, or use the address with a code you already have |
| "That code is wrong or has expired. Request a new one." | The code was mistyped, already used, replaced by a newer one (every Resend makes the older code useless) or older than 10 minutes. Supabase gives the same answer for all four | Use the code from the **newest** email only. If unsure, tap **Resend code** and use that one |
| The code has 8 digits and the site says "Enter the 6-digit code from the email" | **Email OTP Length** is still 8 in that Supabase project | Set it to 6 in both projects (Part 0, step 0.3), save, and ask for a new code |
| A code still works after more than 10 minutes, or stops working within a minute or two | **Email OTP Expiration** is not 600 | Set it to 600 (Part 0, step 0.3) |
| The email contains a link, or the link opens a page that does not exist | The old link-style template is still saved in that Supabase project | Replace both templates (Part 0, steps 0.1 and 0.2), then request a new code |
| "Too many wrong codes. Try again in 15 minutes." | 5 wrong tries for that address in 15 minutes (our own limit; asking for new codes does not reset it) | Wait 15 minutes, then use the newest code. Do not keep guessing |
| Many people at once see "Too many attempts" or "We couldn't check the code right now" | The token-verification limit (Part 0, step 0.4) is too low for the number of people registering at the same moment, or Supabase is briefly unavailable | Raise the limit a little (for example 200) and tell the developer. Wait a few minutes for the unavailable case |
| "Create your password" is asked after entering a code | You entered the code on a different device or browser from the one that started the sign-up (or cookies were cleared). This is expected | Choose a password to finish. If you leave first, the account's password stays unknown: use **Forgot password** later |
| After "Create your password" you are asked to accept the Terms (**One last step**) and your name is the part before the @ | Expected after a code from another device (the Terms and name from another sign-up are never trusted) | Accept the Terms. Change your name in `/account` |
| "Your session has ended. Request a new code to continue." | The password page needs the sign-in the code just made, and it is gone (closed tab, waited too long, or a password change in between) | Use **Forgot password** to get a new code |
| "Your email is confirmed. Set a password with Forgot password to log in." | The code confirmed the address but the app could not open a session afterwards (rare) | Use **Forgot password**. Your account is safe in the meantime. If a minute has not passed, the code screen may say it just sent one: wait a minute |
| "To change your password, use Forgot password." | The "Create a new password" page was opened from a normal password log-in, which Supabase does not allow (this is on purpose, Part 0, step 0.5) | Log out and use **Forgot password** |
| Log-in says "Your email is not confirmed yet" | The address signed up but the code was never entered | Tap **Send a new code**, enter it, and create a password |
| Google shows an account chooser every time | Intended: the site always asks which account to use | Choose the account |
| Google says "Access blocked" or "app not verified" | The consent screen is still in **Testing**, or it requests more than `openid`, `email`, `profile` | Publish it (step 3.1.5) and check the scopes (step 3.1.4) |
| Google error `redirect_uri_mismatch` | The redirect URI in Google differs from Supabase's Callback URL | Copy Supabase's Callback URL from its Google provider page into the client's Authorised redirect URIs exactly (step 3.2.2) |
| Google sign-in returns to the login page with "Google sign-in did not finish" or "Something went wrong signing you in with Google" | The site address is missing from Supabase's Redirect URLs, the client id or secret in Supabase is wrong, or the app could not finish tidying a pre-registered account | Check the redirect list (step 2.3.3 or 4.3) and re-paste the client id and secret (step 3.3). Try once more |
| Email sign-up says "This email is registered with Google" | That address only has a Google account | Tap **Continue with Google**, or use Forgot password to add a password |
| Sign-up says "This email already has an account" and you never signed up | Someone else, or you, made it earlier | Log in, or use Forgot password |
| The site address in the browser shows the preview when you test production (or the other way round) | Site URL or the Vercel variable points at the wrong address | Check step 2.3 or 4.3 and Part 6 |
| `/api/health` returns 503 on production after a deploy | A setting is missing or wrong. The most common one is `NEXT_PUBLIC_SITE_URL`, which production requires. Other causes: `APP_ENV` not `production`, or settings pointing at the wrong Supabase project | Add `NEXT_PUBLIC_SITE_URL` for Production (step 6.1), check the other variables (step 6.2), redeploy (step 6.3). The Vercel logs say which setting is at fault |
| `check:services` on production says `NEXT_PUBLIC_SITE_URL` is missing | The production file lacks it | Add the live address to that file (step 5.2.1) |
| Sign-up fails with a database error, or no profile appears | Migrations 0001 to 0003 are not applied to that project | Run the migration for that project (Part 5) |
| Locally, you sign in and are sent back to the login page again and again | An `https` `NEXT_PUBLIC_SITE_URL` while running over `http://localhost`: the cookies are marked secure and the browser drops them | Never set an `https` `NEXT_PUBLIC_SITE_URL` for a local `http` run. Remove it from `.env.local` and restart `npm run dev` |
| `check:auth-behaviour` refuses to run | Your settings are, or point at, production | Point `.env.local` at the dev project. This script runs on dev only |
| `check:auth-behaviour` shows `(i) ... 8 characters, digits only` | The dev project still issues 8-digit codes | Part 0, step 0.3, then run it again |
| Another device still looks signed in after a password reset | The browser's pass is valid for up to an hour; the server has already refused to renew it | Wait up to an hour. It must be signed out after that |
