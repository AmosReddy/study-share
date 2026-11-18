# Slice 5 acceptance (owner guide): you design your group's upload form

This guide walks you through trying out everything Slice 5 added: **the group owner can now design the upload form for their own group**. It is written so you can follow it one tick box at a time, in the same way as [SLICE_4_ACCEPTANCE.md](SLICE_4_ACCEPTANCE.md).

## What Slice 5 is, in plain words

Until now every group had the same upload form (Title, Type, an optional Subject). Now **you, the owner, choose it**:

- **Type options:** up to **5** kinds of file (for example Lecture notes, Lab record). **Other** is always added for you.
- **Extra details:** up to **3** more questions (for example Subject, Semester, Year). Each is either **Short text** (members type an answer) or a **Dropdown** (members pick from choices you write, 2 to 15 of them). Each can be **Required** or optional.
- **Title and Type** are always asked and always required. In total a form has **at most 5 fields**, and the editor shows a counter such as **4 of 5 fields used**.
- You see a **live preview** of what members will see while you edit.
- **Nothing changes until you press Save.** The **Use these defaults** button only fills the editor in; you still press **Save**.
- **Removing** something never deletes old files' details: files that already use it keep it and show it with **(removed)**. **Renaming** updates every old file at once.

You reach the editor **right after creating a group** (a new button on the **Group created** screen) and **later from Settings**. Only the owner can open it.

## What you need to set up

**Nothing at all.** This slice has **no database change** (the database was prepared in Slice 4), so there is **no migration to run**, nothing to type into Supabase, Vercel or Google. Just test on the preview address.

## How to read this guide

You need **two devices**: a **desktop browser** and a **phone**, and **two accounts**: you (the group owner) and a **second person** who is a plain member (a second account on the phone works well; use a private window so the two sign-ins do not mix).

**Where to test.** Test first on the **preview address** for the branch `feature/form-editor`, written below as `<preview address>`. **The developer gives you that address.** If you still see the words `<preview address>` in angle brackets, stop and ask the developer. After the merge, repeat the main tests on the live address, `https://study-share-amber.vercel.app`. Always open the site only from that address, never from the long links Vercel shows for one particular deployment. Test in a **private (incognito) window**.

**Files to use.** Any small real files (a PDF, a picture, a text file). You need about four uploads.

After most steps you will see **You should see**. If it looks different, write down what you saw and what you tapped, and tell the developer. Do not guess.

### The order, at a glance

- [ ] Test 1: Creating a group offers the setup step
- [ ] Test 2: Design a form (a type, a required dropdown, an optional text)
- [ ] Test 3: Members get exactly that form
- [ ] Test 4: Required and optional, and Other needs words
- [ ] Test 5: Edit the form later from Settings; rename and remove
- [ ] Test 6: The limits
- [ ] Test 7: Use these defaults
- [ ] Test 8: Unsaved changes and two tabs
- [ ] Test 9: Only the owner can open it
- [ ] Test 10: Phone checks

---

## Test 1: Creating a group offers the setup step

Do this on the **desktop**, signed in as the owner.

- [ ] **1.1** Create a new group (any name, **Link only** is simplest).
  - **You should see:** the **Group created** screen with the invite link and code, then a section **Next: your upload form** with a big dark button **Next: set up your upload form**. Under it are **Open the group** and **Create another group**.
- [ ] **1.2** Tap **Next: set up your upload form**.
  - **You should see:** the page **Upload form**, with the counter **3 of 5 fields used**, a locked **Title** box ("Always asked, and always required"), four type rows (**Notes**, **Previous year paper**, **Study material**, **Assignment**) plus a dotted row **Other: members say what it is**, one detail card **Subject**, a **What members will see** preview, and the buttons **Save** and **Use these defaults**. The **Settings** tab is lit.

## Test 2: Design a form (a type, a required dropdown, an optional text)

Stay on the editor. We will make a class form.

- [ ] **2.1** Under **Type options**, tap **Remove** (the bin) next to **Assignment**, then tap **Yes, remove Assignment**.
  - **You should see:** before you confirm, the line **Files that already use it keep it. It will not be offered for new uploads.** After you confirm, **Assignment** is gone.
- [ ] **2.2** Tap **Add a type**, and type **Lab record** in the new row.
  - **You should see:** the cursor is already in the new row. The preview's **Type** dropdown lists **Notes**, **Previous year paper**, **Study material**, **Lab record**, **Other**.
- [ ] **2.3** Tap **Add a detail**. Name it **Semester**, choose **Dropdown**, type **Sem 1** and **Sem 2** as the two choices, and switch **Required** on.
  - **You should see:** the counter says **4 of 5 fields used**, and the preview shows **Semester (required)** with **Choose one**, **Sem 1**, **Sem 2**.
- [ ] **2.4** On the **Subject** card, leave **Required** off.
  - **You should see:** the preview shows **Subject (optional)**. Its **Kind** says **Short text** and that it cannot be changed.
- [ ] **2.5** In the preview, choose **Other** in **Type**.
  - **You should see:** **What kind of file is it?** appears in the preview. The preview is only for looking: nothing is sent.
- [ ] **2.6** Tap **Save**.
  - **You should see:** **Saved. Members see this form the next time they upload.** and the line "You have changes that are not saved" goes away.

## Test 3: Members get exactly that form

Use the **second person** (on the phone). Add them to the group with the invite link first if they are not in it.

- [ ] **3.1** As the member, open the group, tap **Upload a file**.
  - **You should see:** **File**, **Title**, **Type** (Notes, Previous year paper, Study material, Lab record, Other), **Semester (required)** and **Subject (optional)**. Nothing else.
- [ ] **3.2** Choose **Other** in **Type**.
  - **You should see:** **What kind of file is it?** appears right under **Type**.

## Test 4: Required and optional, and Other needs words

Still as the member.

- [ ] **4.1** Choose a file, give a title, set **Type** to **Lab record**, leave **Semester (required)** on **Choose one** and tap **Upload**.
  - **You should see:** **Choose one.** under Semester, the cursor on it, nothing uploaded.
- [ ] **4.2** Set **Type** to **Other**, choose **Sem 1** and tap **Upload** with the Other box empty.
  - **You should see:** **Say what kind of file it is.** under the box.
- [ ] **4.3** Type **Lab manual** in the box and upload.
  - **You should see:** the Library row shows **Other: Lab manual** and **Semester: Sem 1**. Upload a second file as **Lab record** with **Sem 2** and **Subject** left empty: it uploads fine (Subject is optional).

## Test 5: Edit the form later from Settings; rename and remove

Back on the **desktop** as the owner.

- [ ] **5.1** Open the group, tap **Settings**.
  - **You should see:** a section **Upload form** with a short description and the button **Edit upload form**. Tap it: you are in the editor, showing the form you saved.
- [ ] **5.2** Rename **Lab record** to **Lab report**, rename the choice **Sem 2** to **Second term**, and tap **Save**. Then open the **Library**.
  - **You should see:** the old Lab record file now says **Lab report** and **Semester: Second term**. Renaming updates old files.
- [ ] **5.3** Back in the editor, remove **Lab report** (confirm), tap **Save**, and look at the Library.
  - **You should see:** the old file still shows **Lab report (removed)**. The Type filter still lists **Lab report (removed)** while a file uses it. Open **Upload a file**: **Lab report** is no longer offered.
- [ ] **5.4** Add a new type called **Lab report** again and save.
  - **You should see:** it is offered to new uploads. The old file stays with the **(removed)** one (it is not brought back).
- [ ] **5.5** Without reloading, change something and tap **Save** a second time.
  - **You should see:** it saves again with the same **Saved.** message.

## Test 6: The limits

In the editor (nothing needs saving for these, except where said).

- [ ] **6.1** Add types until you have 5.
  - **You should see:** **Add a type** greyed out, with **You can have up to 5 types. Remove one to add another.** under it.
- [ ] **6.2** Add extra details until you have 3.
  - **You should see:** **Add a detail** greyed out with **You can have up to 3 extra details. Remove one to add another.** The counter says **5 of 5 fields used**.
- [ ] **6.3** On a dropdown, add choices until you have 15.
  - **You should see:** **Add a choice** greyed out with **A dropdown can have up to 15 choices. Remove one to add another.**
- [ ] **6.4** Remove choices so a dropdown has just one, and tap **Save**.
  - **You should see:** **Add at least 2 choices.** under the dropdown, and nothing saved.
- [ ] **6.5** Give two types the same name (capitals and spaces do not matter, **Notes** and **notes**), and tap **Save**.
  - **You should see:** **You already have one with this name.** next to the second one, the cursor on it. Empty names say **Give this a name.**, and a type called **Other** says Other is added for you.

## Test 7: Use these defaults

- [ ] **7.1** Make some changes, then tap **Use these defaults**.
  - **You should see:** the form fills in with Notes, Previous year paper, Study material, Assignment and an optional Subject, and the message **Nothing is saved until you choose Save.**
- [ ] **7.2** Without saving, open **Upload a file** (accept the "leave this page" question).
  - **You should see:** the upload form still has your previous design. The defaults were not saved.
- [ ] **7.3** Go back to the editor, tap **Use these defaults**, then **Save**.
  - **You should see:** **Saved.** and the upload form now shows the default types and the optional Subject. Old files keep what they have (a removed detail shows as **(removed)**).

## Test 8: Unsaved changes and two tabs

- [ ] **8.1** Change a type name, then try to close the tab or tap a link such as **Back to settings**.
  - **You should see:** your browser asks whether to leave. Staying keeps your changes. After **Save**, no question is asked.
- [ ] **8.2** Open the editor in **two tabs**. In the first, rename a type and **Save**. In the second, rename something else and **Save**.
  - **You should see:** in the second tab: **This form was changed somewhere else (maybe in another tab). Nothing was saved. Reload the page to see the latest form, then make your changes again.** What you typed is still on the screen. After reloading, you see the first tab's version.
- [ ] **8.3** Try the keyboard: Tab to a **Move ... down** button and press Enter or Space.
  - **You should see:** the row moves and the cursor stays on that row's button.

## Test 9: Only the owner can open it

- [ ] **9.1** As the plain member, look at the group: there is no **Settings** tab. Type the editor address by hand (the group address followed by `/settings/upload-form`).
  - **You should see:** **This page could not be found.** (the same page as for an address that does not exist).
- [ ] **9.2** Do the same with a person who is not in the group.
  - **You should see:** the same not-found page.

## Test 10: Phone checks

On the **phone** as the owner (a narrow screen of about 360 pixels is the hardest case).

- [ ] **10.1** Open the editor.
  - **You should see:** you **cannot scroll sideways**. Each type row is a full-width box with the up, down and bin buttons beneath it, each button large enough to tap (at least 44 pixels).
- [ ] **10.2** Tap into a name box.
  - **You should see:** the page does not zoom in.
- [ ] **10.3** Make an error (leave a name empty) and tap **Save**.
  - **You should see:** a red message at the bottom, the marked box with its own message, and the cursor in the first marked box.
- [ ] **10.4** Look at the editor in both themes (the sun/moon button).
  - **You should see:** everything readable in the light and the dark theme.

---

## Known limits in Slice 5

These are by design. They are not bugs.

- **The kind of a detail cannot change** once it exists (Short text stays Short text). Remove it and add a new one.
- **A removed item is never brought back.** Adding the same name again makes a new item; old files stay with the removed one.
- **At most 30 removed items are kept** in each list. Past that, saving asks you to tidy up (very unlikely).
- **A change applies to uploads that start afterwards.** Someone halfway through an upload when you save is not made to start again.
- **The leave warning covers closing or reloading the tab and following links inside the site.** The browser's Back button is not covered.
- **"Use these defaults" can drop your own types and details from the form** (they become removed, so old files keep them). Read the form before pressing **Save**.
- **No database change**, so going back to the Slice 4 version of the site is harmless.
