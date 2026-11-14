# Slice 3 acceptance (owner guide): group chat

This guide walks you through trying out everything Slice 3 added: a **Chat** tab where the people in a group can talk to each other. It is written so you can follow it one tick box at a time, in the same way as [SLICE_2_ACCEPTANCE.md](SLICE_2_ACCEPTANCE.md).

## What Slice 3 adds

- **A Chat tab.** Every group has one chat. The group's tabs are now **Library**, **Chat**, **Members** (and **Settings** for the owner).
- **Text messages.** Type in the box at the bottom and send. A message can be up to **2000 letters** and can have several lines. Only plain text: nothing you type is ever turned into bold, links or pictures.
- **Names and times.** Your messages sit on the **right** in a dark bubble; other people's sit on the **left**, with their name above (the name shows once for a run of messages from the same person). Each message shows its time in **your own time zone**.
- **Delete.** You can delete **your own** messages. The **group owner** can delete **anybody's**. Both are asked "Delete this message?" first. A deleted message disappears for everyone and cannot be brought back.
- **History.** Messages stay. Leave the page and come back, or open the chat on another day, and the conversation is still there. The newest 50 show first, and **Load earlier messages** at the top brings older ones.
- **People who left.** A message from a person whose account no longer exists says **Former member**.

**Important: the chat refreshes every few seconds. It is not instant.** There is no live connection: each device asks the site for news about every **2.5 seconds**, and only while the chat is open and the screen is on. So a message usually appears on the other device **within a few seconds**, not at the same moment. A deleted message can take up to about **15 seconds** to disappear on the other device. This is by design and keeps the chat simple and cheap. The chat is **English text only** for now (other languages and emoji are fine to type, there is just no translation of the page).

## What you need to set up

**Nothing to type into Supabase, Vercel or Google.** But **this slice needs a database change on production before it is merged**: migration **0006** creates the table that stores the messages. **The developer runs it** (a command, like migration 0004 and 0005), after you have tested on the preview and before you say "merge". If the Chat tab shows an error page on the preview instead of the chat, tell the developer: the migration has probably not been run on the database the preview uses.

## How to read this guide

You need **two devices**: a **phone** and a **desktop browser** (or two phones). You need **two accounts**:

- **You (owner)**: the group owner, signed in as yourself.
- **Friend A**: a second account in the same group (a plain member).

A plus-address such as `you+a@gmail.com` counts as its own account. Make one group (for example **Maths Circle**, link-only saves typing a password) and let Friend A join it with the invite link or the code, as in the Phase 1b guide. For the last test you also need a person you can **remove** from the group (Friend A is fine, so do that test last).

**Where to test.** Test first on the **preview address** for the branch `feature/slice-3-chat`, written below as `<preview address>`. **The developer gives you that address.** If you still see the words `<preview address>` in angle brackets, stop and ask the developer. After the merge, repeat the main tests on the live address, `https://study-share-amber.vercel.app`.

**Always open the site only from the correct address.** Use the preview address for these tests, and the live address after the merge. **Never** use the long links that Vercel shows for one particular deployment. Test in a **private (incognito) window**, so old sign-ins and saved pages cannot confuse the result. Each person needs their own private window or device. **Keep both devices' screens on and the chat open** while you wait for messages to arrive: a phone with its screen off does not refresh.

After most steps you will see **You should see** (what a correct result looks like). If it looks different, write down what you saw and what you tapped, and tell the developer. Do not guess.

### The order, at a glance

- [ ] Test 1: The Chat tab and the empty chat
- [ ] Test 2: Send a message and see it on the other device
- [ ] Test 3: Reply, and names and order
- [ ] Test 4: Lines, long messages and odd characters
- [ ] Test 5: Delete your own message
- [ ] Test 6: The owner deletes someone else's; a plain member cannot
- [ ] Test 7: Leave the page and come back (history)
- [ ] Test 8: Phone checks (keyboard and bottom bar)
- [ ] Test 9: A removed member cannot see the chat

---

## Test 1: The Chat tab and the empty chat

Do this on the **desktop**, in a **brand new group** with nobody having written anything yet.

- [ ] **1.1** Open the group.
  - **You should see:** the tabs **Library**, **Chat**, **Members** and (for you, the owner) **Settings**, in that order.
- [ ] **1.2** Tap **Chat**.
  - **You should see:** the **Chat** tab is highlighted, a box with the words **No messages yet. Say hello to the group.**, and at the bottom a box that says **Write a message** with a **Send** button. **Send** is greyed out while the box is empty.

## Test 2: Send a message and see it on the other device

Open the group's **Chat** on **both** devices (you on the desktop, Friend A on the phone, or the other way round).

- [ ] **2.1** On the desktop, type **Hello from the owner** and press **Enter** (or tap **Send**).
  - **You should see:** the message appears at once on the **right**, in a dark bubble, with the time (for example **10:42**) in its corner.
- [ ] **2.2** Look at the other device. **Do not reload the page.**
  - **You should see:** within a few seconds (up to about 5) the message appears on the **left**, with your name above it and the same time (in that device's time zone).

## Test 3: Reply, and names and order

- [ ] **3.1** On the other device, type **Hi, got it** and send.
  - **You should see:** it appears on the right there at once, and on your device within a few seconds, on the **left**, with Friend A's name above it, **below** your first message.
- [ ] **3.2** Send two more messages in a row from your device, a few seconds apart.
  - **You should see:** on your device, **no name** above your own messages. On the other device, your **name appears once** above your messages, not before each one.
- [ ] **3.3** Look at the order on both devices.
  - **You should see:** the same order everywhere: the oldest at the top, the newest at the bottom, and every message **exactly once**.

## Test 4: Lines, long messages and odd characters

- [ ] **4.1** On the desktop, type a few words, hold **Shift** and press **Enter**, type a few more words, and press **Enter** on its own.
  - **You should see:** **Shift + Enter** starts a **new line** in the box (the box grows to hold it, up to five lines). **Enter** alone sends. The message keeps its line breaks, on both devices.
- [ ] **4.2** Paste or type a very long text of about 2000 letters (for example copy a long paragraph several times).
  - **You should see:** the box stops at **2000** letters and a counter such as **2000/2000** appears. The message sends, and a very long word without spaces **wraps inside the bubble**: you cannot scroll sideways.
- [ ] **4.3** Send this exactly: `<b>bold?</b> <i>no</i> & "quotes"`
  - **You should see:** the message shows the characters **exactly as typed**, including the angle brackets. Nothing turns bold or italic, on either device.

## Test 5: Delete your own message

- [ ] **5.1** On Friend A's device, find a message **Friend A** sent. Next to it is a small **bin** button. Tap it.
  - **You should see:** a sheet from the bottom asking **Delete this message?** with **Cancel** and **Yes, delete**.
- [ ] **5.2** Tap **Cancel**.
  - **You should see:** the sheet closes and the message is still there.
- [ ] **5.3** Tap the bin again, then **Yes, delete**.
  - **You should see:** the message disappears at once on Friend A's device. On **your** device it disappears within about **15 seconds**, without reloading.

## Test 6: The owner deletes someone else's; a plain member cannot

- [ ] **6.1** On Friend A's device, look at **your** messages (the ones on the left).
  - **You should see:** **no bin button** next to them. A plain member can only delete their own.
- [ ] **6.2** On your device (the owner), look at Friend A's messages.
  - **You should see:** a bin button next to **every** message, yours and Friend A's.
- [ ] **6.3** Tap the bin next to one of Friend A's messages.
  - **You should see:** the sheet says **As the owner you can delete anyone's message.** Tap **Yes, delete**.
  - **You should see:** it disappears on your device at once, and on Friend A's device within about 15 seconds.

## Test 7: Leave the page and come back (history)

- [ ] **7.1** On your device, tap **Library**, then tap **Chat** again.
  - **You should see:** the whole conversation, in order, ready, and it scrolled to the newest message.
- [ ] **7.2** Reload the page (**F5**, or pull down on a phone).
  - **You should see:** the same conversation. Messages are saved, not just shown.
- [ ] **7.3** Send a message from the other device **while you are on the Library tab**, wait 10 seconds, then tap **Chat**.
  - **You should see:** the new message is already there.
- [ ] **7.4** If you want to check **Load earlier messages**: it only shows in a chat with **more than 50** messages. You can skip this (the developer's tests cover it).

## Test 8: Phone checks

Do these on the **phone** (a narrow screen of about 360 pixels is the hardest case).

- [ ] **8.1** Open the **Chat** tab.
  - **You should see:** the messages fill the screen between the group's name at the top and the tab bar at the bottom. The box **Write a message** and the **Send** button sit **just above the bottom tab bar**, fully visible. **You cannot scroll sideways.**
- [ ] **8.2** Tap the box.
  - **You should see:** the page does not zoom in, and the keyboard opens. The box and **Send** stay **visible above the keyboard**, not hidden behind it, and the newest message stays in view.
- [ ] **8.3** Type two lines: type some words, tap the keyboard's **Enter / return** key, type more words.
  - **You should see:** **Enter** on the phone starts a **new line** (it does not send). Tap **Send** to send. After sending, the keyboard stays open.
- [ ] **8.4** Fill the chat with enough messages that it scrolls (send 10 or so). Scroll **up** to the top of the chat, and have the other person send a message.
  - **You should see:** your screen does **not** jump. A button **New messages** appears above the box. Tap it: you go straight to the newest message and the button disappears.
- [ ] **8.5** Turn the phone's screen off for about 20 seconds, have the other person send a message, then wake the phone with the chat still open.
  - **You should see:** the new message appears almost at once.
- [ ] **8.6** Switch to the dark theme (the sun/moon button).
  - **You should see:** the bubbles and the box are easy to read in both themes. The bin buttons are easy to tap with a thumb.
- [ ] **8.7** Turn the phone's Wi-Fi and mobile data off for about 30 seconds, then back on.
  - **You should see:** a small grey note **Reconnecting…** while it is off, and it goes away by itself shortly after the connection returns. A message you try to send while offline shows **Not sent. Tap to retry** under it. Tap it once you are back online: it sends **once** (never twice).

## Test 9: A removed member cannot see the chat

Do this **last**, because it removes Friend A from the group.

- [ ] **9.1** On Friend A's device, leave the **Chat** open. On your device go to **Members**, tap **Remove** next to Friend A and confirm.
  - **You should see:** within a few seconds Friend A's chat is replaced by **You can no longer see this chat** with a button **Go to your groups**. The message box is gone.
- [ ] **9.2** On Friend A's device, reload the page.
  - **You should see:** **This page could not be found.** (the same page as for a group that does not exist).
- [ ] **9.3** Friend A's old messages are still in the chat for the people who remain, under Friend A's name.
  - **You should see:** on your device, the messages are still there.

---

## Known limits in Slice 3

These are by design. They are not bugs.

- **Not instant.** Messages arrive within a few seconds, and a deletion can take up to about 15 seconds to show on the other device.
- **Only while the chat is open.** Nothing is delivered to a phone with the screen off or the page closed, and there are **no notifications and no unread counters**. When you open the chat again, it catches up.
- **Text only.** No pictures, files, links that open by themselves, editing, replies or reactions. To share a file, use the Library.
- **At most 20 messages a minute** per person. Beyond that the message says it is sending too fast and can be retried a moment later.
- **One chat per group.** There are no private messages between two people.
- **A person who leaves a group keeps their old messages** under their own name. Only when their **account** is deleted does the name become **Former member**.
- **The owner is the only moderator.** A deleted message cannot be brought back.
