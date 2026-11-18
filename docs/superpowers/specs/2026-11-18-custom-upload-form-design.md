# Custom upload form per group: design

Status: waiting for the owner's approval. Nothing is built yet. A reviewer read it first; the calls below were made in answer to that review.

## Intent and why

Today every group uploads files with the same fixed form: Title, a Type from five built-in types, and a free-text Subject. A class group wants Semester and Year, a project group wants something else entirely. Friends who tried the prototype asked for this, and the owner agrees it is the most important improvement. **The group owner designs the upload form for their group; every member then fills in that form when they upload.** The library's filters and search follow the form, so files stay easy to find.

## Goals

- The owner chooses the **type options** (up to 5, "Other" is always added on top and cannot be removed). Picking "Other" makes the member type what kind of file it is (required).
- The owner can add **extra details** (such as Subject, Semester, Year) so the whole form has **at most 5 fields counting Title and Type**, so up to 3 extras. Each extra detail is either **short text** or a **dropdown list** whose choices the owner types.
- The owner decides per extra detail: **required or optional**. Title and Type are **always required** (owner's decision).
- It is set up **right after creating a group**, on a page with sensible defaults filled in and a "Use these defaults" option, and it is **editable later by the owner** in Settings.
- The library's **filters** follow the form (a Type filter, plus one filter per extra detail) and **search** covers Title, file name, the "Other" text and every text detail.
- **Existing groups and files keep working** with automatic defaults (owner's decision): types Notes, Previous year paper, Study material, Assignment, plus Other; one optional text detail, Subject. Every existing file keeps its type and subject.
- **Renaming** a type, a detail or a dropdown choice updates everywhere. **Removing** one hides it from new uploads but old files keep their value (owner's decision).

## Non-goals

Number or date details, conditional details, per-member visibility, form templates shared between groups, editing many old files at once, "needs details" lists, admins other than the owner, importing or exporting forms.

## Anti-goals (a failure even if it technically works)

- Uploading becomes slower or harder than it is now.
- The owner can lose data by accident (removing something wipes old files' details).
- Old files disappear from the list, search or filters after the change.
- The setup page overwhelms a beginner owner.

## Constraints

- Free plans only; one new database migration, applied to production by the owner before merge, like earlier slices.
- English text only is fine; no language handling.
- Works on a 360px phone; filters and the upload form must not scroll sideways.
- All checks stay: access control by group membership and role on every server action and route, no raw errors shown, no clock reads while prerendering.

## Approaches considered

1. **One JSON "form configuration" on each group, and each file stores its answers as JSON (recommended, and what this design uses).** Fewer tables and joins, saved in one atomic update, flexible for later field kinds. The server checks every answer against the configuration, because the database cannot. Matches how the original plan kept details keyed by stable IDs.
2. **Separate tables for fields and options (original plan's `group_fields`).** The database enforces more (foreign keys), but every edit touches several tables, renames and removals need more careful transactions, and the migration and the fake test store are bigger. Too slow for the time we have, and no extra safety the server checks do not already give.
3. **Keep the fixed columns and bolt on a few generic ones.** Fastest but ugly, cannot support custom dropdown options or removal rules cleanly. Rejected.

## The design (decided by the owner unless marked "my call")

### Data

- `groups.form_config` (JSON, never empty): `{ version, types: [{id, label, archived}], fields: [{id, label, kind: "text"|"dropdown", required, archived, options: [{id, label, archived}]}] }`. IDs are short random strings, never reused; labels can change freely. The built-in id `other` is reserved for the "Other" type and is not stored in the list.
- Limits (my call, counted over **active** items only): 5 types, 3 extra details, 15 choices per dropdown, label lengths 40 (type, choice) and 30 (detail), text answers up to 100 characters, "Other" text up to 40. Labels must be unique within their list ignoring capitals. A dropdown needs at least 2 active choices.
- `resources` gains: `type_id` (text), `type_other` (text, empty unless the type is Other), `details` (JSON: detail id to the typed text or the chosen choice id). The old `type` and `subject` columns stay for now, no longer used (my call, so the migration cannot lose data; a later clean-up removes them).
- **Migration** (in one step): add the new columns and `form_config`; give every existing group the default configuration with the fixed ids `notes`, `pyq`, `study_material`, `assignment` and an optional text detail with id `subject`; copy each file's old type into `type_id` and old subject into `details`. Old files of type "other" become type `other` with empty "Other" text, shown as "Other".

### Rules on the server

- Preparing, completing and editing a file validate the answers against the group's **current** configuration: Title and Type required; each required detail present; text within length; dropdown value is an active choice id (an old value that is already stored and unchanged on edit is still allowed); "Other" needs the "Other" text; extras not in the configuration are rejected. If the form changed while a member was filling it in, they get a friendly message and the up-to-date form (nothing is lost on the screen).
- Only the owner can save the form: new permission `group.form.edit`, owner only, checked on every save. The save replaces the whole configuration in one update with a version check, so two saves cannot overwrite each other silently. Items missing from a save that files may use become archived, not deleted (the server decides; the client never deletes).

### What people see

- **Owner, after creating a group:** the existing "Group created" screen (invite link and code) gets a prominent "Next: set up your upload form" button leading to the editor page (my call: the group already exists with the defaults, so skipping loses nothing). Also reachable later from Settings ("Upload form").
- **The editor page** (a single phone-friendly page): Title (fixed, always required, shown locked); Type options (up to 5 rows to rename, reorder with up/down buttons, add or remove, plus a fixed "Other, members say what it is" row); Extra details (up to 3 cards, each with a name, "Short text" or "Dropdown" with its choices, a Required switch, up/down and remove); a counter like "4 of 5 fields used"; a live preview of the member's form; **Save** and **Use these defaults**. Removing something that files already use asks for confirmation and says the old files keep it.
- **Members:** the upload form is built from the configuration (Title, Type, then the extras in order, required ones marked). Picking Other shows a required line "What kind of file is it?" beside it.
- **Library:** each file row shows its type (as "Other: Lab manual" for Other) and its details as small labels; the file page lists all details. Filters: Type, then one per extra detail (a dropdown detail lists its choices; a text detail lists the distinct values used, as Subject does today). Removed types and choices still appear in filters marked "(removed)" so old files stay findable (my call). The address keeps the filter state, so old shared links keep working where possible.

### Left to the builder

Component layout and spacing, exact wording of messages (friendly, English), the migration's SQL details, test data, how the editor holds draft state, and keyboard and screen-reader behaviour (must meet the existing accessibility sweep).

## Calls made after the review (my calls, for the owner to check)

1. **A form change while someone is uploading** does not make them upload again. The answers are checked when the upload **starts**; finishing the upload does not re-check them. The owner's change applies to uploads that start afterwards. (Uploading must not get harder.)
2. **Editing an old file** only has to satisfy the rules for the parts the member **changes**. A stored value that is unchanged always passes: an archived choice, a removed type, an old "Other" file with no "Other" text, a detail that is now required but empty. Title and Type must still be present. So no old file becomes uneditable.
3. **Re-adding a removed label** creates a **new** item with a new id (no restore). Old files stay with the old, "(removed)" item. Removed items are kept; a filter lists a removed item only while at least one file uses it. At most 30 removed items are kept per list; past that, saving asks the owner to tidy up (very unlikely).
4. **A detail's kind (text or dropdown) cannot be changed after it is created.** The owner removes it and adds a new one instead. This prevents text answers being read as dropdown choices.
5. **Library addresses:** `type=<type id>` stays (the migrated ids are the old keys, `notes`, `pyq`, `study_material`, `assignment`, `other`, so old links keep working); each extra detail uses `d_<detail id>=<value>`; the old `subject=` is read as `d_subject=` when the group has the Subject detail. Dropdown filters match by choice id (renames never break them); text filters stay case-insensitive and de-duplicated, as Subject is today.
6. **Old code running against the new database** (between applying the migration and merging) must keep working: the new columns have defaults, a database rule fills `type_id` and `details` for rows the old code inserts, and `form_config` has the default configuration as its column default. New code keeps writing the old `type` column as a best-effort value (`other` for custom types) so its not-null check is satisfied. Rolling back is not promised for groups that use custom types.
7. **Search covers** the title, file name, "Other" text, text details, **and** the type label and dropdown choice labels. The server turns a search word into the matching type and choice ids from the group's current labels (including removed ones), so renames work.
8. **Permissions:** every active member (owner or member) can read the form; pending and removed people cannot. Only the owner saves it. **"Use these defaults" only fills the editor draft**; **Save** is the one commit.

## How it is delivered

Two slices, each its own branch and pull request with a test guide for the owner:

1. **Foundation:** migration, configuration model and checks, upload / edit / list / search / filters driven by the configuration (existing groups on the defaults, "Other" now requires its text). No editor yet; the default form is all anyone sees.
2. **Editor:** the owner's editor page, the post-create step, the Settings link, and the preview.

The production migration is applied by the owner before merging slice 1; slice 2 has no migration.
