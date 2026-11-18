# Custom Upload Form, Slice 2 (Owner's Editor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The group owner can design the group's upload form (type options and up to 3 extra details, required or optional) on a setup page offered right after creating a group, and later from Settings.

**Architecture:** A pure `prepareConfigForSave(current, draft)` in `src/shared/form-config.ts` validates a draft form, assigns ids to new items, archives (never deletes) removed items and bumps the version. A `saveFormConfig` use-case (owner only) calls it and writes through a new `GroupStore.updateFormConfig` with a version check. A client editor holds the draft and shows a live preview.

**Tech Stack:** as slice 1 (Next.js 16 cacheComponents, TypeScript, Drizzle/Postgres, zod, Vitest, Playwright; ports/adapters with a shared contract). NO migration in this slice.

**Spec:** `docs/superpowers/specs/2026-11-18-custom-upload-form-design.md` (read it, incl. "What people see" and "Calls made after the review"). **Builds on:** slice 1 (`docs/superpowers/plans/2026-11-18-custom-upload-form-foundation.md`, branch `feature/custom-upload-form`, PR #12).

## Global Constraints

- Limits over ACTIVE items: 5 types, 3 extra details, 15 choices per dropdown (at least 2 active), 30 removed items per list; label lengths: type 40, choice 40, detail 30; labels unique within a list ignoring capitals and spaces-collapsed; a label cannot be empty. Use `FORM_LIMITS` and `FORM_MESSAGES` from `src/shared/form-config.ts`.
- Title and Type are always required and not editable; `other` is reserved; only the owner may save (`group.form.edit`, owner only); every active member may read the form.
- A detail's kind cannot change after it exists; a removed item is archived (`archived: true`), never deleted; items missing from a draft that exist in the current config become archived; re-adding a removed label creates a NEW id; new items arrive from the client with an empty id (`""`) and the server generates ids (`crypto.randomUUID().replace(/-/g, "").slice(0, 8)` is fine, retry on collision).
- Saving replaces the whole configuration atomically with a version check; a stale version gives a friendly "changed elsewhere, reload" error and saves nothing; version increases by 1 per save.
- "Use these defaults" only fills the editor draft; Save is the one commit.
- No `Date.now()`/clock reads during prerender; English only; 360px layouts, 44px targets; never read `.env*`; never touch production; no migrations; agents do not push.

## Review Focus

- Two saves with the same starting version: the second fails and changes nothing.
- A draft that drops a type/detail/choice that files use: it becomes archived, old files keep it.
- A hostile draft: duplicate labels differing only by case/spaces, 6 types, 4 details, a dropdown with 1 or 16 choices, a changed kind, an id that does not exist in the current config, `other` as an id, `__proto__` as an id, overlong labels, 500 items: always rejected with field-level messages, never a crash, never partial state.
- A member or a stranger saving, or reading the editor page: not found / refused, config untouched.
- Slice-1 review leftovers fixed here: an edit-form file whose type id is unknown to the config must keep its current type (not silently switch to the first option); a fallback to the default form on an unparsable stored config logs one fixed warning; `usedOptionIds` returns only dropdown/archived field values, not every text value.

## File Structure

- Modify `src/shared/form-config.ts` (+ test): `prepareConfigForSave`, `DraftFormConfig` types.
- Modify `src/server/permissions/index.ts` (+ test table): `group.form.edit`.
- Modify `src/server/ports/group-store.ts`, `src/server/db/group-store.ts`, `src/server/adapters/fake-group-store.ts`, `group-store.contract.ts`, `group-store.int.test.ts`: `updateFormConfig`.
- Create `src/server/files/form-use-cases.ts` (+ test) or extend `use-cases.ts`: `saveFormConfig`, `getFormEditorState`.
- Create `src/app/groups/[id]/settings/upload-form/page.tsx`, `src/client/components/groups/form-editor.tsx` (+ small helpers/tests), action `saveFormConfigAction` in `src/app/groups/file-actions.ts` (or a new actions file).
- Modify `src/client/components/groups/settings-forms.tsx` (link), the "Group created" screen (`create-group-form.tsx`/`invite-card.tsx`), e2e specs, create `docs/SLICE_5_ACCEPTANCE.md`.

---

### Task 1: Saving a form configuration (server side)

**Files:** as File Structure (shared module, permissions, group store port + Postgres + fake + contract + int test, use-case, tests).

**Interfaces:**
- Consumes: slice 1 (`FormConfig`, `FORM_LIMITS`, `FORM_MESSAGES`, `parseFormConfig`, `DEFAULT_FORM_CONFIG`, `GroupRecord.formConfig`, `requireFileDeps`/`memberContext`-style access helpers in `src/server/files/use-cases.ts`).
- Produces:
  - `type DraftFormConfig = { version: number; types: { id: string; label: string }[]; fields: { id: string; label: string; kind: "text" | "dropdown"; required: boolean; options?: { id: string; label: string }[] }[] }` (the client sends only ACTIVE items; ids are `""` for new ones).
  - `prepareConfigForSave(current: FormConfig, draft: DraftFormConfig, newId?: () => string): { ok: true; config: FormConfig } | { ok: false; errors: Record<string, string>; formError?: string }`. Error keys: `types`, `type:<index>`, `fields`, `field:<index>:label`, `field:<index>:options`, `field:<index>:option:<j>`. Stale `draft.version !== current.version` gives `{ ok: false, errors: {}, formError: FORM_MESSAGES.formChangedElsewhere }`. Output `version = current.version + 1`; removed items archived (`archived: true`) and kept after the active ones in their list; at most `FORM_LIMITS.maxRemoved` archived per list.
  - `GroupStore.updateFormConfig(groupId: string, expectedVersion: number, config: FormConfig): Promise<"saved" | "stale" | "group_gone">`: Postgres `update public.groups set form_config = $cfg::text::jsonb where id = $id and deleted_at is null and (form_config->>'version')::int = $expected`, then distinguish stale from gone; the fake mirrors it.
  - Permission `group.form.edit`: `["owner"]`.
  - `saveFormConfig(deps: FileDeps-like, groupId: string, raw: unknown): Promise<{ ok: true; config: FormConfig } | { ok: false; notFound?: true; errors: Record<string,string>; formError?: string }>`: zod-parses the raw draft (hostile shapes → friendly error), requires active owner via the same member-context pattern as the other file use-cases (non-owner members get `notFound`-style identical to non-members), calls `prepareConfigForSave` then `updateFormConfig`; `stale` maps to the "changed elsewhere" error. `getFormEditorState(deps, groupId): { formConfig: FormConfig; canEdit: boolean } | null` (members: read; only the owner `canEdit`).
- [ ] Step 1: Write failing tests for every case in Review Focus (draft validation table, archiving, new-id generation with a stubbed `newId`, stale version, permissions: owner saves, member refused identically to a stranger, removed member refused, other group's id).
- [ ] Step 2: Run `npx vitest run --project unit` for those files; expect FAIL.
- [ ] Step 3: Implement `prepareConfigForSave`, the permission, `updateFormConfig` (Postgres + fake + contract + int test for the compare-and-set, including two concurrent saves with the same version: exactly one `saved`), and the use-cases.
- [ ] Step 4: Fix the slice-1 review leftovers that live on the server: log one fixed warning when `parseFormConfig` falls back to the default for a stored value that is not `null`/missing (in the group store read path, not in the pure function); restrict `usedOptionIds` to values of dropdown fields and archived fields (the store receives the field ids to consider: `usedOptionIds(groupId, fieldIds: string[])`, adapt both stores, contract and callers).
- [ ] Step 5: Run unit tests, typecheck, lint: PASS. Commit `feat: owner can save the group's upload form (server side)`.

### Task 2: The editor, setup step, Settings link, tests and guide

**Files:** as File Structure (page, editor component, action, links, e2e, guide).

**Interfaces:**
- Consumes: Task 1 (`getFormEditorState`, `saveFormConfig`, `DraftFormConfig`, `FORM_LIMITS`, `DEFAULT_FORM_CONFIG`), slice 1's upload form component for the preview (reuse its field rendering with the draft converted to a `FormConfig`).
- Produces: route `/groups/[id]/settings/upload-form` (owner only; anyone else gets the plain not-found page); `saveFormConfigAction(groupId: string, draft: DraftFormConfig)`; the editor UI per the spec: Title (locked, always required), Type options (up to 5 rows: rename, up/down, add, remove; fixed "Other, members say what it is" row), Extra details (up to 3 cards: name, "Short text" or "Dropdown" radio with a choices list for dropdowns (min 2, max 15, up/down/remove/add), Required switch, up/down, remove; kind is locked on existing details, shown as text), a counter "N of 5 fields used", a live preview of the member's upload form, **Save** and **Use these defaults** (fills the draft only), unsaved-changes warning on leaving, friendly field-level errors, a success message after saving; removing an item that exists shows a short confirm line saying old files keep it.
- [ ] Step 1: Write failing e2e tests (fake services; seed with the test route `/api/test/set-form-config` when a custom starting point is needed): owner opens the editor from Settings and from the "Group created" screen ("Next: set up your upload form" button leading to the editor); owner adds a type, a dropdown "Semester" with choices Sem 1 and Sem 2 (required) and a text "Subject"; saves; the member's upload form shows exactly that (required marker, Other text box beside Other), the member must pick a semester; a file uploaded earlier with a now-removed type still shows it with "(removed)"; renaming a type updates old files; limits (6th type, 4th detail, 16th choice) are refused in the UI with a message; "Use these defaults" restores defaults only after Save; a member and a stranger get the not-found page for the editor URL; two tabs: second save shows the "changed elsewhere" message; 360px no sideways scroll and `auditPage` on the editor with errors and with the preview; keyboard operable up/down buttons.
- [ ] Step 2: Run them; expect FAIL.
- [ ] Step 3: Implement the page, the editor (client draft state, id `""` for new items, counters, preview, confirm line, unsaved warning), the action (validates and calls `saveFormConfig`, revalidates the group's layout), the Settings link ("Upload form") and the post-create button; fix the edit-form leftover: a file whose current type id is unknown to the config shows an "Unknown type" option selected and keeps its type unless the member changes it (test it).
- [ ] Step 4: Run the whole e2e suite on desktop, phone-360 and phone-412, `npm test`, typecheck, lint: PASS.
- [ ] Step 5: Write `docs/SLICE_5_ACCEPTANCE.md` in the style of `docs/SLICE_4_ACCEPTANCE.md` (beginner friendly; `<preview address>` placeholder; two devices incl. a phone; this slice has NO database change): owner creates a group and sees the setup step; adds types and details; required vs optional; Other needs text; members' forms follow; edit later in Settings; removing keeps old files; renaming updates; limits; defaults button; non-owners cannot open it.
- [ ] Step 6: Commit `feat: owner's upload form editor with setup step`.
