"use client";

import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { ErrorAnnouncer } from "@/client/components/auth/error-announcer";
import { FormMessage } from "@/client/components/auth/form-message";
import { SubmitButton } from "@/client/components/auth/submit-button";
import { TextField } from "@/client/components/auth/text-field";
import { useAuthForm } from "@/client/components/auth/use-auth-form";
import { FILE_MESSAGES } from "@/shared/file-messages";
import { OTHER_TYPE_ID, validateAnswers, type FormConfig } from "@/shared/form-config";
import type { FormAction } from "@/shared/form-state";
import { DetailInput, OtherTextField, TypeSelect } from "./file-fields";
import { detailInputs, hasUnshownDetailError, typeChoices } from "./form-inputs";

type EditFileFormProps = {
  groupId: string;
  fileId: string;
  title: string;
  typeId: string;
  typeOther: string;
  /** The file's detail values (a text detail's text, or a dropdown's choice id), by detail id. */
  details: { fieldId: string; value: string }[];
  /** The group's upload form: the Type select and the extra details are built from it. */
  config: FormConfig;
  /** Values the group already uses for each text detail (detail id to values), offered while typing. */
  suggestions: Record<string, string[]>;
  action: FormAction;
};

/**
 * Title, type and details of one file, for the person who uploaded it, built from the group's form
 * like the upload form. A type or choice that was removed from the form but is what this file holds
 * stays selected, marked "(removed)". The answers are checked in the browser first with the server's
 * own function (validateAnswers, told what the file holds now, so what is unchanged always passes);
 * the server still decides, and its errors show next to the right field.
 */
export function EditFileForm({ groupId, fileId, title, typeId, typeOther, details, config, suggestions, action }: EditFileFormProps) {
  const { state, formAction, pending, formRef, announcerRef, onSubmit } = useAuthForm(action);
  const values = state.values ?? {};
  // Unique in the document: Next keeps pages the person left, so another copy can be in the DOM.
  const uid = useId();

  const current = useMemo(() => Object.fromEntries(details.map((detail) => [detail.fieldId, detail.value])), [details]);
  const types = useMemo(() => typeChoices(config, typeId), [config, typeId]);
  const specs = useMemo(() => detailInputs(config, current, suggestions), [config, current, suggestions]);

  const [chosenTitle, setChosenTitle] = useState(values.title ?? title);
  const [chosenType, setChosenType] = useState(values.type ?? typeId);
  const [chosenOther, setChosenOther] = useState(values.typeOther ?? typeOther);
  const [chosenDetails, setChosenDetails] = useState<Record<string, string>>(() =>
    Object.fromEntries(specs.map((spec) => [spec.id, values[`d_${spec.id}`] ?? current[spec.id] ?? ""])),
  );
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  // Counts refused tries, so the first invalid field is focused after each one.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (attempt === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt, formRef]);

  const serverErrors = state.fieldErrors ?? {};
  const errors = Object.keys(clientErrors).length > 0 ? clientErrors : serverErrors;
  const formError = state.formError ?? (hasUnshownDetailError(serverErrors, specs) ? FILE_MESSAGES.formChanged : undefined);

  function onCheckedSubmit(event: FormEvent<HTMLFormElement>) {
    const found: Record<string, string> = {};
    if (chosenTitle.trim() === "") found.title = FILE_MESSAGES.titleRequired;
    const checked = validateAnswers(
      config,
      {
        typeId: chosenType,
        typeOther: chosenType === OTHER_TYPE_ID ? chosenOther : "",
        details: Object.fromEntries(specs.map((spec) => [spec.id, chosenDetails[spec.id] ?? ""])),
      },
      { typeId, typeOther, details: current },
    );
    if (!checked.ok) Object.assign(found, checked.errors);
    if (Object.keys(found).length > 0) {
      event.preventDefault();
      setClientErrors(found);
      setAttempt((count) => count + 1);
      return;
    }
    setClientErrors({});
    onSubmit(event);
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={onCheckedSubmit} noValidate className="flex max-w-xl flex-col gap-5">
      <ErrorAnnouncer announcerRef={announcerRef} />
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="fileId" value={fileId} />
      {formError ? <FormMessage tone="error" title={formError} /> : null}
      {state.status === "done" && state.notice ? <FormMessage tone="success" title={state.notice} /> : null}
      <TextField
        label="Title"
        name="title"
        id={`${uid}-title`}
        autoComplete="off"
        value={chosenTitle}
        onChange={(event) => setChosenTitle(event.target.value)}
        error={errors.title}
      />
      <TypeSelect
        id={`${uid}-type`}
        types={types}
        value={chosenType}
        onChange={(event) => setChosenType(event.target.value)}
        error={errors.type}
      />
      {chosenType === OTHER_TYPE_ID ? (
        <OtherTextField id={`${uid}-other`} value={chosenOther} onChange={(event) => setChosenOther(event.target.value)} error={errors.typeOther} />
      ) : null}
      {specs.map((spec, index) => (
        <DetailInput
          key={spec.id}
          id={`${uid}-detail-${index}`}
          spec={spec}
          value={chosenDetails[spec.id] ?? ""}
          onChange={(value) => setChosenDetails((previous) => ({ ...previous, [spec.id]: value }))}
          error={errors[`detail:${spec.id}`]}
        />
      ))}
      <SubmitButton pending={pending} pendingLabel="Saving…" className="sm:w-auto sm:self-start sm:px-5">
        Save details
      </SubmitButton>
    </form>
  );
}
