"use client";

import { ArrowDown, ArrowUp, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { FormMessage } from "@/client/components/auth/form-message";
import { describedBy, FieldError, FieldHint, inputClassName, TextField } from "@/client/components/auth/text-field";
import { DetailInput, OtherTextField, TypeSelect } from "@/client/components/files/file-fields";
import { detailInputs, typeChoices } from "@/client/components/files/form-inputs";
import { Button } from "@/client/components/ui/button";
import {
  choiceAddBlocked,
  clearErrors,
  defaultsDraft,
  draftFromConfig,
  editorReducer,
  errorsByKey,
  fieldAddBlocked,
  fieldsUsedText,
  isDirty,
  previewConfig,
  rebaseDraft,
  toDraftFormConfig,
  typeAddBlocked,
  type Direction,
  type EditorAction,
  type EditorDraft,
  type EditorField,
} from "@/client/lib/form-editor-state";
import { cn } from "@/client/lib/utils";
import { AUTH_MESSAGES } from "@/shared/auth-messages";
import {
  FORM_LIMITS,
  OTHER_TYPE_ID,
  prepareConfigForSave,
  type DraftFormConfig,
  type FormConfig,
  type SaveFormResult,
} from "@/shared/form-config";

/*
  The owner's upload form editor. The draft (see form-editor-state.ts) holds the active items of the
  saved form; Save sends the whole draft to the server, which decides (every rule is checked there
  again) and answers with the new form. Nothing is saved before Save, "Use these defaults" included.
  The same checks run in the browser first, with the server's own function, so a mistake is shown
  at once; the server's answers are shown next to the right control the same way.
*/

export type SaveFormAction = (groupId: string, draft: DraftFormConfig) => Promise<SaveFormResult>;

type FormEditorProps = { groupId: string; config: FormConfig; action: SaveFormAction };

const LEAVE_MESSAGE = "You have changes that are not saved. Leave this page anyway?";
const REMOVE_NOTE = "Files that already use it keep it. It will not be offered for new uploads.";
const FIX_MESSAGE = "Some items need attention. Fix the ones marked below, then save again.";
const SAVED_MESSAGE = "Saved. Members see this form the next time they upload.";
const DEFAULTS_MESSAGE = "The default form is filled in below. Nothing is saved until you choose Save.";

/** Next's redirect() and notFound() throw errors whose digest starts with NEXT_; they are not failures. */
function isNextControlFlow(error: unknown): boolean {
  const digest = typeof error === "object" && error !== null ? (error as { digest?: unknown }).digest : undefined;
  return typeof digest === "string" && digest.startsWith("NEXT_");
}

const nameOf = (label: string, fallback: string) => (label.trim() === "" ? fallback : label.trim());

const noSubscription = () => () => {};

/** False on the server and until the page is hydrated: until then the buttons do nothing yet (browser tests wait for it). */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

export function FormEditor({ groupId, config, action }: FormEditorProps) {
  const uid = useId();
  const hydrated = useHydrated();
  const root = useRef<HTMLDivElement>(null);
  const message = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const focusRequest = useRef<{ id: string; fallback?: string } | null>(null);

  const [saved, setSaved] = useState(() => ({ config, draft: draftFromConfig(config) }));
  const [draft, dispatch] = useReducer(editorReducer, saved.draft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [notice, setNotice] = useState<{ tone: "success" | "info"; text: string } | undefined>();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Counts messages that need attention, so the first marked control (or the message) is focused after each.
  const [attention, setAttention] = useState(0);

  const dirty = isDirty(draft, saved.draft);

  // The draft as of the latest render, for the end of a save (which started with an older one).
  const latest = useRef(draft);
  useEffect(() => {
    latest.current = draft;
  });

  // Focus follows what the person just did: a new row's name box, the neighbour of a removed row, the
  // moved row's button (or the other one when it has reached the end and is disabled).
  useEffect(() => {
    const request = focusRequest.current;
    if (!request || !root.current) return;
    focusRequest.current = null;
    const targets = [...root.current.querySelectorAll<HTMLElement>("[data-focus]")];
    const usable = (id: string | undefined) =>
      targets.find((element) => element.dataset.focus === id && !(element as HTMLButtonElement).disabled);
    (usable(request.id) ?? usable(request.fallback))?.focus();
  });

  useEffect(() => {
    if (attention === 0) return;
    const invalid = root.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    (invalid ?? message.current)?.focus();
  }, [attention]);

  // Leaving with unsaved changes: closing or reloading the tab, and following a link inside the app.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search))
        return;
      if (!window.confirm(LEAVE_MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  /** Every change to the draft goes through here: it drops a "Saved" message that is no longer true. */
  function change(next: EditorAction, ...forgetErrors: string[]) {
    setNotice(undefined);
    if (forgetErrors.length > 0) setErrors((previous) => clearErrors(previous, ...forgetErrors));
    dispatch(next);
  }

  function focusNext(id: string, fallback?: string) {
    focusRequest.current = { id, fallback };
  }

  /** Opens the "files keep it" question under an item that exists in the saved form. Cancel gets the focus, so a held Enter cannot remove it. */
  function askRemove(prefix: string) {
    focusNext(`${prefix}:cancel`);
    setConfirming(prefix);
  }

  function cancelRemove(prefix: string) {
    focusNext(`${prefix}:remove`);
    setConfirming(null);
  }

  /** After a row is removed: the same place in its list (the next row, else the one before), else the add button. */
  function focusAfterRemoval(keys: string[], removed: string, focusId: (key: string) => string, addId: string) {
    const index = keys.indexOf(removed);
    const neighbour = keys[index + 1] ?? keys[index - 1];
    focusNext(neighbour ? focusId(neighbour) : addId, addId);
  }

  const moveFocus = (prefix: string, direction: Direction) =>
    focusNext(`${prefix}:${direction === -1 ? "up" : "down"}`, `${prefix}:${direction === -1 ? "down" : "up"}`);

  // ---- types
  const typeKeys = draft.types.map((type) => type.key);
  function addType() {
    focusNext(`type:n${draft.nextKey}:label`);
    change({ type: "addType" }, "types");
  }
  function removeType(key: string) {
    focusAfterRemoval(typeKeys, key, (other) => `type:${other}:label`, "add-type");
    setConfirming(null);
    change({ type: "removeType", key }, "types", `type:${key}`);
  }

  // ---- details
  const fieldKeys = draft.fields.map((field) => field.key);
  function addField() {
    focusNext(`field:n${draft.nextKey}:label`);
    change({ type: "addField" }, "fields");
  }
  function removeField(key: string) {
    focusAfterRemoval(fieldKeys, key, (other) => `field:${other}:label`, "add-field");
    setConfirming(null);
    change({ type: "removeField", key }, "fields");
  }
  function addChoice(field: EditorField) {
    focusNext(`choice:${field.key}:n${draft.nextKey}:label`);
    change({ type: "addChoice", fieldKey: field.key }, `field:${field.key}:options`);
  }
  function removeChoice(field: EditorField, choiceKey: string) {
    focusAfterRemoval(
      field.options.map((choice) => choice.key),
      choiceKey,
      (other) => `choice:${field.key}:${other}:label`,
      `add-choice:${field.key}`,
    );
    setConfirming(null);
    change(
      { type: "removeChoice", fieldKey: field.key, choiceKey },
      `field:${field.key}:options`,
      `field:${field.key}:option:${choiceKey}`,
    );
  }

  // ---- defaults and saving
  function applyDefaults() {
    setConfirming(null);
    setErrors({});
    setFormError(undefined);
    dispatch({ type: "replace", draft: defaultsDraft(saved.config, draft) });
    setNotice({ tone: "info", text: DEFAULTS_MESSAGE });
  }

  function showProblems(sent: EditorDraft, fieldErrors: Record<string, string>, general?: string) {
    const keyed = errorsByKey(sent, fieldErrors);
    setErrors(keyed);
    const hasFieldErrors = Object.keys(keyed).some((key) => key !== "form");
    setFormError(general ?? keyed.form ?? (hasFieldErrors ? FIX_MESSAGE : AUTH_MESSAGES.actionFailed));
    setNotice(undefined);
    setAttention((count) => count + 1);
  }

  async function save() {
    if (saving.current) return;
    const sending = draft;
    const body = toDraftFormConfig(sending);
    setConfirming(null);
    // The same rules the server applies, so a mistake shows at once; the server still decides.
    // New ids are made by a throwaway counter here (crypto.randomUUID is not there on every page).
    let made = 0;
    const checked = prepareConfigForSave(saved.config, body, () => `check${++made}`);
    if (!checked.ok) {
      showProblems(sending, checked.errors, checked.formError);
      return;
    }
    saving.current = true;
    setPending(true);
    setFormError(undefined);
    setNotice(undefined);
    try {
      const result = await action(groupId, body);
      if (!result.ok) {
        showProblems(sending, result.errors, result.formError);
        return;
      }
      const next = draftFromConfig(result.config);
      setSaved({ config: result.config, draft: next });
      // Nothing can be edited while a save is out (see the fieldset), but if the draft did change,
      // keep the changes: it takes the new ids and version and stays "not saved".
      dispatch({ type: "replace", draft: latest.current === sending ? next : rebaseDraft(latest.current, sending, result.config) });
      setErrors({});
      setFormError(undefined);
      setNotice({ tone: "success", text: SAVED_MESSAGE });
      setAttention((count) => count + 1);
    } catch (error) {
      // A redirect (the session ended) is the router's to follow.
      if (isNextControlFlow(error)) throw error;
      showProblems(sending, {}, AUTH_MESSAGES.actionFailed);
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  const typeBlocked = typeAddBlocked(draft);
  const fieldBlocked = fieldAddBlocked(draft);
  const feedback = formError ? (
    <FormMessage tone="error" title={formError} />
  ) : notice ? (
    <FormMessage tone={notice.tone} title={notice.text} />
  ) : null;

  return (
    <div ref={root} data-hydrated={hydrated ? "true" : undefined} className="flex max-w-xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p data-testid="fields-used" aria-live="polite" className="text-lg font-semibold">
          {fieldsUsedText(draft)}
        </p>
        <p className="text-sm text-muted-foreground">
          Title and Type always count. You can add up to {FORM_LIMITS.maxDetails} more details.
        </p>
      </div>

      <div className="flex flex-col gap-1 rounded-lg border bg-muted/50 p-3">
        <p className="font-medium">Title</p>
        <p className="text-sm text-muted-foreground">Always asked, and always required. It cannot be changed.</p>
      </div>

      {/* Nothing can be changed while a save is on its way, so what is saved is what was on the screen. */}
      <fieldset disabled={pending} className="contents">
        <section aria-labelledby={`${uid}-types`} className="flex flex-col gap-3">
          <h3 id={`${uid}-types`} className="text-lg font-semibold">
            Type options
          </h3>
          <p className="text-sm text-muted-foreground">
            Members pick one when they upload (Type is always asked and always required). Up to {FORM_LIMITS.maxTypes}, and Other is always
            added.
          </p>
          <ul aria-label="Type options" aria-describedby={errors.types ? `${uid}-types-error` : undefined} className="flex flex-col gap-3">
            {draft.types.map((type, index) => {
              const name = nameOf(type.label, `type ${index + 1}`);
              const errorId = `${uid}-${type.key}-error`;
              const error = errors[`type:${type.key}`];
              return (
                <li key={type.key} className="flex flex-col gap-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      data-focus={`type:${type.key}:label`}
                      aria-label={`Type option ${index + 1}`}
                      placeholder="Name of this type"
                      autoComplete="off"
                      maxLength={FORM_LIMITS.maxTypeLabel}
                      value={type.label}
                      onChange={(event) => change({ type: "renameType", key: type.key, label: event.target.value }, `type:${type.key}`)}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? errorId : undefined}
                      className={cn(inputClassName, "sm:flex-1")}
                    />
                    <RowButtons
                      name={name}
                      prefix={`type:${type.key}`}
                      first={index === 0}
                      last={index === draft.types.length - 1}
                      onMove={(direction) => {
                        moveFocus(`type:${type.key}`, direction);
                        change({ type: "moveType", key: type.key, direction });
                      }}
                      onRemove={() => (type.id === "" ? removeType(type.key) : askRemove(`type:${type.key}`))}
                    />
                  </div>
                  {error ? <FieldError id={errorId}>{error}</FieldError> : null}
                  {confirming === `type:${type.key}` ? (
                    <RemoveConfirm
                      name={name}
                      prefix={`type:${type.key}`}
                      onConfirm={() => removeType(type.key)}
                      onCancel={() => cancelRemove(`type:${type.key}`)}
                    />
                  ) : null}
                </li>
              );
            })}
            <li className="flex min-h-11 items-center rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
              Other: members say what it is. Always added.
            </li>
          </ul>
          {errors.types ? <FieldError id={`${uid}-types-error`}>{errors.types}</FieldError> : null}
          <AddButton focusId="add-type" blocked={typeBlocked} reasonId={`${uid}-type-limit`} onClick={addType}>
            Add a type
          </AddButton>
        </section>

        <section aria-labelledby={`${uid}-details`} className="flex flex-col gap-3">
          <h3 id={`${uid}-details`} className="text-lg font-semibold">
            Extra details
          </h3>
          <p className="text-sm text-muted-foreground">
            Things members fill in besides the title and type, like Subject or Semester. Up to {FORM_LIMITS.maxDetails}.
          </p>
          <ul
            aria-label="Extra details"
            aria-describedby={errors.fields ? `${uid}-fields-error` : undefined}
            className="flex flex-col gap-4"
          >
            {draft.fields.map((field, index) => (
              <li key={field.key}>
                <div
                  role="group"
                  aria-labelledby={`${uid}-${field.key}-heading`}
                  className="flex flex-col gap-4 rounded-xl border bg-card p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 id={`${uid}-${field.key}-heading`} className="text-base font-semibold">
                      Detail {index + 1}
                    </h4>
                    <RowButtons
                      name={nameOf(field.label, `detail ${index + 1}`)}
                      prefix={`field:${field.key}`}
                      first={index === 0}
                      last={index === draft.fields.length - 1}
                      onMove={(direction) => {
                        moveFocus(`field:${field.key}`, direction);
                        change({ type: "moveField", key: field.key, direction });
                      }}
                      onRemove={() => (field.id === "" ? removeField(field.key) : askRemove(`field:${field.key}`))}
                      removeText="Remove"
                    />
                  </div>
                  {confirming === `field:${field.key}` ? (
                    <RemoveConfirm
                      name={nameOf(field.label, `detail ${index + 1}`)}
                      prefix={`field:${field.key}`}
                      onConfirm={() => removeField(field.key)}
                      onCancel={() => cancelRemove(`field:${field.key}`)}
                    />
                  ) : null}
                  <DetailCard
                    uid={uid}
                    field={field}
                    number={index + 1}
                    errors={errors}
                    confirming={confirming}
                    onChange={change}
                    onAddChoice={() => addChoice(field)}
                    onRemoveChoice={(choiceKey) => removeChoice(field, choiceKey)}
                    onAskRemoveChoice={(choiceKey) => askRemove(`choice:${field.key}:${choiceKey}`)}
                    onCancelRemoveChoice={(choiceKey) => cancelRemove(`choice:${field.key}:${choiceKey}`)}
                    onFocus={focusNext}
                  />
                </div>
              </li>
            ))}
          </ul>
          {errors.fields ? <FieldError id={`${uid}-fields-error`}>{errors.fields}</FieldError> : null}
          <AddButton focusId="add-field" blocked={fieldBlocked} reasonId={`${uid}-field-limit`} onClick={addField}>
            Add a detail
          </AddButton>
        </section>
      </fieldset>

      <FormPreview draft={draft} />

      <section aria-label="Save" className="flex flex-col gap-3">
        {/* Focused after a save or a refused save, so screen readers start from the result. */}
        <div ref={message} tabIndex={-1} className="flex flex-col gap-3 outline-none empty:hidden">
          {feedback}
        </div>
        {dirty ? (
          <p role="status" className="text-sm font-medium">
            You have changes that are not saved.
          </p>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="button" onClick={save} disabled={pending} className="h-11 gap-2 px-6 text-base sm:w-auto">
            {pending ? (
              <>
                <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
          <Button type="button" variant="outline" onClick={applyDefaults} disabled={pending} className="h-11 px-5 text-base sm:w-auto">
            Use these defaults
          </Button>
        </div>
        <FieldHint id={`${uid}-defaults-hint`}>
          &quot;Use these defaults&quot; only fills in the form above (Notes, Previous year paper, Study material, Assignment and an
          optional Subject). You can still change it, and nothing is saved until you choose Save.
        </FieldHint>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Pieces

/** Move up, move down and remove, each at least 44px, named after the row they belong to. */
function RowButtons({
  name,
  prefix,
  first,
  last,
  onMove,
  onRemove,
  removeText,
}: {
  name: string;
  prefix: string;
  first: boolean;
  last: boolean;
  onMove: (direction: Direction) => void;
  onRemove: () => void;
  /** Shows a word beside the bin (for a whole card). */
  removeText?: string;
}) {
  return (
    <div className="flex gap-2">
      <Button
        type="button"
        variant="outline"
        data-focus={`${prefix}:up`}
        aria-label={`Move ${name} up`}
        disabled={first}
        onClick={() => onMove(-1)}
        className="h-11 w-11 px-0"
      >
        <ArrowUp aria-hidden="true" className="size-5" />
      </Button>
      <Button
        type="button"
        variant="outline"
        data-focus={`${prefix}:down`}
        aria-label={`Move ${name} down`}
        disabled={last}
        onClick={() => onMove(1)}
        className="h-11 w-11 px-0"
      >
        <ArrowDown aria-hidden="true" className="size-5" />
      </Button>
      <Button
        type="button"
        variant="outline"
        data-focus={`${prefix}:remove`}
        aria-label={`Remove ${name}`}
        onClick={onRemove}
        className={cn("h-11 gap-2", removeText ? "px-3 text-base" : "w-11 px-0")}
      >
        <Trash2 aria-hidden="true" className="size-5" />
        {removeText}
      </Button>
    </div>
  );
}

/** Asks before removing something the saved form has; Cancel takes the focus so a held Enter cannot remove it. */
function RemoveConfirm({
  name,
  prefix,
  onConfirm,
  onCancel,
}: {
  name: string;
  prefix: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={`${id}-note`} className="flex flex-col gap-3 rounded-lg border bg-muted p-3">
      <p id={`${id}-note`} className="text-sm font-medium">
        Remove {name}? {REMOVE_NOTE}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          onClick={onConfirm}
          className="h-auto min-h-11 bg-destructive py-2 text-base whitespace-normal text-background [overflow-wrap:anywhere] hover:bg-destructive/90"
        >
          Yes, remove {name}
        </Button>
        <Button type="button" variant="outline" data-focus={`${prefix}:cancel`} onClick={onCancel} className="h-11 px-5 text-base">
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** An Add button that is disabled at its limit and says why in words next to it. */
function AddButton({
  focusId,
  blocked,
  reasonId,
  onClick,
  children,
}: {
  focusId: string;
  blocked: string | null;
  reasonId: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        variant="outline"
        data-focus={focusId}
        disabled={blocked !== null}
        aria-describedby={blocked ? reasonId : undefined}
        onClick={onClick}
        className="h-11 gap-2 self-start px-4 text-base"
      >
        <Plus aria-hidden="true" className="size-5" />
        {children}
      </Button>
      {blocked ? <FieldHint id={reasonId}>{blocked}</FieldHint> : null}
    </div>
  );
}

/** One extra detail: its name, kind, whether it is required, and (for a dropdown) its choices. */
function DetailCard({
  uid,
  field,
  number,
  errors,
  confirming,
  onChange,
  onAddChoice,
  onRemoveChoice,
  onAskRemoveChoice,
  onCancelRemoveChoice,
  onFocus,
}: {
  uid: string;
  field: EditorField;
  number: number;
  errors: Record<string, string>;
  confirming: string | null;
  onChange: (action: EditorAction, ...forgetErrors: string[]) => void;
  onAddChoice: () => void;
  onRemoveChoice: (choiceKey: string) => void;
  onAskRemoveChoice: (choiceKey: string) => void;
  onCancelRemoveChoice: (choiceKey: string) => void;
  onFocus: (id: string, fallback?: string) => void;
}) {
  const base = `${uid}-${field.key}`;
  const labelError = errors[`field:${field.key}:label`];
  const optionsError = errors[`field:${field.key}:options`];
  const choiceBlocked = field.kind === "dropdown" ? choiceAddBlocked(field) : null;
  const fieldName = nameOf(field.label, `detail ${number}`);

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${base}-label`} className="text-sm font-medium">
          Name
        </label>
        <input
          id={`${base}-label`}
          data-focus={`field:${field.key}:label`}
          aria-label={`Name of detail ${number}`}
          placeholder="For example, Subject or Semester"
          autoComplete="off"
          maxLength={FORM_LIMITS.maxDetailLabel}
          value={field.label}
          onChange={(event) => onChange({ type: "renameField", key: field.key, label: event.target.value }, `field:${field.key}:label`)}
          aria-invalid={labelError ? true : undefined}
          aria-describedby={describedBy(`${base}-label`, undefined, labelError)}
          className={inputClassName}
        />
        {labelError ? <FieldError id={`${base}-label-error`}>{labelError}</FieldError> : null}
      </div>

      {field.id === "" ? (
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium">Kind</legend>
          {(
            [
              { kind: "text", title: "Short text", note: "Members type their answer." },
              { kind: "dropdown", title: "Dropdown", note: "Members pick from choices you write." },
            ] as const
          ).map((option) => (
            <label
              key={option.kind}
              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 has-checked:border-foreground has-checked:bg-muted"
            >
              <input
                type="radio"
                name={`${base}-kind`}
                checked={field.kind === option.kind}
                onChange={() => onChange({ type: "setKind", key: field.key, kind: option.kind }, `field:${field.key}:options`)}
                className="mt-0.5 size-5 shrink-0 cursor-pointer accent-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-base font-medium">{option.title}</span>
                <span className="text-sm text-muted-foreground">{option.note}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : (
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium">Kind</p>
          <p className="text-base">{field.kind === "dropdown" ? "Dropdown" : "Short text"}</p>
          <p className="text-sm text-muted-foreground">The kind cannot be changed. To change it, remove this detail and add a new one.</p>
        </div>
      )}

      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 has-checked:border-foreground has-checked:bg-muted">
        <input
          type="checkbox"
          role="switch"
          checked={field.required}
          onChange={(event) => onChange({ type: "setRequired", key: field.key, required: event.target.checked })}
          className="size-5 shrink-0 cursor-pointer accent-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <span className="flex min-w-0 flex-col">
          <span className="text-base font-medium">Required</span>
          <span className="text-sm text-muted-foreground">
            {field.required ? "Members must fill this in." : "Members can leave this empty."}
          </span>
        </span>
      </label>

      {field.kind === "dropdown" ? (
        <div role="group" aria-labelledby={`${base}-choices`} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <p id={`${base}-choices`} className="text-sm font-medium">
              Choices for {fieldName}
            </p>
            <FieldHint id={`${base}-choices-hint`}>
              {FORM_LIMITS.minChoices} to {FORM_LIMITS.maxChoices} choices.
            </FieldHint>
          </div>
          <ul
            aria-label={`Choices for ${fieldName}`}
            aria-describedby={optionsError ? `${base}-options-error` : undefined}
            className="flex flex-col gap-3"
          >
            {field.options.map((choice, index) => {
              const error = errors[`field:${field.key}:option:${choice.key}`];
              const errorId = `${base}-${choice.key}-error`;
              const prefix = `choice:${field.key}:${choice.key}`;
              const name = nameOf(choice.label, `choice ${index + 1}`);
              return (
                <li key={choice.key} className="flex flex-col gap-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      data-focus={`${prefix}:label`}
                      aria-label={`Choice ${index + 1} of ${fieldName}`}
                      placeholder="Name of this choice"
                      autoComplete="off"
                      maxLength={FORM_LIMITS.maxChoiceLabel}
                      value={choice.label}
                      onChange={(event) =>
                        onChange(
                          { type: "renameChoice", fieldKey: field.key, choiceKey: choice.key, label: event.target.value },
                          `field:${field.key}:option:${choice.key}`,
                        )
                      }
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? errorId : undefined}
                      className={cn(inputClassName, "sm:flex-1")}
                    />
                    <RowButtons
                      name={`${name} in ${fieldName}`}
                      prefix={prefix}
                      first={index === 0}
                      last={index === field.options.length - 1}
                      onMove={(direction) => {
                        onFocus(`${prefix}:${direction === -1 ? "up" : "down"}`, `${prefix}:${direction === -1 ? "down" : "up"}`);
                        onChange({ type: "moveChoice", fieldKey: field.key, choiceKey: choice.key, direction });
                      }}
                      onRemove={() => (choice.id === "" ? onRemoveChoice(choice.key) : onAskRemoveChoice(choice.key))}
                    />
                  </div>
                  {error ? <FieldError id={errorId}>{error}</FieldError> : null}
                  {confirming === `choice:${field.key}:${choice.key}` ? (
                    <RemoveConfirm
                      name={`${name} from ${fieldName}`}
                      prefix={prefix}
                      onConfirm={() => onRemoveChoice(choice.key)}
                      onCancel={() => onCancelRemoveChoice(choice.key)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
          {optionsError ? <FieldError id={`${base}-options-error`}>{optionsError}</FieldError> : null}
          <AddButton focusId={`add-choice:${field.key}`} blocked={choiceBlocked} reasonId={`${base}-choice-limit`} onClick={onAddChoice}>
            Add a choice
          </AddButton>
        </div>
      ) : null}
    </>
  );
}

/**
 * What the member's upload form will look like, built from the draft with the same field components
 * the upload form uses. It is not a form: nothing is sent. Text boxes are switched off; the Type and
 * dropdown selects can be opened to look at the choices (what is picked here is not kept anywhere).
 */
function FormPreview({ draft }: { draft: EditorDraft }) {
  const uid = useId();
  const config = useMemo(() => previewConfig(draft), [draft]);
  const types = useMemo(() => typeChoices(config), [config]);
  const specs = useMemo(() => detailInputs(config), [config]);
  const [picked, setPicked] = useState("");
  const typeId = types.some((type) => type.id === picked) ? picked : (types[0]?.id ?? OTHER_TYPE_ID);

  return (
    <section aria-labelledby={`${uid}-heading`} className="flex flex-col gap-3">
      <h3 id={`${uid}-heading`} className="text-lg font-semibold">
        What members will see
      </h3>
      <p className="text-sm text-muted-foreground">A preview of the upload form. It is only for looking: nothing here is sent.</p>
      <div data-testid="form-preview" className="flex flex-col gap-5 rounded-xl border bg-card p-4">
        <fieldset disabled className="contents">
          <TextField label="Title" name="preview-title" id={`${uid}-title`} autoComplete="off" />
        </fieldset>
        <TypeSelect id={`${uid}-type`} types={types} value={typeId} onChange={(event) => setPicked(event.target.value)} />
        {typeId === OTHER_TYPE_ID ? (
          <fieldset disabled className="contents">
            <OtherTextField id={`${uid}-other`} />
          </fieldset>
        ) : null}
        {specs.map((spec, index) => (
          <fieldset key={`${spec.id}-${spec.kind}`} disabled={spec.kind === "text"} className="contents">
            <DetailInput id={`${uid}-detail-${index}`} spec={spec} />
          </fieldset>
        ))}
      </div>
    </section>
  );
}
