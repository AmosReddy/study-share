# Custom Upload Form, Slice 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make uploading, editing, listing, searching and filtering files run from a per-group form configuration (types and extra details), with every existing group and file moved onto the default configuration. No owner editor yet (slice 2).

**Architecture:** A JSON `form_config` on `groups`, and per-file answers (`type_id`, `type_other`, `details` JSON) on `resources`. A pure module in `src/shared` owns the configuration shape, defaults and answer validation; the stores and use-cases call it. UI components render from the configuration.

**Tech Stack:** Next.js 16 (cacheComponents), TypeScript, Drizzle + Postgres (Supabase), zod, Vitest, Playwright. Follow the existing ports/adapters pattern (`src/server/ports`, `src/server/db`, `src/server/adapters` fake + shared contract tests).

**Spec:** `docs/superpowers/specs/2026-11-18-custom-upload-form-design.md` (read it first, including "Calls made after the review").

## Global Constraints

- Limits, over ACTIVE items only: 5 types, 3 extra details (5 fields counting Title and Type), 15 choices per dropdown, 30 removed items per list; labels: type 40, choice 40, detail 30; text answer 100; "Other" text 40; labels unique within a list ignoring capitals; a dropdown needs at least 2 active choices.
- Title and Type are always required; the type id `other` is reserved for "Other" and is not stored in `types`; "Other" requires its text on NEW uploads.
- Migrated default ids: types `notes` "Notes", `pyq` "Previous year paper", `study_material` "Study material", `assignment` "Assignment"; one optional text detail id `subject` label "Subject".
- Unchanged stored values always pass validation on edit; answers are checked when an upload STARTS and not re-checked at completion.
- A detail's kind never changes after creation.
- Old app code running against the new schema must keep working (column defaults + a database rule); new code keeps writing the old `type` column (legacy key, or `other` for custom ids) and leaves `subject` as `''`.
- Library address: `type=<type id>`, `d_<detail id>=<value>`, old `subject=` read as `d_subject=`; dropdown filters match by choice id; text filters case-insensitive, de-duplicated.
- Search covers title, file name, "Other" text, text details, plus type labels and dropdown choice labels (server maps the word to ids from the group's current labels, removed items included).
- Never read `.env*`; never touch production; no migration is run by agents (CI applies it to real Postgres); no `Date.now()`/clock reads during prerender; English text only; 360px layouts with 44px targets.

## Review Focus

- A group created by OLD code (no `form_config`) after the migration gets the default configuration (column default).
- An old file of type `other` with no "Other" text: shows "Other", can be edited without adding text.
- A removed type/choice still used by files: shown in the file list and file page, filterable (marked "(removed)"), not offered for new uploads.
- Search "semester 2" finds files by dropdown choice label even after the label was renamed.
- Hostile address values (`d_<unknown>=x`, repeated params, overlong values, `type=<unknown>`) never crash the page and never leak other groups' data.

## File Structure

- Create `src/shared/form-config.ts` (+ `.test.ts`): configuration types, limits, `DEFAULT_FORM_CONFIG`, answer validation, label helpers, search-id mapping.
- Create `drizzle/0007_form_config.sql` (+ meta, `src/server/db/schema.ts`): migration.
- Modify `src/server/ports/group-store.ts`, `src/server/db/group-store.ts`, `src/server/adapters/fake-group-store.ts` (+ contract): `GroupRecord.formConfig`.
- Modify `src/server/ports/resource-store.ts`, `src/server/db/resource-store.ts`, `src/server/adapters/fake-resource-store.ts`, `resource-store.contract.ts`, `resource-store.int.test.ts`: new answer fields, config-aware list/search/filters.
- Modify `src/shared/resources.ts`, `resource-schemas.ts`, `library-query.ts`, `src/server/files/use-cases.ts` (+ tests): use-cases on the configuration.
- Modify `src/client/components/files/*` (upload form, edit form, fields, list rows, filters), `src/app/groups/[id]/page.tsx`, `files/[fileId]/page.tsx`, `upload/page.tsx`, `src/app/groups/file-actions.ts`; e2e (`files`, `search`, `groups`, others as needed) and `docs/SLICE_4_ACCEPTANCE.md`.

---

### Task 1: Form configuration module (pure)

**Files:** Create `src/shared/form-config.ts`, `src/shared/form-config.test.ts`.

**Interfaces:**
- Produces:
  - `type FormType = { id: string; label: string; archived?: boolean }`; `type FormOption = { id: string; label: string; archived?: boolean }`; `type FormField = { id: string; label: string; kind: "text" | "dropdown"; required: boolean; archived?: boolean; options?: FormOption[] }`; `type FormConfig = { version: number; types: FormType[]; fields: FormField[] }`.
  - `OTHER_TYPE_ID = "other"`, `FORM_LIMITS` (the values above), `DEFAULT_FORM_CONFIG: FormConfig` (version 1).
  - `parseFormConfig(raw: unknown): FormConfig`: zod-checked; returns `DEFAULT_FORM_CONFIG` if `raw` is not a valid configuration (never throws; used when reading JSON from the database).
  - `type Answers = { typeId: string; typeOther: string; details: Record<string, string> }`.
  - `validateAnswers(config: FormConfig, input: { typeId: string; typeOther: string; details: Record<string, string> }, existing?: Answers): { ok: true; value: Answers } | { ok: false; errors: Record<string, string> }`. Error keys: `type`, `typeOther`, `detail:<fieldId>`. Trims text; ignores nothing unknown: an unknown detail id is an error key `detail:<id>`.
  - `typeLabel(config, typeId, typeOther): string` ("Other: Lab manual" for `other` with text, "Other" without; archived and unknown ids still resolve, unknown gives "Other"); `detailDisplay(config, field, value): string` (choice label for dropdowns, resolving archived options).
  - `searchIdsFor(config, term): { typeIds: string[]; optionIds: string[] }`: case-insensitive substring match of `term` over type labels (including `Other` for id `other`) and dropdown option labels, including archived.
  - `activeTypes(config)`, `activeFields(config)`, `activeOptions(field)`: archived filtered out.
- [ ] Step 1: Write failing tests with the spec's exact values: default config shape; `validateAnswers`: type required, unknown type id rejected, archived type rejected for new answers but accepted when equal to `existing.typeId`; `other` needs `typeOther` (1..40) for new answers, an `existing` with `typeId: "other"` and empty text passes unchanged; required detail missing fails, optional empty passes; text over 100 fails; dropdown value must be an active option id, an archived id equal to the existing value passes; unknown detail id fails; `parseFormConfig` returns the default for `null`, `{}` and a config with a duplicate id; `searchIdsFor` finds an archived option and "previous" → `["pyq"]`; `typeLabel` cases.
- [ ] Step 2: Run `npx vitest run --project unit src/shared/form-config.test.ts`; expect FAIL (module missing).
- [ ] Step 3: Implement the module (zod schema for parse; `validateAnswers` rules per Global Constraints).
- [ ] Step 4: Run the test file; expect PASS. Run `npm run typecheck` and `npm run lint`.
- [ ] Step 5: Commit `feat: form configuration model and answer validation`.

### Task 2: Migration, group store and resource store on the configuration

**Files:** Create `drizzle/0007_form_config.sql` (+ `drizzle/meta`); modify `src/server/db/schema.ts`, the group and resource ports, Postgres and fake adapters, contracts and the int tests listed under File Structure.

**Interfaces:**
- Consumes: Task 1 (`FormConfig`, `parseFormConfig`, `DEFAULT_FORM_CONFIG`, `Answers`, `searchIdsFor`).
- Produces:
  - `GroupRecord.formConfig: FormConfig` (read via `parseFormConfig`; the fake store seeds `DEFAULT_FORM_CONFIG`).
  - `ResourceRecord`: remove `type`/`subject`; add `typeId: string`, `typeOther: string`, `details: Record<string, string>`.
  - `ResourceStore.createPending(input: { ...existing, typeId: string; typeOther: string; details: Record<string,string> })` (no `type`/`subject`); `update(groupId, id, { title, typeId, typeOther, details })`.
  - `ResourceStore.list(groupId, q: { search?: { text: string; typeIds: string[]; optionIds: string[]; textFieldIds: string[] }; typeId?: string; details?: { fieldId: string; kind: "text" | "dropdown"; value: string }[]; limit: number; cursor?: string })` (same return as today). Search matches (case-insensitive, literal, escaped) title, file name, `type_other`, the values of `details` whose key is in `textFieldIds`, OR `type_id` in `typeIds`, OR a `details` value in `optionIds`. Text detail filters compare case-insensitively; dropdown filters compare exactly (choice id).
  - `ResourceStore.listDetailValues(groupId, fieldId: string): Promise<string[]>`: distinct non-empty values of a text detail over ready, non-deleted files, case-insensitive de-duplicated keeping the byte-smallest spelling, sorted like `listSubjects` did (replaces `listSubjects`).
  - `ResourceStore.usedOptionIds(groupId): Promise<{ typeIds: string[]; detailValues: Record<string, string[]> }>`: type ids and per-detail values in use by ready, non-deleted files (for showing "(removed)" entries only while used).
- [ ] Step 1: Write failing contract tests (run by the fake and the real-Postgres int test) for: create/update/list round trip of the new fields; search by title, file name, other text, text detail, type label id, option id; type filter; dropdown and text filters; `listDetailValues`; `usedOptionIds`; deleted/pending exclusions as before.
- [ ] Step 2: Add int tests for the migration on seeded LEGACY rows (insert rows the way old code did, with only `type`/`subject`): after the migration SQL the backfill produced `type_id`, `details->>'subject'`, and groups have the default `form_config`; plus: an INSERT that sets only the old `type`/`subject` columns gets `type_id`/`details` filled by the database rule; a group inserted with no `form_config` gets the default; both NOT NULL.
- [ ] Step 3: Run `npx vitest run --project unit src/server/adapters` and expect FAIL.
- [ ] Step 4: Write migration `0007_form_config` via `npx drizzle-kit generate --name form_config` (dummy `DATABASE_URL` on the command line only), then hand-edit: add `groups.form_config jsonb not null default '<DEFAULT_FORM_CONFIG json>'`; add `resources.type_id text`, `type_other text not null default ''`, `details jsonb not null default '{}'`; backfill `type_id = type` and `details = case when subject <> '' then jsonb_build_object('subject', subject) else '{}' end`; then `set not null` on `type_id`; drop the old `type` check; keep `type`/`subject` columns (make `subject` keep its default `''`); add a `before insert` trigger that, when `type_id` is null, sets `type_id = new.type` and, when `details = '{}'` and `subject <> ''`, sets `details` from `subject`; a `check (char_length(type_other) <= 40)`; update `schema.ts` and the meta journal.
- [ ] Step 5: Implement ports and both adapters (Postgres: `jsonb` operators with parameters only; escape LIKE as the existing store does; the fake mirrors every rule); new code writes the old `type` column as the legacy key when `typeId` is one of `notes|pyq|study_material|assignment|other`, else `other`.
- [ ] Step 6: Run unit tests, typecheck, lint; the int tests run in CI. Commit `feat: form config and per-file answers in the database and stores`.

### Task 3: Use-cases on the configuration

**Files:** Modify `src/shared/resources.ts` (drop `RESOURCE_TYPES`, keep limits and file rules), `src/shared/resource-schemas.ts`, `src/shared/file-messages.ts`, `src/shared/library-query.ts` (+ tests), `src/server/files/use-cases.ts` (+ tests).

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces:
  - `prepareUpload(deps, groupId, raw: { title; typeId; typeOther; details; fileName; contentType; sizeBytes })` validates with `validateAnswers(group.formConfig, ...)` (no `existing`), maps errors to field errors keyed `type`, `typeOther`, `detail:<id>`, `title`, `fileName`, `sizeBytes`; `completeUpload` does NOT re-validate answers.
  - `updateFile(deps, groupId, resourceId, raw: { title; typeId; typeOther; details })` validates with `existing` = the stored answers.
  - `FileView`: replace `type`/`typeLabel`/`subject` with `typeId`, `typeLabel: string`, `typeRemoved: boolean`, `typeOther: string`, `details: { fieldId: string; label: string; display: string; removed: boolean }[]` (only details that have a value or whose field is active), plus the group's `formConfig` available to pages via a new `getFormForGroup(deps, groupId)` (active members only; same not-found shape as other reads).
  - `listFiles(deps, groupId, query: { q; typeId?; details: Record<string,string>; cursor })` returns today's shape plus `filters: { types: { id; label; removed: boolean }[]; fields: { id; label; kind; options: { id; label; removed: boolean }[] }[] }` built from the configuration, `usedOptionIds` (removed entries only when used) and `listDetailValues` for text fields.
  - `parseLibraryParams` / filter-href builders in `library-query.ts`: `type=<id>`, `d_<fieldId>=<value>`, legacy `subject=` mapped to `d_subject`, `q`, `cursor`; unknown fields and repeated params ignored; values truncated to their limits.
- [ ] Step 1: Write failing tests: prepare with a custom config group (use a group record with a custom `formConfig`) requires a required detail and "Other" text; unknown type rejected; edit of a legacy `other` file with empty text succeeds unchanged; `completeUpload` succeeds after the config added a required detail; list `filters` content incl. removed entries only when used; library-query parsing cases from Review Focus.
- [ ] Step 2: Run the tests; expect FAIL.
- [ ] Step 3: Implement. Search: call `searchIdsFor(config, text)` and pass `{text, typeIds, optionIds, textFieldIds}` to the store.
- [ ] Step 4: Run unit tests, typecheck, lint, all PASS. Commit `feat: uploads, edits, list and filters follow the group's form`.

### Task 4: Screens, end-to-end tests and the owner guide

**Files:** Modify the client components under `src/client/components/files/` (upload form, edit form, `file-fields.tsx`, list rows, `library-filters.tsx`), `src/app/groups/[id]/page.tsx`, `src/app/groups/[id]/upload/page.tsx`, `src/app/groups/[id]/files/[fileId]/page.tsx`, `src/app/groups/file-actions.ts`; e2e specs; create `docs/SLICE_4_ACCEPTANCE.md`.

**Interfaces:**
- Consumes: Task 3 (`getFormForGroup`, new `FileView`, `listFiles` filters, new action input shapes).
- Produces: the same screens as today, rendered from the configuration: upload and edit forms show Title, Type (select; choosing Other reveals a required "What kind of file is it?" text box), then the extra details in order (text input or select, required ones marked); list rows and the file page show the type label (Other shows its text) and the details as small labels; the filter bar shows Type and one filter per extra detail (text detail: the distinct values; dropdown: its choices; removed entries labelled "(removed)").
- [ ] Step 1: Update the existing e2e specs (`files`, `search`, others that use Type/Subject) to the new behaviour and add e2e tests with fake services: default form works as before; Other requires its text; a group with a custom configuration (seed it through a test-only route `/api/test/set-form-config`, 404 outside fake mode, with a route test) shows its own fields, requires required ones, filters by a dropdown detail; legacy-style address `?subject=Maths` still filters; hostile addresses from Review Focus; 360px no sideways scroll and `auditPage` on the upload form, file page and filter bar.
- [ ] Step 2: Run them; expect FAIL.
- [ ] Step 3: Implement the component changes; keep tap targets at 44px and the existing look.
- [ ] Step 4: Run e2e on desktop and phone-360 (`files`, `search`, `groups`, `prerender`, plus the rest of the suite at least once), `npm test`, typecheck, lint; all PASS.
- [ ] Step 5: Write `docs/SLICE_4_ACCEPTANCE.md` in the style of `docs/SLICE_2_ACCEPTANCE.md` (beginner friendly, `<preview address>` placeholder, no setup; says a database change must be applied to production before merge).
- [ ] Step 6: Commit `feat: upload form, filters and file pages follow the group's form`.
