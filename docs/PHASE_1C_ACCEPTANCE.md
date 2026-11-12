# Phase 1c acceptance (owner guide): removing members, handing over and deleting a group

This guide walks you through trying out everything Phase 1c added: removing a member (who can then never rejoin), handing the group to another member, and deleting a group. It is written so you can follow it one tick box at a time, in the same way as [PHASE_1B_ACCEPTANCE.md](PHASE_1B_ACCEPTANCE.md).

## What Phase 1c adds

- **Remove a member.** On the Members tab the owner can remove any other person. A removed person loses the group at once and **cannot join it again** with the link or the code.
- **Hand over a group.** In Settings the owner picks another member and makes them the owner. The old owner becomes a plain member and may leave the group like anyone else.
- **Delete a group.** In Settings the owner types the group's exact name to delete it. The group disappears for everyone at once. It is kept for **30 days**, so a mistake can still be undone by the developer.
- **No email invites.** You chose to drop that idea. Sharing stays as it is: link, code and WhatsApp.

## You do not need to set anything up

**No new setup is needed in Supabase, Vercel or Google for Phase 1c.** There are no new settings, keys, templates or buttons in any dashboard.

**There is no database migration in Phase 1c** (unlike Phase 1b). Nothing has to be run on production before the merge. The tables and columns this phase uses were already created by Phase 1b.

## How to read this guide

You need **two devices**: a **phone** and a **desktop browser** (or two phones). You need **three accounts** in one group. Call them:

- **You (owner)**: the group owner, signed in as yourself.
- **Friend A**: a second account, a different person or a second account of yours.
- **Friend B**: a third account.

A plus-address such as `you+a@gmail.com` counts as its own account. Use real addresses you can read in an inbox. Make one group (for example **Maths Circle**), and let Friend A and Friend B join it using the invite link or the code, exactly as in the Phase 1b guide. Check on the Members tab that all three names are there before you start. Use a link-only group if you like: it saves typing a group password.

**Where to test.** Test first on the **preview address** for the branch `feature/phase-1c-member-management`, written below as `<preview address>`. **The developer gives you that address.** If you still see the words `<preview address>` in angle brackets, stop and ask the developer. After the merge, repeat the main tests on the live address, `https://study-share-amber.vercel.app`.

**A lesson from Phase 1b: always open the site only from the correct address.** Use the preview address for these tests, and the live address after the merge. **Never** use the long links that Vercel shows for one particular deployment: a link that worked yesterday can show old code or behave differently. Test in a **private (incognito) window**, so old sign-ins and saved pages cannot confuse the result. Each person (you, A and B) needs their own private window or their own device.

After most steps you will see **You should see** (what a correct result looks like). If it looks different, there is an **If it looks different** hint, or write down what you saw and what you tapped and tell the developer. Do not guess.

**Never paste a group password or an email code into a chat or a document.**

### The order, at a glance

- [ ] Test 1: The owner removes Friend A
- [ ] Test 2: Friend A cannot rejoin by link or by code
- [ ] Test 3: A plain member has no Remove buttons and no Settings
- [ ] Test 4: Hand the group over
- [ ] Test 5: Hand-over when nobody else is in the group
- [ ] Test 6: Delete the group
- [ ] Test 7: Phone checks
- [ ] Test 8: If you delete a group by mistake

---

## Test 1: The owner removes Friend A

Start with the group having three people: you, Friend A and Friend B. Keep Friend A and Friend B signed in on their own devices or private windows, with the group open.

- [ ] **1.1** As the **owner**, open the group and tap the **Members** tab.
  - **You should see:** three names. You have an **Owner** label and a **You** label. Each of the **other two** people has a red **Remove** button beside their name. **Your own row has no button.**
  - **If it looks different:** no Remove buttons at all means you are not signed in as the owner (see Test 3).
- [ ] **1.2** Tap **Remove** beside Friend A. (A screen reader calls this button "Remove" followed by the name, for example "Remove Ravi Kumar".)
  - **You should see:** a panel slides up from the bottom with the title **Remove <Friend A's name>?** and the text "<Friend A's name> will lose access to <group name> and won't be able to join this group again." It has a red button **Yes, remove <Friend A's name>** and a **Cancel** button.
- [ ] **1.3** Tap **Cancel**.
  - **You should see:** the panel closes and all three people are still listed.
- [ ] **1.4** Tap **Remove** beside Friend A again, then tap **Yes, remove <Friend A's name>**.
  - **You should see:** the panel closes by itself and the list now shows two people (the count beside "Members" drops to 2). Friend A's name is gone. Friend B and you are still there.
  - **If it looks different:** a red message in the panel such as "We couldn't save that right now. Please try again." means nothing changed. Tap the red button again. If it keeps happening, tell the developer.
- [ ] **1.5** On **Friend A's** device, reload the home page.
  - **You should see:** the group is **no longer in Friend A's list** of groups.
- [ ] **1.6** On **Friend A's** device, open the group's old address (the address of the group page, copied from the owner's address bar earlier). Then open `<preview address>/groups/00000000-0000-4000-8000-000000000000`, a made-up address.
  - **You should see:** exactly the same page for both: **"This page could not be found."** The real group's name does not appear anywhere. (The site must not tell a removed person that the group exists.)
- [ ] **1.7** On **Friend A's** device, open the group's **invite link**.
  - **You should see:** the message **"You can't join this group."** and **no Join button**.
- [ ] **1.8** Still on **Friend A's** device, open `<preview address>/join`, type the group **code** into **Group code** and tap **Find group**.
  - **You should see:** the invite page with the same message, **"You can't join this group."**
- [ ] **1.9** On **Friend B's** device and on **yours**, reload the group.
  - **You should see:** nothing else changed. The group works as before for both of you, and Members now shows two people.

## Test 2: Friend A cannot rejoin by link or by code

This test makes sure the block really holds, even with the right group password.

- [ ] **2.1** On **Friend A's** device (signed in as Friend A), open the invite link again. If it is a password group, you cannot even enter a password.
  - **You should see:** **"You can't join this group."** with no Join button and no password box.
- [ ] **2.2** Log Friend A out, log back in, and try the link and the code once more.
  - **You should see:** the same message every time. Logging out and in does not lift the block.
- [ ] **2.3** Ask the owner to reset the invite link (Settings, **Reset link**) and try the **new** link and code with Friend A.
  - **You should see:** still **"You can't join this group."** A new link does not lift the block. (The block belongs to Friend A's account, not to the link.)
  - **If it looks different:** if Friend A gets into the group, tell the developer straight away and write down every step you took.

## Test 3: A plain member has no Remove buttons and no Settings

- [ ] **3.1** On **Friend B's** device (a plain member), open the group and look at the bottom tabs (or the side tabs on a desktop).
  - **You should see:** only **Library** and **Members**. **There is no Settings tab.**
- [ ] **3.2** Tap **Members**.
  - **You should see:** the names, and a **Leave group** button. **No Remove button** next to anybody.
- [ ] **3.3** Type the group's address with `/settings` added at the end, for example `<preview address>/groups/<the group's address>/settings`.
  - **You should see:** **"This page could not be found."** (A plain member is not shown that Settings exists.)

## Test 4: Hand the group over

For this test you need the owner (you) and at least Friend B in the group. If you removed Friend A in Test 1, that is fine. For extra checking, add a third person back using a new account.

- [ ] **4.1** As the **owner**, open the **Members** tab.
  - **You should see:** no **Leave group** button. Instead the page says "You own this group. Hand it over to another member first, then you can leave." and a link **Hand over this group**.
- [ ] **4.2** Tap **Hand over this group**.
  - **You should see:** the **Settings** tab opens, and further down the section **Hand over this group** with the words "Make another member the owner. You become a regular member, and only the new owner can change these settings." and a list **Choose the new owner** with one round choice for each other member. **You are not in the list.**
- [ ] **4.3** Without choosing anyone, tap **Hand over…**.
  - **You should see:** no panel opens, and a red line under the list says **"Pick someone who is in this group."**
- [ ] **4.4** Choose **Friend B** and tap **Hand over…**.
  - **You should see:** a panel with the title **Make <Friend B's name> the owner?** and the text "You will become a regular member and lose access to Settings." with the buttons **Make <Friend B's name> the owner** and **Cancel**.
- [ ] **4.5** Tap **Cancel**.
  - **You should see:** the panel closes and nothing changed. You are still the owner on the Settings page.
- [ ] **4.6** Tap **Hand over…** again, then **Make <Friend B's name> the owner**.
  - **You should see:** you land on the group's main page (the Library tab).
- [ ] **4.7** Look at the tabs, then open **Members**.
  - **You should see:** only **Library** and **Members** (**no Settings**). On Members, Friend B has the **Owner** label and you have **You**. There are **no Remove buttons**, and you now have a **Leave group** button.
- [ ] **4.8** Type the group's address with `/settings` at the end.
  - **You should see:** **"This page could not be found."**
- [ ] **4.9** On **Friend B's** device, reload the group and open **Members**.
  - **You should see:** tabs **Library**, **Members** and **Settings**. The **Owner** label is on Friend B's name. Friend B has **Remove** buttons beside the other people, and **no Leave group** button. In its place is the sentence "You own this group. Hand it over to another member first, then you can leave."
  - **And:** Friend B's Settings shows the invite link and code, and they still work.
- [ ] **4.10** On **your** device (the old owner), tap **Leave group**, read the question (**Leave <group name>?**), and tap **Leave group** inside it.
  - **You should see:** you land on the home page and the group is gone from your list.
- [ ] **4.11** On **Friend B's** device, reload **Members**.
  - **You should see:** the old owner is gone. The group still exists, Friend B is the owner, and the others still have it.

## Test 5: Hand-over when nobody else is in the group

- [ ] **5.1** As the owner, create a new group, for example **Solo Group**, and do not let anyone join. Open its **Settings** tab and find **Hand over this group**.
  - **You should see:** the sentence **"Nobody else is in this group yet."** and a **Hand over…** button that is **greyed out** and does nothing when you tap it. No panel opens.

## Test 6: Delete the group

Use a group that you do not mind losing (make a new one called **Delete Test Group**, and let Friend B join it). You are the owner.

- [ ] **6.1** Open the group, then **Settings**, and scroll to the bordered section **Delete this group**.
  - **You should see:** the words "Everyone loses access at once and the invite link stops working. The group is kept for 30 days in case it was a mistake — ask the project owner to restore it." and a red **Delete group…** button.
- [ ] **6.2** Tap **Delete group…**.
  - **You should see:** a panel with the title **Delete Delete Test Group?** (the word "Delete", then the group's name), the text "Everyone loses access at once. This cannot be undone from the app.", a box labelled **Type Delete Test Group to confirm**, a red button **Delete this group** that is **greyed out**, and **Cancel**.
- [ ] **6.3** Type the name **wrongly**: for example `Delete Test`, then `delete test group` (small letters), and then the right name with an extra space at the end.
  - **You should see:** the **Delete this group** button stays **greyed out** each time. Only the name typed exactly (capital letters and all) turns it on.
- [ ] **6.4** Tap **Cancel**, then tap **Delete group…** again.
  - **You should see:** the box is **empty** again. Nothing is kept from last time.
- [ ] **6.5** Type the name exactly and tap **Delete this group**.
  - **You should see:** the button is no longer grey, and after you tap it you land on the **home page**. The group is gone from your list.
- [ ] **6.6** On **Friend B's** device, reload the home page.
  - **You should see:** the group is **gone from Friend B's list** as well.
- [ ] **6.7** On **Friend B's** device, open the group's old address.
  - **You should see:** **"This page could not be found."**
- [ ] **6.8** In any browser, open the group's old **invite link**, and type the old **code** on `<preview address>/join`.
  - **You should see:** for both: **"This invite link isn't valid any more. Ask the group owner for a new one."** (Not "You can't join this group": that message is only for a removed person.)

## Test 7: Phone checks

Do these on the **phone**.

- [ ] **7.1** Make a group with a very long name (60 characters, for example `Thermodynamics` repeated), and another with a Telugu or Hindi name with an emoji. Add a member with a long name too.
  - **You should see:** the names show correctly, with no sideways scrolling anywhere (swipe left and right to check).
- [ ] **7.2** On a phone with a narrow screen (about 360 pixels wide, for example a small Android phone, or a desktop browser narrowed to that width), open **Members** and tap **Remove** beside the person with the long name.
  - **You should see:** the panel slides up from the bottom and fits the screen. The long name wraps onto more lines instead of running off the edge. Both buttons are big enough to tap easily, and the **Yes, remove ...** button is fully readable.
- [ ] **7.3** Open **Settings**, **Delete group…**, and tap into the name box so the keyboard opens.
  - **You should see:** the name box is **not hidden** behind the keyboard, and the page does **not zoom in**. You can still see the **Delete this group** button after scrolling a little.
- [ ] **7.4** Open **Hand over this group** in Settings with a member who has a long name.
  - **You should see:** the choices wrap, each is easy to tap, and the **Make ... the owner** panel fits on the screen.
- [ ] **7.5** Open the **Remove** panel and tap **Cancel**, or tap the small close mark in its corner.
  - **You should see:** the panel closes and nothing was removed, handed over or deleted.

## Test 8: If you delete a group by mistake

Phase 1c deletes a group "softly". **Nothing is erased for good yet.**

- [ ] **8.1** Read this and remember it: if you (or another owner) delete a group by mistake, **do not make a new one**. Ask the **project owner** (the person who runs the database, which is the developer) to restore it. It can be restored for **30 days** after it was deleted, because the group is only marked as deleted in the database, and its members are still recorded there.
- [ ] **8.2** Ask the developer to restore the **Delete Test Group** from Test 6 (see "Database restore note for the developer" below).
  - **You should see:** after the developer says it is restored, the group is back in its members' lists, and its old invite link and code work again.
- [ ] **8.3** Understand what is **not** possible yet: there is no "Restore" button in the app, and after 30 days there is no automatic clean-up either (that job comes later). Treat "30 days" as the time the developer promises to keep it, not as a countdown you can see.

---

## Known limits in Phase 1c

These are by design. They are not bugs.

- **A removed person cannot be let back in from the app yet.** Restoring them is a database job for the developer until Phase 5.
- **A deleted group can only be restored by the developer, in the database.** There is no Restore button and no list of deleted groups in the app.
- **Files are not part of groups yet.** The Library tab is still empty on purpose; uploading arrives in Phase 2.
- **There are no email invites.** Sharing is by link, code and WhatsApp only, by your choice.
- **After a hand-over, only the new owner controls the group.** If you want it back, the new owner has to hand it to you.

---

## Database restore note for the developer

**For the developer only. The owner does not run these.** Both run directly in the database, not in the app. **Check which project you are connected to first (dev or production)**, and run them only on the right one. A wrong project means changing real people's groups, or none at all.

**Restore a deleted group** (works for up to 30 days after deleting, which is how long the group is kept; there is no purge job in Phase 1c, so rows are in practice kept longer):

```sql
update groups set deleted_at = null where id = '<group id>';
```

The `<group id>` is the long address part in the group's page address: `/groups/<group id>`. Ask the owner for the group page address, or look up the group by name in `groups` (select `id, name, deleted_at` where `deleted_at` is not null).

**Let a removed person back in** (only because the owner asked, and the app has no button for it):

```sql
update group_members set status = 'active' where group_id = '<group id>' and user_id = '<user id>';
```

Take care with the limits: a group can have at most **300 members** and a person can be in at most **20 groups** (see `GROUP_LIMITS`). The database does not check these limits for a direct update, so count the active members of the group and the active groups of the person first. Also make sure the group has exactly one active owner afterwards (one active owner per group is enforced by a partial unique index), and do not change anyone's `role` in this statement.
