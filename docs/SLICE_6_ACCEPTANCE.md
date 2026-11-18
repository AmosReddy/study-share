# Slice 6 acceptance (owner guide): private chats between two members

This guide walks you through trying out everything Slice 6 added: **two members of a group can now chat privately, and nobody else can see it, not even you as the group owner**. It is written so you can follow it one tick box at a time, in the same way as [SLICE_5_ACCEPTANCE.md](SLICE_5_ACCEPTANCE.md).

## What Slice 6 is, in plain words

- **Message button:** in the **Members** tab, every other member's row now has a **Message** button. Tapping it opens (or starts) a private chat with just that person. Your own row has no button.
- **Only the two of them:** nobody else can read, find or even learn about the chat. That includes the group owner, the other members and people from other groups.
- **It works like the group chat:** text only, new messages appear by themselves every few seconds, you can delete **your own** messages (not the other person's), and it works on a small phone screen.
- **A Group | Private switch** at the top of the **Chat** tab. **Private** is your list of private chats, newest first, each with the other person's name, the start of the last message, and how long ago it was.
- **Unread dots and a banner, wherever you are in the group:** when someone writes to you privately, a small red dot shows on the **Chat** tab, on **Private**, on the chat's row, and on that person's row in **Members**, and the **Chat** page shows a box **New private message from <name>** with an **Open** button. It appears by itself within about **10 to 15 seconds**, on the Library, Members or Chat tab, with no reload.
- **A chat appears only once someone writes in it.** Tapping **Message** and writing nothing leaves no trace for the other person (or for you in the list).
- **When one of you leaves the group or is removed:** the person who stays can still **read** the conversation but cannot reply. The person who left cannot open it. If they join the group again later, they get the same conversation back.

## What you need to set up

**Nothing to type into Supabase, Vercel or Google.** But **this slice needs a database change on production before it is merged**: migration **0008** adds the three tables that hold private chats, their messages and who has read what. **The developer runs it** (a command, like the earlier migrations), after you have tested on the preview and before you say "merge", and then the merge follows straight away. If the **Chat** or **Members** tab shows an error page on the preview, tell the developer: the migration has probably not been run on the database the preview uses. (The group chat itself does not depend on it.)

## How to read this guide

You need **three accounts** on **two devices**: a **desktop browser** and a **phone**.

- **You** (the group owner) on the desktop.
- **Person B**, a plain member, on the phone. A private (incognito) window with a second account works well.
- **Person C**, another plain member, in a second private window on the desktop (a different account).

**Where to test.** Test first on the **preview address** for the branch `feature/private-chats`, written below as `<preview address>`. **The developer gives you that address.** If you still see the words `<preview address>` in angle brackets, stop and ask the developer. After the merge, repeat the main tests on the live address, `https://study-share-amber.vercel.app`. Always open the site only from that address, never from the long links Vercel shows for one particular deployment.

**Set-up for the tests.** Create a group (any name, **Link only** is simplest) as yourself, and put **B** and **C** in it with the invite link or code.

After most steps you will see **You should see**. If it looks different, write down what you saw and what you tapped, and tell the developer. Do not guess.

### The order, at a glance

- [ ] Test 1: Start a chat from Members
- [ ] Test 2: Reply, and the chat updates by itself
- [ ] Test 3: Unread dots and the banner appear and clear
- [ ] Test 4: Nobody else can see it
- [ ] Test 5: Delete your own message
- [ ] Test 6: A removed member loses access, the other person reads only
- [ ] Test 7: Leaving and joining again
- [ ] Test 8: Phone checks

---

## Test 1: Start a chat from Members

Use **B on the phone**.

- [ ] **1.1** Open the group and tap **Members**.
  - **You should see:** a **Message** button on **your owner's row and on C's row**, and **no** button on B's own row (the row marked **You**).
- [ ] **1.2** Tap **Message** next to your name (the owner).
  - **You should see:** a chat page with your name as the title, a link **Back to private chats**, the text **No messages yet. Say hello to ...**, and a box **Write a message** above the tab bar. The **Chat** tab is lit.
- [ ] **1.3** On the **desktop**, as the owner, open **Chat** and tap **Private**.
  - **You should see:** **No private chats yet. Open the Members tab and tap someone to message them.** Nobody has written anything yet, so B's chat is not listed, and nothing shows on **Chat**, **Private** or **Members**.
- [ ] **1.4** On the **phone**, write **Hello, do you have last year's paper?** and send it.
  - **You should see:** your message on the right in the dark colour, with the time under it.

## Test 2: Reply, and the chat updates by itself

- [ ] **2.1** On the **desktop**, stay on the **Private** list and do not reload.
  - **You should see:** within about **3 to 5 seconds** a row appears with **B's name** and the start of the message, **a few seconds** or **just now** at the right, and a red dot.
- [ ] **2.2** Tap the row, then write **Yes, sending it now** and send it.
  - **You should see:** your message on the right. On the **phone**, without touching anything, your reply appears on the left within a few seconds.
- [ ] **2.3** On the phone, write a message with two lines (use the Enter key on a computer with **Shift** held, or just the Enter key on a phone), then a very long text of about 2000 letters.
  - **You should see:** line breaks kept as written on both screens. The box stops at **2000** characters and a counter such as **2000/2000** shows near the end. Nothing scrolls sideways.

## Test 3: Unread dots appear and clear

- [ ] **3.1** On the **desktop**, as the owner, open the **Library** tab and leave it alone. On the **phone**, send **Are you there?** in the chat.
  - **You should see:** within about **10 to 15 seconds**, without touching anything, a small red dot on the **Chat** tab.
- [ ] **3.1b** On the desktop, tap **Chat**.
  - **You should see:** the Group chat page (it may say **No messages yet. Say hello to the group.**, that is the group's chat, not the private one) with a box above it, **New private message from B** and a big **Open** button, and a red dot on **Private**. Tap **Open**: you are in the private chat with the message. Go back to **Chat**: the box is gone.
- [ ] **3.1c** On the desktop, tap **Members** and leave it alone. On the phone, send another message.
  - **You should see:** within about **10 to 15 seconds**, without touching anything, a red dot next to **B's name** (and none next to C's name).
- [ ] **3.2** Tap **Message** next to B, read the chat, then tap **Back to private chats**.
  - **You should see:** B's row has no dot any more, and the dots on the **Chat** tab and **Private** are gone. Reload the page: they stay gone.

## Test 4: Nobody else can see it

- [ ] **4.1** As **C** (second window), open **Chat**, then **Private**.
  - **You should see:** **No private chats yet ...** and no dots anywhere. Nothing from B and the owner's chat shows up.
- [ ] **4.2** Now make a chat that does not include you: on the **phone**, as B, open **Members**, tap **Message** next to C, and send **Secret plan**. Then, as the **owner** on the desktop, open **Chat**, **Private**, and **Members**.
  - **You should see:** **no** row for the B and C chat in your Private list, and no dot anywhere. The owner has no special view.
- [ ] **4.3** On the phone, copy the address of B and C's open chat from the browser's address bar (it is the group address followed by `/chat/private/` and a long code) and send it to yourself. Open it on the desktop as the owner.
  - **You should see:** **This page could not be found.** (the same page as for an address that does not exist). **Secret plan** is nowhere on it.
- [ ] **4.4** Do the same as a person who is **not in the group**.
  - **You should see:** the same not-found page.
- [ ] **4.5** In **Members**, look at the list as plain member C.
  - **You should see:** only names and buttons. (You cannot check the page's hidden details by eye; the automatic tests check that other people's account codes are never sent to a plain member.)

## Test 5: Delete your own message

- [ ] **5.1** As B in the chat with the owner, look at the owner's messages.
  - **You should see:** **no** bin button next to the owner's messages, and a bin button next to B's own messages.
- [ ] **5.2** As the **owner** in that chat, look at B's messages.
  - **You should see:** **no** bin button next to B's messages either. The owner cannot delete other people's private messages.
- [ ] **5.3** As B, tap the bin next to one of B's messages, tap **Cancel**, then tap the bin again and **Yes, delete**.
  - **You should see:** the question **Delete this message?** with the line **It disappears for both of you and cannot be brought back.** After **Cancel** the message stays. After **Yes, delete** it is gone for B at once, and for the owner within about **15 to 25 seconds** (without reloading).

## Test 6: A removed member loses access, the other person reads only

Use the chat between **B and C**, and make sure B and C each have written something.

- [ ] **6.1** On C's screen, open the B and C chat and leave it open. As the **owner**, open **Members**, tap **Remove** next to B and confirm.
  - **You should see:** on C's screen, within a few seconds and **without reloading**, the message box is replaced by **B ... is no longer in this group. You can read this conversation but not reply.** (with B's name). The old messages are still there and have no bin buttons.
- [ ] **6.2** On C's screen open **Chat > Private**.
  - **You should see:** the row with B's name followed by **(left the group)**.
- [ ] **6.3** On B's screen, open the chat address or the group.
  - **You should see:** **This page could not be found.** (B is no longer in the group, so B cannot read the chat.)
- [ ] **6.4** On C's screen open **Members**.
  - **You should see:** no **Message** button for B (B is no longer a member).

## Test 7: Leaving and joining again

This uses **C** and the **owner**. If you have not yet, first make a chat between them: as C, tap **Message** next to the owner and send **Hi**; as the owner, answer **Hello C**.

- [ ] **7.1** As **C**, open **Members**, tap **Leave group** and confirm.
  - **You should see:** C is taken home and the group is gone from C's list. As the **owner**, open **Chat > Private**: the row for C now says **(left the group)**, and opening it shows the read-only note and no message box.
- [ ] **7.2** As **C**, join the group again with the invite link or code.
  - **You should see:** C is in the group again. Open **Chat > Private**: the **same** chat with the owner is in the list with all the old messages, and the message box is back.
- [ ] **7.3** As the **owner**, look at the same chat.
  - **You should see:** within a few seconds the read-only note goes and the message box is back. Send a message: C gets it.

## Test 8: Phone checks

On the **phone** (a narrow screen of about 360 pixels is the hardest case).

- [ ] **8.1** Open **Members**, **Chat**, **Chat > Private**, a conversation, and a read-only conversation.
  - **You should see:** you **cannot scroll sideways** on any of them. The **Message** buttons, the **Group** and **Private** switch, the **Back to private chats** link, the chat rows and the **Send** button are all big enough to tap easily.
- [ ] **8.2** Tap into the message box.
  - **You should see:** the page does not zoom in, and the box stays just above the tab bar.
- [ ] **8.3** Look at **Private** and a conversation in both themes (the sun/moon button).
  - **You should see:** everything readable in the light and the dark theme, and the red dot clearly visible in both.
- [ ] **8.4** Open a conversation, switch to another app for a minute and come back.
  - **You should see:** new messages appear within a moment of coming back.

---

## Known limits in Slice 6

These are by design. They are not bugs.

- **The chat checks for news every few seconds** (it is not instant). After a few minutes with nobody touching the page it checks less often, and any tap wakes it up again.
- **Dots and the banner are checked every 10 seconds or so.** While the page is hidden (another tab or app) nothing is checked, it checks straight away when you come back, and after a few minutes with no touch it checks less often (every 30, then 60 seconds). So a message can take up to about 15 seconds to show a dot, and longer on a page you have not touched for a while.
- **The group owner has no power over private chats.** They cannot read, find or delete anything in them.
- **Text only.** No pictures or files, no editing, no replies, and no "seen" marks or typing signs.
- **A chat nobody has written in is not listed**, for either person.
- **Limits:** at most **20 private messages a minute** per person, and at most **30 new private chats an hour** per person (tapping **Message** to go into a chat you already have is free and not counted). A message is up to 2000 characters, like the group chat.
- **Leaving or removal keeps the messages.** The person who stays can read them for as long as the account exists. If a member who left joins again they get the conversation back.
- **A database change is needed** (migration 0008), so going back to the Slice 5 version of the site after the migration is harmless (the new tables are simply unused).
