# Slice 1 acceptance (owner guide): upload and library

This guide walks you through trying out everything Slice 1 added: sharing a file with your group, seeing the group's files in the Library, previewing and downloading them, editing a file's details and deleting files. It is written so you can follow it one tick box at a time, in the same way as [PHASE_1C_ACCEPTANCE.md](PHASE_1C_ACCEPTANCE.md).

## What Slice 1 adds

- **Upload a file.** Any member can share one file at a time. They give it a **Title**, a **Type** (Notes, Previous year paper, Study material, Assignment or Other) and, if they like, a **Subject**. A progress bar shows the upload.
- **The Library.** The group's **Library** tab lists the files, newest first: title, type, subject, who shared it, size and date. Tap one to open it. Groups with many files show 20 at a time with a **Show more** button.
- **Preview and download.** PDFs and pictures (PNG, JPG, GIF, WebP) show right on the page. Every file has a **Download** button.
- **Edit and delete.** The person who uploaded a file can change its title, type and subject, and can delete it. The **group owner** can delete **anybody's** file but cannot change other people's details.
- **Only members.** A person who is not in the group, or who was removed from it, cannot open a file or its links. They see "This page could not be found."

**Where the files live.** Files are stored in **Supabase Storage**, in a private bucket. Nobody can open a file by guessing an address: every preview and download link is made fresh, for a few minutes, after the site has checked that you are a member.

**The limits.** Each file can be **at most 25 MB**. Allowed kinds: PDF, Word (.doc, .docx), PowerPoint (.ppt, .pptx), Excel (.xls, .xlsx), plain text (.txt), CSV, and pictures (.png, .jpg, .jpeg, .gif, .webp). Anything else (programs, web pages, ZIP files, SVG pictures) is refused on purpose.

## What you need to set up

**Nothing new to type into Supabase, Vercel or Google.** Two things must already be in place. Both are the **developer's** job, not yours:

- **The database migration for this slice (0005) must have been run on the database the preview uses.** Without it the Library cannot load.
- **The storage bucket must accept uploads from the site's address.** The developer checks this with the storage check command before you start. If every upload you try ends with **"The upload didn't finish. Check your connection, then choose Upload to try again."** even on a good connection, tell the developer: this is the sign that the bucket is not letting the site send files to it.

## How to read this guide

You need **two devices**: a **phone** and a **desktop browser** (or two phones). You need **three accounts**:

- **You (owner)**: the group owner, signed in as yourself.
- **Friend A**: a second account in the same group (a plain member).
- **A stranger**: a third account that is **not** in the group. (You can skip the stranger and use the person you remove in Test 7.)

A plus-address such as `you+a@gmail.com` counts as its own account. Use real addresses you can read in an inbox. Make one group (for example **Maths Circle**, link-only saves typing a password) and let Friend A join it with the invite link or the code, as in the Phase 1b guide.

**Where to test.** Test first on the **preview address** for the branch `feature/slice-1-upload-library`, written below as `<preview address>`. **The developer gives you that address.** If you still see the words `<preview address>` in angle brackets, stop and ask the developer. After the merge, repeat the main tests on the live address, `https://study-share-amber.vercel.app`.

**Always open the site only from the correct address.** Use the preview address for these tests, and the live address after the merge. **Never** use the long links that Vercel shows for one particular deployment. Test in a **private (incognito) window**, so old sign-ins and saved pages cannot confuse the result. Each person needs their own private window or device.

**Files to use.** Have these ready on your devices (any real ones will do):

- a small **PDF** (a few pages of notes is fine),
- a **picture** (a photo or a screenshot, PNG or JPG),
- a **Word document or a text file**,
- on the desktop, a plain text file that you **rename to end in `.pdf`** (right-click, Rename, change `.txt` to `.pdf`) for Test 6,
- optionally, a file bigger than 25 MB.

After most steps you will see **You should see** (what a correct result looks like). If it looks different, there is an **If it looks different** hint, or write down what you saw and what you tapped and tell the developer. Do not guess.

### The order, at a glance

- [ ] Test 1: Upload a PDF
- [ ] Test 2: Upload an image and see the preview
- [ ] Test 3: A second person sees both files and downloads
- [ ] Test 4: Edit your own details, but not other people's
- [ ] Test 5: Delete your own file; the owner deletes someone else's
- [ ] Test 6: A file with the wrong type is refused
- [ ] Test 7: A person removed from the group can no longer open a file link
- [ ] Test 8: Phone checks

---

## Test 1: Upload a PDF

Do this as the **owner**, on the **desktop**.

- [ ] **1.1** Open the group and look at the **Library** tab (the first tab).
  - **You should see:** a heading **Library**, a button **Upload a file** at the right of it, and below, a box saying **No files yet** and "Be the first to share something." with a second **Upload a file** button.
- [ ] **1.2** Tap **Upload a file**.
  - **You should see:** a page **Upload a file** with a big dashed file picker (**File**), a **Title** box, a **Type** choice already set to **Notes**, a **Subject (optional)** box and an **Upload** button. Under the picker it says which kinds of file are allowed and "Up to 25 MB."
- [ ] **1.3** Choose your PDF with the file picker.
  - **You should see:** the **Title** box fills in with the file's name without `.pdf`.
- [ ] **1.4** Change the title to **Unit 1 notes**. Choose your PDF again.
  - **You should see:** the title stays **Unit 1 notes** (it only fills itself in while you have not typed your own).
- [ ] **1.5** Type **Physics** into **Subject (optional)**. When you click in the box, you may see suggestions: for a brand new group there are none yet. Tap **Upload**.
  - **You should see:** a progress bar and the words **Uploading** with a number going up to 100%, then **Checking your file…**. The button is greyed out while this happens. Then you land on the **Library**, with a green-tinted message **"Your file is shared with the group."**
  - **If it looks different:** a red message such as **"The upload didn't finish. Check your connection, then choose Upload to try again."** means the file did not reach storage. Tap **Upload** again. If it fails every time, see "What you need to set up" above.
- [ ] **1.6** Look at the list.
  - **You should see:** one row: **Unit 1 notes**, a small label **Notes**, **Physics**, your name, the size (for example **1.2 MB**) and today's date.
- [ ] **1.7** Tap the row.
  - **You should see:** a page with **Unit 1 notes** as the big heading, the same details underneath, a **Download** button, and the PDF shown in a frame. Below the frame is a link **Open in a new tab**.
  - **If it looks different:** on some phones the PDF frame is blank or shows only the first page. That is the phone's PDF viewer, not a fault. **Open in a new tab** and **Download** always work.

## Test 2: Upload an image and see the preview

- [ ] **2.1** Go back to the Library (the **Back to the library** link, or the **Library** tab). Tap **Upload a file** and choose your picture. Set **Type** to **Previous year paper** and leave Subject empty. Tap **Upload**.
  - **You should see:** the Library again with the success message and now **two** rows. The picture is first (newest first).
- [ ] **2.2** Tap the picture's row.
  - **You should see:** the heading, a **Download** button and the **picture itself** shown on the page (not too tall for the screen), plus **Open in a new tab**. The type label reads **Previous year paper**.
- [ ] **2.3** Upload a Word document or a text file the same way, then open it.
  - **You should see:** a **Download** button and the sentence "This kind of file can't be shown in the browser. Use Download to open it on your device." There is no preview frame.

## Test 3: A second person sees both files and downloads

Do this as **Friend A** on the **phone**.

- [ ] **3.1** Sign in as Friend A, open the group, and tap the **Library** tab.
  - **You should see:** all the files the owner uploaded, each with **the owner's name** as the person who shared it.
- [ ] **3.2** Open the PDF and tap **Download**.
  - **You should see:** the PDF downloads (or opens in the phone's viewer, with the option to save it). It is the right file with the right name.
- [ ] **3.3** Open the picture and tap **Download**.
  - **You should see:** the picture downloads or opens, and it is the same picture you uploaded.
- [ ] **3.4** Wait **ten minutes** on the PDF page, then tap **Download** again.
  - **You should see:** it still works. (The links on the page never go stale: each tap makes a new short-lived link.)
- [ ] **3.5** On the owner's PDF page, look for **Edit details** and **Delete file**.
  - **You should see:** **neither.** Friend A can only look at and download other people's files.

## Test 4: Edit your own details, but not other people's

- [ ] **4.1** As **Friend A**, upload a picture or PDF of your own, with the title **Ravi's sheet** (or any name), Type **Notes**, no subject.
  - **You should see:** it appears at the top of the Library with Friend A's name.
- [ ] **4.2** Tap it. Below the preview there is a section **Edit details** with **Title**, **Type** and **Subject (optional)** filled in. Empty the **Title** and tap **Save details**.
  - **You should see:** a red message **"Give the file a title."** under the box, and nothing is saved.
- [ ] **4.3** Type the title **Algebra sheet**, set **Type** to **Assignment**, type **Maths** into **Subject (optional)**, and tap **Save details**.
  - **You should see:** a message **"Saved."**, and the big heading at the top of the page now reads **Algebra sheet**, with **Assignment** and **Maths** in the details line.
- [ ] **4.4** Open the Library.
  - **You should see:** the row shows **Algebra sheet**, **Assignment** and **Maths**.
- [ ] **4.5** As the **owner**, open Friend A's **Algebra sheet**.
  - **You should see:** **no Edit details section** (not even the owner can change other people's details). You will see a **Delete file** section: that is Test 5.
- [ ] **4.6** As the owner, upload one more file and, in **Subject (optional)**, tap the box.
  - **You should see:** suggestions such as **Maths** and **Physics**, the subjects the group already uses. Picking one saves you typing it the same way every time.

## Test 5: Delete your own file; the owner deletes someone else's

- [ ] **5.1** As **Friend A**, open **Algebra sheet**, scroll down to **Delete file** and tap **Delete file…**.
  - **You should see:** a panel slides up with the title **Delete Algebra sheet?**, the words "It disappears for everyone in the group and cannot be brought back.", a red button **Yes, delete Algebra sheet** and **Cancel**. The cursor starts on **Cancel**, not on the red button.
- [ ] **5.2** Tap **Cancel**.
  - **You should see:** the panel closes and the file is still there.
- [ ] **5.3** Tap **Delete file…** again, then **Yes, delete Algebra sheet**.
  - **You should see:** you land on the **Library** with the message **"The file was deleted."** and the file is gone from the list.
- [ ] **5.4** Upload another file as Friend A (call it **Friend A's second**). As the **owner**, open it, scroll to **Delete file**.
  - **You should see:** "You can delete this file because you own the group." and a **Delete file…** button.
- [ ] **5.5** Tap **Delete file…**, read the panel, then tap **Yes, delete Friend A's second**.
  - **You should see:** the owner lands on the Library with **"The file was deleted."** The panel says that as the owner you can delete anyone's file.
- [ ] **5.6** As **Friend A**, reload the Library.
  - **You should see:** **Friend A's second** is gone. Open its old address (copied before it was deleted): **"This page could not be found."**

## Test 6: A file with the wrong type is refused

Do this on the **desktop**.

- [ ] **6.1** On the upload page, choose a file that the site does not take: a program (`.exe`), a ZIP file (`.zip`) or an SVG picture. (You may need to switch the file picker from "Custom files" to "All files".)
  - **You should see:** **at once**, before you tap Upload, a red message under the picker: **"That kind of file can't be shared here. Use a PDF, Word, PowerPoint, Excel, text or CSV file, or an image (PNG, JPG, GIF or WebP)."** Tapping **Upload** does nothing but show the message again.
- [ ] **6.2** Choose the text file you **renamed to end in `.pdf`**. Fill in a title and tap **Upload**.
  - **You should see:** the upload runs, and then a red message: **"That file does not look like a PDF. Check that it is the right file, then upload it again."** You stay on the upload page and the **Upload** button works again.
- [ ] **6.3** Check the Library.
  - **You should see:** the refused file is **not** listed.
- [ ] **6.4** Without reloading, choose your real PDF and tap **Upload**.
  - **You should see:** it works and you land on the Library. A refused file never blocks the next try.
- [ ] **6.5** Optional: choose a file **bigger than 25 MB**.
  - **You should see:** at once, a red message **"That file is larger than 25 MB. Choose a smaller one."**

## Test 7: A person removed from the group can no longer open a file link

- [ ] **7.1** As **Friend A**, open one of the owner's files and **copy its address** from the address bar. Also copy the address of its **Download** link (press and hold it, or right-click, and choose copy link address).
- [ ] **7.2** As the **owner**, open **Members**, tap **Remove** next to Friend A and confirm with **Yes, remove ...**.
- [ ] **7.3** As **Friend A**, paste the file's address into the address bar.
  - **You should see:** **"This page could not be found."** The file's name does not appear anywhere.
- [ ] **7.4** As **Friend A**, paste the **Download** address.
  - **You should see:** **"Not found"** (a plain page), and no file downloads.
- [ ] **7.5** As the **stranger** (an account that never joined), paste the file's address and the Download address.
  - **You should see:** exactly the same two results as in 7.3 and 7.4.
- [ ] **7.6** In a private window where **nobody is signed in**, paste the Download address.
  - **You should see:** the **log in** page, not the file.

## Test 8: Phone checks

Do these on the **phone** (a narrow screen of about 360 pixels is the hardest case).

- [ ] **8.1** Open the Library with several files, one of them with a very long title (type about 100 letters without spaces when you upload it) and a long subject.
  - **You should see:** each row fits the screen. The long title wraps onto more lines. **You cannot scroll sideways** (swipe left and right to check). The **Upload a file** button is big and easy to tap.
- [ ] **8.2** Open the upload page, tap the file picker, and choose a picture from your phone's gallery or take one with the camera.
  - **You should see:** the title fills in, the keyboard does not zoom the page when you tap a box, and the **Upload** button is easy to tap. While uploading, the progress bar and the percentage are visible without scrolling.
- [ ] **8.3** Turn on **airplane mode** just after tapping **Upload** on a larger file (or before tapping it), then turn it off.
  - **You should see:** a red message **"The upload didn't finish. Check your connection, then choose Upload to try again."**, and the button works again. Tap **Upload** once more with the connection back: it finishes. The failed try left nothing in the Library.
- [ ] **8.4** Open a file page with a picture, then one with a PDF.
  - **You should see:** the picture fits the width of the screen, the PDF frame fits too, and the **Download**, **Open in a new tab**, **Save details** and **Delete file…** buttons are all easy to tap. The tabs at the bottom stay: **Library** is still the highlighted one while you are on the upload page or a file page.
- [ ] **8.5** Open **Delete file…** with a file that has a long title.
  - **You should see:** the panel fits the screen and the long title wraps. **Cancel** works, and the page behind does not move sideways.
- [ ] **8.6** Check the dark theme (the sun/moon button at the top).
  - **You should see:** the Library, the upload page and a file page are easy to read in both themes.

---

## Known limits in Slice 1

These are by design. They are not bugs.

- **No search or filters yet.** The Library is a plain list, newest first. Search, filters by type and subject come in Slice 2.
- **One file at a time.** There is no multiple upload.
- **"Show more" replaces the page.** For a group with more than 20 files, **Show more** opens the next 20, and **Back to the newest files** takes you back. (You will only meet this once a group has more than 20 files.)
- **Deleted and half-sent files stay in the database as hidden rows.** A file whose upload was cut off is never shown anywhere, but its row is not cleaned up automatically yet. Files of a deleted group stay in storage too. Neither affects a friend group.
- **Dates use UTC.** A file shared in the early morning in India (before 5:30) can show the previous day's date. That is the time zone of the server, not a mistake in the file.
- **Storage is the Supabase free plan: 1 GB in total.** Tell the developer if it fills.
