# Slice 4 acceptance (owner guide): the upload form follows the group

This guide walks you through trying out everything Slice 4 changed: **every group now has its own upload form behind the scenes**, and the Library, the file page and the filters read from it. It is written so you can follow it one tick box at a time, in the same way as [SLICE_2_ACCEPTANCE.md](SLICE_2_ACCEPTANCE.md).

## What Slice 4 is, in plain words

This is the first half of a bigger feature: **each group owner will design the upload form for their own group** (the kinds of file, and extra details such as Semester or Year). This slice builds the foundation underneath and moves everything onto it. **The owner's form editor comes in the next slice (Slice 5).** Until then **every group has the same default form**, so for you almost nothing looks different. That is on purpose: the point of this slice is that nothing breaks while the ground moves.

What you will notice:

- **Choosing the type "Other" now needs a few words.** A box **What kind of file is it?** appears right under **Type**. You must fill it in (up to 40 letters), for example **Lab manual**. The list then shows **Other: Lab manual**.
- **The list shows details as small labels.** A file row now shows its type, then labels such as **Subject: Physics**, instead of a bare word.
- **Wording in the filters.** The first entry of the Subject dropdown now reads **Any subject** (it used to say "All subjects"). **Type** still starts with **All types**.
- **The search box hint** now reads **Search by title, details or file name**. Search also finds a file by its **type** (searching "previous" finds your Previous year paper files).
- **Old files are untouched.** Every file from Slices 1 to 3 keeps its type and its subject, and you can still find it by search and filter.

What you will **not** see yet: any place to change the form. No new page, no new button.

## What you need to set up

**Nothing to type into Supabase, Vercel or Google.** But **this slice needs a database change on production before it is merged**: migration **0007** adds the form to every group and the new answers to every file (and copies each old file's type and subject across, so nothing is lost). **The developer runs it** (a command, like migrations 0004 to 0006), after you have tested on the preview and before you say "merge". If the Library shows an error page on the preview instead of your files, tell the developer: the migration has probably not been run on the database the preview uses.

## How to read this guide

You need **one account** (you, the group owner), **a desktop browser** and **a phone**. A second person is not needed.

**Where to test.** Test first on the **preview address** for the branch `feature/custom-upload-form`, written below as `<preview address>`. **The developer gives you that address.** If you still see the words `<preview address>` in angle brackets, stop and ask the developer. After the merge, repeat the main tests on the live address, `https://study-share-amber.vercel.app`.

**Always open the site only from the correct address.** Use the preview address for these tests, and the live address after the merge. **Never** use the long links that Vercel shows for one particular deployment. Test in a **private (incognito) window**, so old sign-ins and saved pages cannot confuse the result.

**Which group.** Use a group that **already has files from Slices 1 to 3** (that is how you check that old files survived). If you have none, make a new group; Test 6 then only covers the new files.

**Files to use.** Any small real files (a PDF, a picture, a text file). You can only start 15 uploads per hour; this guide needs about eight.

After most steps you will see **You should see** (what a correct result looks like). If it looks different, write down what you saw and what you tapped, and tell the developer. Do not guess.

### The order, at a glance

- [ ] Test 1: The upload form looks the same, with one new rule for Other
- [ ] Test 2: Upload with each of the four ordinary types
- [ ] Test 3: Other needs a description
- [ ] Test 4: Subject is still optional
- [ ] Test 5: Filter by Type and by Subject
- [ ] Test 6: Old files from Slices 1 to 3 still show and still turn up in search
- [ ] Test 7: Edit an old file
- [ ] Test 8: Phone checks

---

## Test 1: The upload form looks the same, with one new rule for Other

Do this on the **desktop**.

- [ ] **1.1** Open your group, go to the **Library** tab and tap **Upload a file**.
  - **You should see:** the same form as before: **File**, **Title**, **Type**, and **Subject (optional)**.
- [ ] **1.2** Open the **Type** dropdown.
  - **You should see:** **Notes**, **Previous year paper**, **Study material**, **Assignment**, **Other**, in that order.
- [ ] **1.3** Choose **Other**.
  - **You should see:** a new box **What kind of file is it?** appears **right under Type** (above Subject). Choose **Notes** again: the box goes away.

## Test 2: Upload with each of the four ordinary types

- [ ] **2.1** Upload four small files, one for each of **Notes**, **Previous year paper**, **Study material** and **Assignment** (give them titles such as **Test Notes**, **Test Paper**, **Test Material**, **Test Assignment**; leave **Subject** empty).
  - **You should see:** after each upload you are back in the Library with "Your file is shared with the group." Each new row shows its own type (**Notes**, **Previous year paper**, and so on) and **no** Subject label.

## Test 3: Other needs a description

- [ ] **3.1** Start another upload. Choose a file, set **Type** to **Other** and leave **What kind of file is it?** empty. Tap **Upload**.
  - **You should see:** the message **Say what kind of file it is.** under the box, the cursor in the box, and nothing uploaded (you stay on the form).
- [ ] **3.2** Type **Lab manual** and tap **Upload**.
  - **You should see:** you are back in the Library and the new row shows **Other: Lab manual** (not just "Other"). Open the file: the page shows **Other: Lab manual** too.
- [ ] **3.3** Start one more upload with **Other** and paste a very long sentence (more than 40 letters) into the box. Tap **Upload**.
  - **You should see:** **Use 40 characters or fewer.** under the box, and nothing uploaded.

## Test 4: Subject is still optional

- [ ] **4.1** Upload a file (type **Notes**) with **Subject (optional)** left empty.
  - **You should see:** it uploads, and its row has no Subject label.
- [ ] **4.2** Upload another with the subject **Physics**.
  - **You should see:** its row shows a small label **Subject: Physics**.
- [ ] **4.3** Start another upload and click into **Subject (optional)**.
  - **You should see:** your group's earlier subjects are offered as suggestions while you type, and a line under the box saying to pick one the group already uses to keep the library tidy.

## Test 5: Filter by Type and by Subject

- [ ] **5.1** In the Library, open the **Type** dropdown above the list.
  - **You should see:** **All types**, **Notes**, **Previous year paper**, **Study material**, **Assignment**, **Other**.
- [ ] **5.2** Choose **Other**.
  - **You should see:** the list changes by itself and shows only your **Other: Lab manual** file (and any other Other files).
- [ ] **5.3** Choose **All types**, then open the **Subject** dropdown.
  - **You should see:** **Any subject** first, then the subjects your group uses (each once), for example **Physics**.
- [ ] **5.4** Choose **Physics**, then also choose the type **Notes**.
  - **You should see:** both filters work together, a line says how many files match your filters, and the address ends with something like `?type=notes&d_subject=Physics`.
- [ ] **5.5** Tap **Clear**.
  - **You should see:** the whole list is back and **Clear** disappears.
- [ ] **5.6** Search for **previous** in the search box.
  - **You should see:** your **Test Paper** file, the one of type **Previous year paper** (found through its **type**, since the word is not in its title).

## Test 6: Old files from Slices 1 to 3 still show and still turn up in search

- [ ] **6.1** Look at the files you uploaded **before** this slice.
  - **You should see:** each one is still in the list with the type it had. If it had a subject, it shows as **Subject: <that subject>**. An old file of type Other simply says **Other** (it never had a description, and that is fine).
- [ ] **6.2** Pick an old file's subject and choose it in the **Subject** dropdown; then search for one word of an old file's title.
  - **You should see:** the old files are found both ways.
- [ ] **6.3** Open an old file.
  - **You should see:** the file page shows its type and subject as before, and **Preview** and **Download** still work.
- [ ] **6.4** (Optional) If you saved a Library web address from Slice 2 that ends in `?subject=Maths` (or any subject), open it.
  - **You should see:** the list is still filtered by that subject, as before.

## Test 7: Edit an old file

Edit one of **your own** old files (only the person who uploaded a file can edit it).

- [ ] **7.1** Open one of your old files and look at **Edit details**.
  - **You should see:** its **Title**, its **Type** and its **Subject (optional)** filled in. If it was an old **Other** file, the **What kind of file is it?** box is there, **empty**.
- [ ] **7.2** Change only the title (leave an old **Other** file's box empty) and tap **Save details**.
  - **You should see:** **Saved.** and the new title. An old Other file saves **without** being forced to add words (you only need them when you change the type to Other or edit the words).
- [ ] **7.3** Change the type to **Assignment** and the subject to something new, and save.
  - **You should see:** **Saved.**, and the file page and the Library row show the new type and subject.

## Test 8: Phone checks

Do these on the **phone** (a narrow screen of about 360 pixels is the hardest case).

- [ ] **8.1** Open the upload form and choose **Other**.
  - **You should see:** **What kind of file is it?** appears under **Type**, large enough to tap, and **you cannot scroll sideways**. Tapping the box does not zoom the page in.
- [ ] **8.2** Open the Library with several files.
  - **You should see:** the type and **Subject: ...** labels wrap neatly inside each row; nothing runs off the screen. Under the search box, **Type** and **Subject** sit one under the other and are easy to tap.
- [ ] **8.3** Tap **Type** and choose one.
  - **You should see:** your phone's own picker opens, and the list updates by itself after you pick.
- [ ] **8.4** Open an old file and its **Edit details**, and look at both themes (the sun/moon button).
  - **You should see:** everything readable in the light and the dark theme.

---

## Known limits in Slice 4

These are by design. They are not bugs.

- **No form editor yet.** You cannot change the types or add details like Semester. That is **Slice 5**. Until then every group has the same form.
- **"Other" on an old file stays plain.** Files uploaded before this slice as Other have no description; they show **Other**, and you can add one by editing the file.
- **Capital letters do not matter in the Subject filter.** "Maths" and "maths" count as one subject.
- **The Subject dropdown only lists subjects of files that exist.** When the last file with a subject is deleted, the subject leaves the dropdown.
- **Going back to the old version of the site is not supported** once the database change has been made for a group that has been given its own form (nobody can do that yet), so there is no practical risk today.
