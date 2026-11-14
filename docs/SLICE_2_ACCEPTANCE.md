# Slice 2 acceptance (owner guide): search and filters

This guide walks you through trying out everything Slice 2 added: a search box and two dropdowns (**Type** and **Subject**) above the Library list, so your group can find a file in seconds. It is written so you can follow it one tick box at a time, in the same way as [SLICE_1_ACCEPTANCE.md](SLICE_1_ACCEPTANCE.md).

## What Slice 2 adds

- **A search box.** Above the list, **Search files** looks in three places at once: the file's **title**, its **subject** and its **file name**. Capital letters do not matter. It looks for exactly what you typed, so a `%` or a `_` or a Hindi word is searched as it is.
- **A Type dropdown.** **All types**, or one of **Notes**, **Previous year paper**, **Study material**, **Assignment**, **Other**.
- **A Subject dropdown.** **All subjects**, or one of the subjects your group's files already use (for example Maths, Physics). You do not set these up: they come from the files people upload.
- **Everything combines.** Words in the search box, a type and a subject all narrow the list together.
- **A Clear link.** It shows only while a search or filter is on, and puts the whole list back.
- **The address remembers.** The search and filters are part of the page's web address, so reloading keeps the results, going **Back** goes to your earlier search, and you can send the address to a friend to show them the same results.
- **A friendly "nothing found".** When nothing matches you see "No files match your search. Try different words or clear the filters." with a button to clear.

## What you need to set up

**Nothing.** There is no database change in this slice (no migration) and nothing to type into Supabase, Vercel or Google. If Slice 1 works for you, this works.

## How to read this guide

You need **one account** (you, the group owner) and **a phone** as well as a **desktop browser**. A second person is not needed.

**Where to test.** Test first on the **preview address** for the branch `feature/slice-2-search-filters`, written below as `<preview address>`. **The developer gives you that address.** If you still see the words `<preview address>` in angle brackets, stop and ask the developer. After the merge, repeat the main tests on the live address, `https://study-share-amber.vercel.app`.

**Always open the site only from the correct address.** Use the preview address for these tests, and the live address after the merge. **Never** use the long links that Vercel shows for one particular deployment. Test in a **private (incognito) window**, so old sign-ins and saved pages cannot confuse the result.

**Files to use.** You need a group with **a handful of files that differ from each other**. If your test group already has some from Slice 1, add what is missing. Any small real files will do (a PDF, a picture, a text file). Upload these **five** (the file names matter for Test 3, so rename the files on your device before you pick them):

| File name on your device | Title | Type | Subject |
| --- | --- | --- | --- |
| `unit1.pdf` | **Unit 1 notes** | Notes | Physics |
| `board.png` | **Board diagram** | Previous year paper | Maths |
| `chapter-zebra.pdf` (any file, renamed) | **Algebra sheet** | Assignment | Maths |
| `hindi.txt` | **भौतिकी सार** (or any title in Hindi) | Notes | भौतिकी (or any Hindi subject) |
| `weird.txt` | **Tips 100% done** | Other | Odd chars |

(You can only start 15 uploads per hour, so five is plenty. If you already have other files in the group, the counts in this guide go up by the number of extra files that match: read "You should see" as "at least these".)

After most steps you will see **You should see** (what a correct result looks like). If it looks different, write down what you saw and what you tapped, and tell the developer. Do not guess.

### The order, at a glance

- [ ] Test 1: A group with no files has no search
- [ ] Test 2: Search by title
- [ ] Test 3: Search by subject and by file name
- [ ] Test 4: Filter by type
- [ ] Test 5: Filter by subject
- [ ] Test 6: Combine search and filters
- [ ] Test 7: Clear
- [ ] Test 8: Reload and Back keep the results
- [ ] Test 9: Nothing matches
- [ ] Test 10: Odd characters
- [ ] Test 11: More than 20 results
- [ ] Test 12: Phone checks

---

## Test 1: A group with no files has no search

Do this on the **desktop**, with a **brand new, empty group** (make one called **Empty Search**).

- [ ] **1.1** Open the new group's **Library** tab.
  - **You should see:** **No files yet** and an **Upload a file** button, and **no** search box and **no** Type or Subject dropdowns. (There is nothing to search yet.)
- [ ] **1.2** Now open your test group with the five files (upload them first if you have not yet).
  - **You should see:** above the list, a box **Search files** with a **Search** button, and below it two dropdowns **Type** and **Subject**. There is **no Clear** link yet.

## Test 2: Search by title

- [ ] **2.1** In **Search files**, type **unit** and press **Enter** (or tap **Search**).
  - **You should see:** a line **1 file matches "unit"** and one row, **Unit 1 notes**. The box still says **unit**. A **Clear** link has appeared.
- [ ] **2.2** Type **UNIT** in capitals and search again.
  - **You should see:** the same one file. Capital letters make no difference.
- [ ] **2.3** Look at the address bar.
  - **You should see:** the address now ends with something like `?q=UNIT`.

## Test 3: Search by subject and by file name

- [ ] **3.1** Search for **maths**.
  - **You should see:** **2 files match "maths"**: **Algebra sheet** and **Board diagram**. (Neither has "maths" in its title: it is found through the **subject**.)
- [ ] **3.2** Search for **zebra**.
  - **You should see:** **1 file matches "zebra"**: **Algebra sheet**. ("zebra" is in its **file name**, not its title.)
- [ ] **3.3** Search for **board.png**.
  - **You should see:** **Board diagram** only.

## Test 4: Filter by type

- [ ] **4.1** Tap **Clear**. In the **Type** dropdown choose **Notes**. Do **not** press anything else.
  - **You should see:** the list changes **by itself** as soon as you choose. The line says **2 files match your filters**, the rows are **भौतिकी सार** and **Unit 1 notes**, and the address has `type=notes`.
- [ ] **4.2** Choose **Assignment**.
  - **You should see:** only **Algebra sheet**.
- [ ] **4.3** Choose **All types**.
  - **You should see:** the filter is gone, all five files are back, and the **Clear** link disappears.

## Test 5: Filter by subject

- [ ] **5.1** Open the **Subject** dropdown.
  - **You should see:** **All subjects**, then **Maths**, **Odd chars**, **Physics** and your Hindi subject, each **once** (even if several files share it).
- [ ] **5.2** Choose **Maths**.
  - **You should see:** **2 files match your filters**: **Algebra sheet** and **Board diagram**.
- [ ] **5.3** Choose your **Hindi subject**.
  - **You should see:** the one Hindi file. Reload the page (**F5**): the dropdown still shows the Hindi subject and the same file.

## Test 6: Combine search and filters

- [ ] **6.1** Choose **Maths** as the subject. Then type **board** in the search box and choose **Previous year paper** as the type.
  - **You should see:** **1 file matches "board" and your filters**: **Board diagram**. The address holds all three: `q`, `type` and `subject`. (The words you typed were kept when you changed the dropdown.)
- [ ] **6.2** Change the type to **Notes**.
  - **You should see:** the empty message of Test 9 (nothing is a Notes file in Maths named "board").

## Test 7: Clear

- [ ] **7.1** With any search or filter on, tap **Clear**.
  - **You should see:** the search box is empty, both dropdowns say **All ...**, all five files show, the **Clear** link is gone, and the address has no `?` part any more.

## Test 8: Reload and Back keep the results

- [ ] **8.1** Search for **unit**. Then search for **maths**. Then reload the page (**F5**).
  - **You should see:** after the reload you are still looking at the **maths** results, and the box still says **maths**.
- [ ] **8.2** Tap your browser's **Back** button once.
  - **You should see:** the **unit** results and **unit** in the box. Back once more shows the full list.
- [ ] **8.3** Search for **maths**, copy the address, and open it in another private window (signed in as you).
  - **You should see:** the same results, ready.

## Test 9: Nothing matches

- [ ] **9.1** Search for **qwertyuiop**.
  - **You should see:** a box with **No files match** and the sentence **"No files match your search. Try different words or clear the filters."**, and a button **Clear search and filters**. The search box and dropdowns stay in place so you can change them. You do **not** see the "No files yet" box (that one is only for a group with no files).
- [ ] **9.2** Tap **Clear search and filters**.
  - **You should see:** the full list again.

## Test 10: Odd characters

- [ ] **10.1** Search for **%** (the percent sign).
  - **You should see:** only **Tips 100% done**. (It is searched as a letter, not as "anything".)
- [ ] **10.2** Search for **भौतिकी** (copy the Hindi word from your file).
  - **You should see:** the Hindi file.
- [ ] **10.3** Search for **"** (a quote mark), then **&**, then **<b>hello</b>**.
  - **You should see:** each time, a normal page. For `<b>hello</b>` the box shows the characters exactly as typed and the page says nothing matches (the letters never turn bold).
- [ ] **10.4** Type 150 letters (for example hold down **a**) into the box.
  - **You should see:** the box stops at 100 letters.

## Test 11: More than 20 results

This is only needed if you want to check paging. Skip it if you do not feel like uploading 21 files (the developer's automatic tests check it).

- [ ] **11.1** In a group that has **more than 20** files with the word **file** in the title, search for **file**.
  - **You should see:** **Showing 20 files that match "file"** and a **Show more** button. (No total is shown: the site shows what is on the page and never guesses.)
- [ ] **11.2** Tap **Show more**.
  - **You should see:** the rest, with **Showing N more files ...**, the box still holding **file**, and a link **Back to the newest files**. Tapping that link returns to the first 20 of the **same** search.
- [ ] **11.3** On that second page, change a dropdown.
  - **You should see:** you are back on the **first** page of the new results (a new search always starts at the beginning).

## Test 12: Phone checks

Do these on the **phone** (a narrow screen of about 360 pixels is the hardest case).

- [ ] **12.1** Open the Library with several files.
  - **You should see:** the search box with the **Search** button next to it, then **Type** and **Subject** one under the other, all easy to tap (at least as tall as your fingertip). **You cannot scroll sideways.**
- [ ] **12.2** Tap the search box.
  - **You should see:** the page does not zoom in, and the keyboard has a **Search** (or magnifier) key. Type a word and tap that key: the results appear.
- [ ] **12.3** Tap **Type** and choose one.
  - **You should see:** your phone's own picker opens, and after you pick, the list updates by itself.
- [ ] **12.4** Choose a very long subject, or search for a very long word.
  - **You should see:** nothing runs off the screen.
- [ ] **12.5** Switch to the dark theme (the sun/moon button).
  - **You should see:** the search area is easy to read in both themes.

---

## Known limits in Slice 2

These are by design. They are not bugs.

- **No total.** For a search with more than one page the site says "Showing 20 files" and offers **Show more**. It does not say "of 135", because counting would slow the list down.
- **The search looks for your text inside the title, subject and file name.** It does not guess spelling mistakes or look inside the files' contents.
- **Subjects that differ only by capital letters count as one.** "Maths" and "maths" appear once in the dropdown (the filter ignores capitals).
- **The dropdowns only list subjects of files that exist.** When the last file of a subject is deleted, the subject disappears from the dropdown.
- **Without JavaScript** (rare) you choose a type or subject and then tap **Search**; the dropdowns do not update by themselves.
