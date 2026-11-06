# Setting up accounts (owner guide)

This guide walks you through everything outside the code that sign-up, log-in, password reset and "Continue with Google" need: Supabase Auth settings, Gmail for sending email, a Google sign-in client and Vercel settings. It is written so you can follow it one tick box at a time. Keep it for later: you will repeat parts of it for any new environment.

Nothing here needs you to write code. You will click through three dashboards and run a few commands in a terminal in the project folder.

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

After most steps you will see **You should see** (what a correct result looks like) and **If it looks different** (what to try). Dashboards change their menus now and then. If a menu has moved, use the dashboard's search box or look at the nearby menu items for the same word.

**Never paste a password, key or token into a chat, a document or a commit.** Secrets go into the dashboards and into `.env.local` or `.env.production.local` on your computer only. Those two files are not committed.

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

Use this as your tick list. The order matters: the dev project can only send two or three emails an hour with its built-in sender, so Gmail comes first.

- [ ] Part 1: Gmail app password
- [ ] Part 2: Supabase dev settings
- [ ] Part 3: Google sign-in
- [ ] Part 4: Supabase production settings
- [ ] Part 5: Database migrations (dev and production)
- [ ] Part 6: Vercel settings and redeploy
- [ ] Part 7: Checks from your computer
- [ ] Part 8: Live acceptance on a phone and a desktop
- [ ] Part 9: The merge gate
- [ ] Part 10: Operations from the pilot on

---

## Part 1: Gmail app password

**[GMAIL]** Supabase will send sign-up and reset emails through the project Gmail account. Gmail does not let other programs use your normal password, so you create an app password.

- [ ] **1.1** Sign in to the project Gmail account and turn on 2-step verification (Google Account, Security, 2-Step Verification). Skip this if it is already on.
- [ ] **1.2** Go to `https://myaccount.google.com/apppasswords`, name the password `study-share`, and create it.
  - **You should see:** a 16-character password shown once.
  - **If it looks different:** if the page says app passwords are not available, 2-step verification is not fully on (step 1.1), or the account is a managed work or school account. Use a normal personal Gmail account for this project.
- [ ] **1.3** Copy the password into your private notes as `<app password>`. You will paste it into Supabase twice (dev and production) and into your `.env.local` files as `SMTP_PASSWORD`. Google will not show it again, but you can always create a new one.

---

## Part 2: Supabase dev settings

**[DEV]** Open the dev project in the Supabase dashboard. Do these in this order, with SMTP first, because every later step that sends an email would otherwise hit the built-in limit.

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
  - **You should see:** the three settings keep their values after you reload.
  - **If it looks different:** the password length field can live under Authentication, Sign In / Providers, in a section above the provider list. Look for "Password" or "Minimum password length".

### 2.3 URL configuration

Site URL is **one value per Supabase project**, and the links in emails are built from it. During acceptance, the dev project's Site URL is the branch preview address, so confirmation links lead to the preview.

- [ ] **2.3.1** Go to Authentication, then URL Configuration.
- [ ] **2.3.2** Set **Site URL** to `<dev alias>` (the address given in the table at the top).
- [ ] **2.3.3** Under **Redirect URLs**, add these three, each on its own line (the `/**` at the end matters):
  - `<dev alias>/**`
  - `http://localhost:3000/**`
  - `https://study-share-*-<your-vercel-team-slug>.vercel.app/**` (covers other preview addresses of your team)
- [ ] **2.3.4** Save.
  - **You should see:** Site URL and all three redirect URLs listed.
  - **If it looks different:** the preview pattern is optional for acceptance. If Supabase rejects the `*`, leave that line out and add only the first two.

### 2.4 Rate limits

Every sign-up and log-in reaches Supabase from Vercel's servers, not from the person's phone. Supabase may therefore count the whole class as one visitor and block them together. Raise the per-IP limits so the class fits.

- [ ] **2.4.1** Go to Authentication, then Rate Limits.
- [ ] **2.4.2** Set **Rate limit for sending emails** (per hour) to a value that Gmail can sustain but that still fits the class on launch day. A starting point is **60**. A normal Gmail account sends roughly 500 emails a day, so do not go much higher than the class really needs.
- [ ] **2.4.3** Raise the per-IP limits, for example to **500** each: **sign-ups and sign-ins**, **token verifications** and **token refreshes**. Save.
  - **You should see:** the new numbers saved.
  - **If it looks different:** if the email limit field is greyed out, custom SMTP (step 2.1) is not on yet.

The app adds its own limits on top (one email a minute per address, and hourly caps per address and per network address). If Supabase still refuses an email, the person is told "We couldn't send the email right now."

### 2.5 Email templates

The default links in the emails only work on the device that asked for them. Replace them with links to this site so they work on any device. The link only shows a "Continue" button; the token is used when the person taps Continue, so mail scanners (Outlook / Microsoft 365 Safe Links) cannot use it up.

- [ ] **2.5.1** Go to Authentication, then Emails, then **Templates**, and open **Confirm signup**.
- [ ] **2.5.2** Keep the subject line. In the message body, make the link exactly this (you can keep or change the words around it):

```html
<h2>Confirm your email</h2>
<p>Follow this link to confirm your email address.</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&redirect_to={{ .RedirectTo }}">Confirm your email</a></p>
```

- [ ] **2.5.3** Save. Open the **Reset password** template.
- [ ] **2.5.4** Make its link exactly this:

```html
<h2>Reset your password</h2>
<p>Follow this link to choose a new password.</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&redirect_to={{ .SiteURL }}/reset-password">Choose a new password</a></p>
```

- [ ] **2.5.5** Save.
  - **You should see:** each template shows the new link in its editor and preview after you reload.
  - **If it looks different:** copy the `<a ...>` line character for character. `{{ .SiteURL }}`, `{{ .TokenHash }}` and `{{ .RedirectTo }}` are Supabase placeholders and must keep the double curly braces. Do not change `type=email` or `type=recovery`.

### 2.6 Google provider (done in Part 3)

You will turn on Google for this project in Part 3, once you have a client id and secret.

---

## Part 3: Google sign-in

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

---

## Part 4: Supabase production settings

**[PROD]** Open the production project and repeat the same settings as Part 2. The differences are marked.

- [ ] **4.1** Authentication, Emails, SMTP Settings: the same Gmail settings as step 2.1.
- [ ] **4.2** Authentication, Sign In / Providers, Email: enabled, **Confirm email ON**, minimum password length 8 (step 2.2).
- [ ] **4.3** Authentication, URL Configuration:
  - **Site URL:** `<live address>`.
  - **Redirect URLs:** `<live address>/**`, `http://localhost:3000/**` and `https://study-share-*-<your-vercel-team-slug>.vercel.app/**`.
- [ ] **4.4** Authentication, Rate Limits: the same as step 2.4.
- [ ] **4.5** Authentication, Emails, Templates: the same **Confirm signup** and **Reset password** HTML as steps 2.5.2 and 2.5.4.
- [ ] **4.6** Google provider: already done in step 3.3.3.
  - **You should see:** the same results as in Part 2, with `<live address>` as the Site URL.
  - **If it looks different:** see the "If it looks different" hints in Part 2. The usual slip is leaving the dev alias as the production Site URL, which sends real users' confirmation links to the preview.

---

## Part 5: Database migrations

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

Migrations 0001 to 0003 **must be applied to production before anything is merged to `main`**: without them production has no `profiles` or `rate_limits` tables and sign-up breaks.

- [ ] **5.2.1** Create the file of production settings, **outside the project folder**. This file holds the production service-role key, the database address and the email password. The project folder is inside OneDrive, which copies its files to the cloud, and Next.js loads a `.env.production.local` that sits in the project folder automatically for `npm run build` and `npm run start`, so a local build or start would quietly use production settings. So:
  - **Recommended: keep it outside OneDrive.**
    1. In File Explorer, open `C:\Users\<you>\` (your user folder, where Desktop, Documents and Downloads live) and create a new folder directly inside it, for example `study-share-secrets`. Do **not** use Desktop, Documents, Downloads or Pictures: OneDrive normally syncs those, and so does the project folder itself (it is inside OneDrive\Desktop).
    2. In Explorer, turn on file name extensions: View, Show, **File name extensions**. Otherwise Windows hides a `.txt` ending and you cannot see it.
    3. Open Notepad, paste the settings (see "What goes in the file" below), then File, Save as. Choose the new folder, set **Save as type** to **All files**, and type the file name exactly `.env.production.local`. Save.
    4. Check in Explorer that the file is called `.env.production.local` and not `.env.production.local.txt`. If it ends in `.txt`, rename it and remove the `.txt`.
    5. Get its full path: hold Shift, right-click the file, choose **Copy as path**. The path is copied with quotes around it, for example `"C:\Users\<you>\study-share-secrets\.env.production.local"`.
    6. In the commands below, replace the **whole** `<production env file>` token with that full path, including the file name, and keep exactly **one** pair of quotes around it. The commands already show `--env-file="<production env file>"`, so if you paste the path with its own quotes, delete the extra pair: you want `--env-file="C:\Users\<you>\study-share-secrets\.env.production.local"`, never two pairs of quotes.
  - **Fallback only: in the project folder.** You can instead create `.env.production.local` in the project folder. It is still not committed, but OneDrive syncs it to the cloud, and you must not run `npm run build` or `npm run start` on your computer while it is there. In that case write `.env.production.local` in place of `<production env file>` in the commands below, keeping the quotes.

  **What goes in the file.** All the production settings, copied from the list in `.env.example`: `APP_ENV=production`; `DATABASE_URL` and `DATABASE_MIGRATION_URL`; `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`; the `STORAGE_*` settings; the `SMTP_*` settings; and **`NEXT_PUBLIC_SITE_URL`** set to `<live address>`. Every value points at the **production** project. Put each setting on its own line as `NAME=value`, with no spaces around `=` and no quotes around the value. `NEXT_PUBLIC_SITE_URL` is needed because production settings require it: without it, `check:services` on production fails and the app refuses to start.

- [ ] **5.2.2** **[TERMINAL]** Run, using only the production file:

```bash
node --env-file="<production env file>" ./node_modules/drizzle-kit/bin.cjs migrate
```

  - **You should see:** the command ends without an error. In the production project's Table Editor (public schema) there are `profiles` and `rate_limits` tables.
  - **If it looks different:** if it says a file cannot be found, check the full path in quotes (one pair only), check that the file name does not secretly end in `.txt` (step 5.2.1, point 4), and run the command from the project folder (the migrate script is looked up there). If the run is reported as nothing to apply, the migrations were already applied. If it fails to connect, check `DATABASE_MIGRATION_URL` in the production file.

---

## Part 6: Vercel

**[VERCEL]** Open the project's Settings, then Environment Variables.

- [ ] **6.1** Add **`NEXT_PUBLIC_SITE_URL`** with the value `<live address>`, and tick **Production only**. Untick Preview and Development. Previews must use their own branch address, so this setting stays unset for Preview.
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

These commands test the real services from your terminal. They print `PASS` or `FAIL` lines and never print passwords or keys.

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

  This asks the real Supabase Auth how it behaves in the cases our test double copies, and prints labelled `FACT` lines. **It creates and deletes test users, sends about three emails to plus-addresses of the project Gmail (nobody else gets email), waits a little over a minute at one point, and refuses to run against production settings.** Run it on dev only.
  - **You should see:** a list of `FACT` lines ending with `Clean-up: ... test user(s) deleted, 0 left.` One line reads `(a) verdict: FIRST password kept (pre-registration takeover is possible)`. That is the expected result: it is the reason a confirmation link confirms the address and then asks the person to log in.
  - **If it looks different:** if the verdict says the **LATEST** password replaces the first, tell the developer. The spec's "Same email, two ways in" decision needs revisiting. If a line says `WARN  test user ... was not deleted`, delete that user in Authentication, Users. If it says it refuses production settings, your `.env.local` points at production: fix it.

### 7.2 Production: `check:services` only

`check:services` is safe on production, but it creates and deletes one throwaway confirmed user and one small test file. **Never run `check:auth-behaviour` against production.** It refuses to, but do not try.

- [ ] **7.2.1** **[TERMINAL]** Run, loading only the production file (use the same full path as in step 5.2.1; `npm run check:services` would load `.env.local`, which is the dev project):

```bash
npx tsx --conditions=react-server --env-file="<production env file>" scripts/check-services.ts
```

  - **You should see:** the same four `PASS` lines.
  - **If it looks different:** `FAIL environment ... NEXT_PUBLIC_SITE_URL` means the production file is missing that setting (step 5.2.1). `FAIL database` right after a fresh project usually means a wrong connection string.

---

## Part 8: Live acceptance on a phone and a desktop

**[PHONE]** Test on the dev preview first (`<dev alias>`, with the dev project's Site URL set to the same address), then on the live site after the merge. Use a real phone and a desktop browser. Use addresses you own and can read.

Before you begin, make sure the dev project's Site URL is `<dev alias>` (step 2.3) and that Parts 1 to 3 are done. A sign-up started on your own computer with `npm run dev` also sends links to the Site URL, so its confirmation email will open the preview, not localhost.

### 8.1 Email sign-up and confirmation

- [ ] **8.1.1** On the desktop, open `<dev alias>/signup`, create an account with email and password, and accept the terms.
  - **You should see:** a "check your email" message.
- [ ] **8.1.2** Open the email **on the phone**, a different device from the sign-up. Tap the link, then tap **Continue**.
  - **You should see:** the page "Confirm your email" with a Continue button first, and after Continue the login page saying **"Your email is confirmed. Log in to continue."** (the address is `/login?confirmed=1`).
  - **If it looks different:** a login-looking page saying the link expired means the template or Site URL is wrong (see Troubleshooting). No email at all means the SMTP settings or quota (Part 2.1, 2.4).
- [ ] **8.1.3** Log in with the email and password you chose, on the phone.
  - **You should see:** you are signed in and see the home screen. The link confirmed the address but did not sign you in by itself. That is deliberate (see the spec's "Same email, two ways in").

### 8.2 Check that the `&` in the link survives

- [ ] **8.2.1** Open `<dev alias>/signup?next=%2Fprivacy%3Fa%3D1%26b%3D2` and sign up with a new address you own.
- [ ] **8.2.2** In the received email, look at the confirm link (long-press or hover to see the address).
  - **You should see:** the part after `redirect_to=` contains `%26` (encoded), not a bare `&`. After you tap Continue and log in, you arrive on the Privacy page.
  - **If it looks different:** a bare `&` cuts the address short. Re-check that you copied the template exactly (step 2.5.2).

### 8.3 Outlook / Microsoft 365

Microsoft's mail scanners open links before you do. The Continue page exists for them.

- [ ] **8.3.1** Sign up with an **Outlook or Microsoft 365** address, wait for the email, and open the link. Repeat with a **Gmail** address.
  - **You should see:** both links work: the Continue page appears, and the link is not already used.
  - **If it looks different:** "expired or already used" on an Outlook address right away means the template still has Supabase's original link (step 2.5), which a scanner can use up.
- [ ] **8.3.2** Request a password reset for the Outlook address from `/forgot-password` and open that email's link too.

### 8.4 Password reset and the expired-link message

- [ ] **8.4.1** Go to `/forgot-password`, request a reset for your test account, open the email, tap the link, tap Continue.
  - **You should see:** the page **"Choose a new password"** at `/reset-password`. Set a new password, then log in with it.
- [ ] **8.4.2** Open the same reset link a second time.
  - **You should see:** the forgot-password page with **"This reset link has expired or was already used."** and a box to request a new one.
  - **If it looks different:** if you land on the sign-up login page instead, the reset template is wrong (step 2.5.4, `type=recovery`).

### 8.5 Google sign-in

- [ ] **8.5.1** Log out. Choose **Continue with Google** with a Google account that has no account here yet.
  - **You should see:** after Google, the **"One last step"** page (`/welcome`) where you accept the terms, then the home screen.
  - **If it looks different:** "Access blocked" or an error page from Google: see Troubleshooting.
- [ ] **8.5.2** Log out. Use **Continue with Google** with the Google account whose address matches the confirmed password account from 8.1.
  - **You should see:** you land in that same account (same display name), not a second one.
- [ ] **8.5.3** If you can, open the site's link inside an **Instagram or Facebook in-app browser** (send it to yourself in a message and tap it there).
  - **You should see:** an **"Open in your browser"** notice with a copy-link button, instead of a Google error.

### 8.6 The rest of the account

- [ ] **8.6.1** Log out and back in with email and password.
- [ ] **8.6.2** Open `/account` and change the display name. Reload to check it stuck.
- [ ] **8.6.3** Open `/terms` and `/privacy`.
- [ ] **8.6.4** On the phone, add the site to the home screen (browser menu, "Add to Home screen" or "Install") and open it from there.
  - **You should see:** it opens as its own app window with the icon, and you are still signed in.

### 8.7 After the merge

- [ ] **8.7.1** Repeat 8.1 to 8.6 on `<live address>` (production project), at least sign-up with confirmation on a second device, Google sign-in and a password reset.
- [ ] **8.7.2** Open `<live address>/api/health` once more and see `{"status":"ok","db":"ok"}`.

---

## Part 9: The merge gate

The first merge to `main` happens only when **all** of these are true:

- [ ] Parts 1 to 4 are done: the settings, the email templates and Google sign-in are set up in **both** the dev and the production project.
- [ ] Migrations 0001 to 0003 are applied to **production** (step 5.2).
- [ ] `NEXT_PUBLIC_SITE_URL` is set in Vercel for **Production** (step 6.1), and the production deployment has been redeployed.
- [ ] The contact address is filled in. This is already done: it is set to the project mailbox in `src/shared/legal.ts`, and it is shown publicly on the Privacy and Terms pages.
- [ ] The live checks in Part 7 passed on dev (`check:services` and `check:auth-behaviour`) and `check:services` passed on production.
- [ ] Acceptance in Part 8 (8.1 to 8.6) passed on the preview.

Then the developer opens the pull request, CI runs, and you approve the merge. After the merge, do 8.7.

### Site URL after the merge

Site URL is one value per Supabase project. After the merge, the **production** project keeps `<live address>`. The **dev** project can keep the branch alias (useful if you still want to test emails from previews) or go back to `http://localhost:3000` (right for local-only testing). Remember what it is set to: confirmation and reset emails from the dev project always link to its Site URL.

---

## Part 10: Operations from the pilot on

- [ ] **Sweep unconfirmed users every week.** Someone can sign up with another person's address and never confirm. Delete users who are still unconfirmed after 7 days, so a stranger's pending account does not wait for the real owner. In the Supabase dashboard open Authentication, Users and look for users without a confirmed email, or use the SQL editor. First look:

```sql
select id, created_at from auth.users
where email_confirmed_at is null and created_at < now() - interval '7 days';
```

  Then, if the list looks right, delete them in the dashboard, or with the same condition:

```sql
delete from auth.users
where email_confirmed_at is null and created_at < now() - interval '7 days';
```

  Do this in the production project (and dev if you like). It is a manual task during the pilot; scheduling it is part of the fix needed before the public launch (see the spec's known risks).
- [ ] **Watch the logs for the email-limit line.** In Vercel open the project, then Logs, and search for `Auth provider refused to send an email (rate limited)`. If it appears, people were told "We couldn't send the email right now." Raise the email-per-hour limit (step 2.4.2), or wait for the hourly window to pass. If it appears often, tell the developer.

---

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| "We couldn't send the email right now" | Supabase refused to send: the hourly email quota is used up, the dev project is still on its built-in sender (a couple of emails an hour), or Gmail rejected the login | Check Authentication, Emails, SMTP Settings is on and saved (step 2.1), the app password is current, and the hourly email limit in Rate Limits (step 2.4.2) is high enough. Look for the log line in Part 10. Wait a few minutes and try again |
| "We just sent you an email. Please wait a minute" | The app's own one-email-a-minute limit per address, working as intended | Wait a minute, then try again |
| No email arrives, no error | The message went to spam, or the address is already registered and confirmed (sign-up shows the same message either way) | Check spam. For a confirmed address, use Forgot password or log in |
| The email link opens a login-looking page or says "expired" straight away | The email template still has Supabase's original link, or the Site URL or redirect URL list is wrong, or the link was already used (a mail scanner or an earlier tap) | Re-paste both templates exactly (step 2.5). Check Site URL (step 2.3 or 4.3) and that the redirect list has the address with `/**`. Request a fresh email and use only the newest one |
| The link works but lands on the wrong site (localhost or the preview) | Site URL is one value per project and emails are built from it | Set Site URL to the address you are testing (step 2.3), then request a new email |
| After Continue you land on the login page and your password "does not work" | If the address was signed up earlier by someone else, Supabase keeps the first password | Use Forgot password to set your own |
| Google says "Access blocked" or "app not verified" | The consent screen is still in **Testing**, or it requests more than `openid`, `email`, `profile` | Publish it (step 3.1.5) and check the scopes (step 3.1.4) |
| Google error `redirect_uri_mismatch` | The redirect URI in Google differs from Supabase's Callback URL | Copy Supabase's Callback URL from its Google provider page into the client's Authorised redirect URIs exactly (step 3.2.2) |
| Google sign-in returns to the login page with "Google sign-in did not finish" | The site address is missing from Supabase's Redirect URLs, or the client id or secret in Supabase is wrong | Check the redirect list (step 2.3.3 or 4.3) and re-paste the client id and secret (step 3.3) |
| `/api/health` returns 503 on production after a deploy | A setting is missing or wrong. The most common one is `NEXT_PUBLIC_SITE_URL`, which production now requires. Other causes: `APP_ENV` not `production`, or settings pointing at the wrong Supabase project | Add `NEXT_PUBLIC_SITE_URL` for Production (step 6.1), check the other variables (step 6.2), redeploy (step 6.3). The Vercel logs say which setting is at fault |
| `check:services` on production says `NEXT_PUBLIC_SITE_URL` is missing | The production file lacks it | Add the live address to that file (step 5.2.1) |
| Sign-up fails with a database error, or no profile appears | Migrations 0001 to 0003 are not applied to that project | Run the migration for that project (Part 5) |
| Locally, you sign in and are sent back to the login page again and again | An `https` `NEXT_PUBLIC_SITE_URL` while running over `http://localhost`: the cookies are marked secure and the browser drops them | Never set an `https` `NEXT_PUBLIC_SITE_URL` for a local `http` run. Remove it from `.env.local` and restart `npm run dev` |
| `check:auth-behaviour` refuses to run | Your settings are, or point at, production | Point `.env.local` at the dev project. This script runs on dev only |
