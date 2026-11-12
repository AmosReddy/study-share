# Phase 1b acceptance (owner guide): groups, invites and joining

This guide walks you through trying out everything Phase 1b added: making a group, sharing it on WhatsApp, joining by link and by code, the group password and its lock, leaving and rejoining, and the owner's settings. It is written so you can follow it one tick box at a time, in the same way as Part 8 of [SETUP_AUTH.md](SETUP_AUTH.md).

## You do not need to set anything up

**No new setup is needed in Supabase, Vercel or Google for Phase 1b.** There are no new settings, keys, templates or buttons to press in any dashboard. Everything from `SETUP_AUTH.md` stays exactly as it is.

The only thing Phase 1b adds outside the code is one **database migration, `0004`** (the new groups tables). **The developer applies it; you do nothing.** It is applied with the usual migrate step, on the dev project first and later on production.

**One thing to keep in mind for the merge:** production must have migration `0004` applied **before** the merge goes live. Without it, the group pages on the live site would fail. Ask the developer to confirm "0004 is applied on production" before you merge. (Dev needs it for this guide to work, so check with the developer that it is applied there too before you start.)

## How to read this guide

You need **two devices**: a **phone** and a **desktop browser** (or two phones). Call them:

- **Phone A**: you, the group **owner**, signed in as yourself.
- **Phone B** (or the desktop, in a private window): a **friend** with a different account, who opens your link on their own device.

You can also play both people yourself with two accounts. Use real addresses you can read in an inbox, as in Part 8 of `SETUP_AUTH.md`. A plus-address such as `you+friend@gmail.com` counts as its own account.

Test on the **dev preview** first (`<dev alias>`, the address the developer gives you for the Phase 1b preview), then repeat the main tests on `<live address>` after the merge. **The developer fills in `<dev alias>` and `<live address>` before you start.** If you still see those words in angle brackets, stop and ask the developer for the preview address.

After most steps you will see **You should see** (what a correct result looks like). If something looks different, write down what you saw and what you tapped, and tell the developer. Do not guess.

**Never paste a group password or an email code into a chat or a document.** In these tests, use a made-up password such as `maths-key-42`. A group password is not your account password: choose a different one.

### The order, at a glance

- [ ] Test 1: Create a group with a password
- [ ] Test 2: Create a link-only group
- [ ] Test 3: Share on WhatsApp, and the Copy buttons
- [ ] Test 4: A friend opens the link, signs up by email code and joins
- [ ] Test 5: The same with Continue with Google
- [ ] Test 6: Join by typing the short code
- [ ] Test 7: A wrong group password, and the 15-minute lock
- [ ] Test 8: Members, Leave, and rejoining with the code
- [ ] Test 9: The owner's Settings (details, password, link only, reset the link)
- [ ] Test 10: A stranger cannot tell a group exists
- [ ] Test 11: Phone checks (other scripts, long names, bottom tabs, home screen)

---

## Test 1: Create a group with a password

- [ ] **1.1** On **Phone A**, open `<dev alias>` and log in. On the home page, tap **Create a group**.
  - **You should see:** a page **Create a group** with a **Group name** box, a description box, two choices **Link and password** (already chosen) and **Link only**, and a **Group password** box.
- [ ] **1.2** Type the name **Maths Circle** and the password `maths-key-42`. Tap **Create group**.
  - **You should see:** a page **Group created** with the **invite link**, an 8-character **group code**, the **group password** in plain sight with the words "It is shown only now. Copy it or write it down before you leave this page." and the line **"Send the password separately from the link."**
  - **If it looks different:** "Use at least 6 characters" under the password box means the password was too short. Nothing was created; fix it and tap **Create group** again.
- [ ] **1.3** Now leave this page without writing the password down: tap your name at the top, choose **Account**, then press your phone's **Back** button until you are on **Create a group** again.
  - **You should see:** an **empty** Create a group form. The password is **not** shown any more, anywhere. (This is on purpose: the app keeps only a scrambled version and cannot show it again.)
- [ ] **1.4** Open the home page and the groups list (on the phone, the small button at the top that opens the list of your groups; on the desktop it is the column on the left).
  - **You should see:** **Maths Circle** in the list. Tap it to see the group page.
- [ ] **1.5** If you lose the password, open the group, go to **Settings**, and set a new one (see Test 9.2). The old password cannot be shown again.

## Test 2: Create a link-only group

- [ ] **2.1** On **Phone A**, tap **Create a group** again. Type the name **Open Chemistry** and choose **Link only**.
  - **You should see:** the **Group password** box disappears.
- [ ] **2.2** Tap **Create group**.
  - **You should see:** **Group created** with the link and the code, **no password**, and no "Send the password separately" line.

## Test 3: Share on WhatsApp, and the Copy buttons

Do this on the **Group created** page of a new group, or in the group's **Settings** tab (it shows the link and code again, any time).

- [ ] **3.1** Tap **Share on WhatsApp**.
  - **You should see:** WhatsApp opens (or WhatsApp Web, on a desktop) with a ready message. For a password group it reads "Join Maths Circle on study-share: <link>. Ask <your name> for the group password." For a link-only group it is "Join Open Chemistry on study-share: <link>". **The password is never in the message.**
  - **If it looks different:** if nothing opens on the phone, WhatsApp may not be installed. Try on the desktop, which opens WhatsApp Web.
- [ ] **3.2** Back on the page, tap **Copy link**, then **Copy code**, and, on a password group's created page, **Copy password**.
  - **You should see:** the button's name does not change; a small **Copied** appears beside the button for a few seconds. Paste into a note to check that each one copied what it should.

## Test 4: A friend opens the link, signs up by email code and joins

Use a **password group** (Maths Circle) and a **new email address** for the friend. Send the WhatsApp message (without the password) to **Phone B**, and send the password to Phone B separately.

- [ ] **4.1** On **Phone B** (signed out), tap the link.
  - **You should see:** "You're invited to join" and the **group name** (Maths Circle), then **Continue with Google**, **Sign up with email**, and "Already have an account? Log in". **No** member names, no owner email and nothing else about the group, and no box to type in yet.
- [ ] **4.2** Tap **Sign up with email**. Enter a name, the friend's email address, a password for their own account, tick the 18-or-older box, and tap **Create account**. Type the 6-digit code from the email and tap **Verify**.
  - **You should see:** you land **back on the same invite** (the group name again), now with a **Group password** box and "Ask <owner> for the group password."
- [ ] **4.3** Type the group password `maths-key-42` and tap **Join**.
  - **You should see:** the group page for **Maths Circle**, with **Library** and **Members** tabs (the bottom of the screen on a phone) and **no Settings** tab (only the owner has it).

## Test 5: The same with Continue with Google

- [ ] **5.1** Log out on **Phone B**. Open the group's invite link again and tap **Continue with Google**. Choose a Google account that has **never** used the site. (Under the button you should see "By continuing you confirm you are 18 or older and accept the Terms and Privacy Notice".)
  - **You should see:** after Google, you land back **on the invite**, not on the home page, and not on an "One last step" page.
- [ ] **5.2** Enter the group password and tap **Join**.
  - **You should see:** the Maths Circle group page.
  - **If it looks different:** inside an Instagram or Facebook in-app browser, you may see **Open in your browser** instead: copy the link into the real browser and retry.

## Test 6: Join by typing the short code

Use a third account (or log the friend out of the group first: see Test 8). The friend must **not** be a member yet.

- [ ] **6.1** On **Phone B**, signed in, tap **Join with a code** on the home page (or open `<dev alias>/join`).
  - **You should see:** a page **Join a group** with one box, **Group code**.
- [ ] **6.2** Type the code you copied in **lower case with a hyphen in the middle**, for example `ab3d-ef7h`, and tap **Find group**.
  - **You should see:** the invite page for the group, with the group name. (The code is not case-sensitive, and the hyphen is optional.) Enter the group password if it asks, and tap **Join**.
- [ ] **6.3** Go back to **Join a group** and type a code that does not exist, such as `zzzz-zzzz`.
  - **You should see:** under the box: "This invite link isn't valid any more. Ask the group owner for a new one." The same message as for a dead link: the site never says whether a code once existed.

## Test 7: A wrong group password, and the 15-minute lock

Use a friend who is **not yet a member** of the password group, signed in, on the invite page. (A wrong password is counted per person, per group.)

- [ ] **7.1** Type a wrong password and tap **Join**. Repeat four more times (five wrong tries in all).
  - **You should see:** each time, under the box: **"That password is not right."**
- [ ] **7.2** Now type the **right** password and tap **Join**.
  - **You should see:** a red notice **"Too many wrong passwords."** with the hint "You can try again in about 15 minutes." (the number of minutes may be smaller). Even the right password is refused.
- [ ] **7.3** Wait the 15 minutes and try the right password again. (You can carry on with other tests in the meantime, using other accounts and groups.)
  - **You should see:** you join the group.

## Test 8: Members, Leave, and rejoining with the code

- [ ] **8.1** With both accounts in the group, open the **Members** tab on **Phone A** and on **Phone B**.
  - **You should see:** both names on both phones. The owner has an **Owner** label. Your own name shows **You** on your own phone.
- [ ] **8.2** On **Phone A** (the owner), look for a **Leave group** button.
  - **You should see:** **no** Leave button. The page says "You own this group. Hand it over to another member first, then you can leave."
- [ ] **8.3** On **Phone B**, tap **Leave group**. A question appears (**Leave Maths Circle?**). Tap **Cancel** first.
  - **You should see:** nothing changed; you are still on Members.
- [ ] **8.4** Tap **Leave group** again, then **Leave group** in the question.
  - **You should see:** you are back on the home page and **Maths Circle** is gone from your groups list. Opening the group's old address now shows "This page could not be found."
  - **And:** on Phone A, reload Members. Only the owner is left.
- [ ] **8.5** On **Phone B**, rejoin with the **code** (as in Test 6), entering the group password.
  - **You should see:** you are in the group again, and both names are on Members on both phones.

## Test 9: The owner's Settings

On **Phone A**, open **Maths Circle** and tap the **Settings** tab.

- [ ] **9.1** **Name and description.** Change the name to **Maths Circle 2026**, add the description "Notes and papers for the 2026 batch." and tap **Save details**.
  - **You should see:** **Saved.** After a reload, the new name and description are at the top of the group, and in the groups list.
- [ ] **9.2** **Change the password.** Choose **Link and password**, type a new password in **New group password** (for example `physics-key-77`) and tap **Save join settings**.
  - **You should see:** the new password shown **once**, with **Copy password** and **Done**. Open **Members** and return to **Settings**: the password is gone. A friend who is not in the group must now use the new password, and the old one is refused.
- [ ] **9.3** **Link only, and back.** Choose **Link only** and tap **Save join settings**.
  - **You should see:** "Saved. Anyone with the link or the code can join." The password box disappears, and the WhatsApp message no longer asks for a password. Switch back to **Link and password** with a new password to finish.
- [ ] **9.4** **Reset the link.** Note the current link and code. Tap **Reset link**, read the question (**Reset the invite link?**, "The old link and code stop working immediately.") and tap **Reset link** again inside the question to confirm. (The button that opens the question and the button that confirms have the same name; **Cancel** closes the question without changing anything.)
  - **You should see:** a **new** link and a **new** code.
- [ ] **9.5** On a signed-out or signed-in browser that is not in the group, open the **old** link, then type the **old** code on **Join a group**.
  - **You should see:** "This invite link isn't valid any more. Ask the group owner for a new one." for both. The new link works.
  - **And:** people who are already members are not removed by a reset.

## Test 10: A stranger cannot tell a group exists

- [ ] **10.1** Use a third account that **never joined** the group. Open `<dev alias>/groups/<the group's address>` (copy the address of the group page from the owner's phone), and then `<dev alias>/groups/00000000-0000-4000-8000-000000000000`, a made-up address.
  - **You should see:** exactly the same page for both: "This page could not be found." The real group's name does not appear anywhere. The same holds for the `/members` and `/settings` addresses.

## Test 11: Phone checks

Do these on the **phone**, with a few groups made on purpose.

- [ ] **11.1** Create three groups whose names are: **తెలుగు సాహిత్యం అధ్యయన బృందం 📚** (Telugu with an emoji), **हिंदी व्याकरण समूह ✍️** (Hindi with an emoji), and one of exactly **60 characters**, for example the word `Thermodynamics` repeated until it is 60 characters long.
  - **You should see:** each name displays correctly, and the page does **not** move sideways when you swipe. A very long name is cut off with "…" in the group heading, in the sidebar and in the groups drawer rather than breaking the layout. In the **Your groups** list on the home page, a long name wraps onto more lines instead.
- [ ] **11.2** Open one of these groups and look at the bottom of the screen.
  - **You should see:** the tab bar (**Library**, **Members**, and **Settings** if you are the owner) fixed at the bottom, **not covered** by the browser's bottom bar, with tabs big enough to tap easily. On some phones the tab bar can sit above the keyboard while you type; that is fine. Scroll down: the last item on the page is **not hidden** behind the tab bar.
- [ ] **11.3** Open the **Create a group** page and tap the name box.
  - **You should see:** the page does not zoom in when the keyboard opens.
- [ ] **11.4** Add the site to the home screen (browser menu, "Add to Home screen" or "Install"). Open it from the new icon.
  - **You should see:** it opens as its own app window. On an iPhone you may need to log in once, because a home-screen app does not share the browser's sign-in. Open a group from there.

---

## Known limits in Phase 1b

These are by design; they come in later steps (mostly Phase 1c). They are not bugs.

- **The owner cannot leave a group yet.** Ownership transfer arrives in Phase 1c; until then the owner stays in the group.
- **No email invites, no removing a member, no deleting a group yet.** Share by link, code and WhatsApp only.
- **A group password cannot be recovered.** The site keeps only a scrambled version. If it is lost, the owner sets a new one in Settings (Test 9.2).
- **The Join-by-code page and invite lookups share one generous hourly limit per network.** A normal person never reaches it. If many people on one Wi-Fi network (a class, a hostel) try wrong codes at once, they may see "Please wait a moment" and must wait before trying again.
- **The Library tab is empty on purpose.** Uploading files arrives in Phase 2.
