"use client";

import { useId } from "react";
import { ErrorAnnouncer } from "@/client/components/auth/error-announcer";
import { FormMessage } from "@/client/components/auth/form-message";
import { SubmitButton } from "@/client/components/auth/submit-button";
import { TextField } from "@/client/components/auth/text-field";
import { useAuthForm } from "@/client/components/auth/use-auth-form";
import type { FormAction } from "@/shared/form-state";
import type { ResourceType } from "@/shared/resources";
import { SubjectField, TypeSelect } from "./file-fields";

type EditFileFormProps = {
  groupId: string;
  fileId: string;
  title: string;
  subject: string;
  type: ResourceType;
  /** Subjects the group already uses, offered while typing. */
  subjects: string[];
  action: FormAction;
};

/** Title, type and subject of one file, for the person who uploaded it. */
export function EditFileForm({ groupId, fileId, title, subject, type, subjects, action }: EditFileFormProps) {
  const { state, formAction, pending, formRef, announcerRef, onSubmit } = useAuthForm(action);
  const values = state.values ?? {};
  const errors = state.fieldErrors ?? {};
  // Unique in the document: Next keeps pages the person left, so another copy can be in the DOM.
  const uid = useId();

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="flex max-w-xl flex-col gap-5">
      <ErrorAnnouncer announcerRef={announcerRef} />
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="fileId" value={fileId} />
      {state.formError ? <FormMessage tone="error" title={state.formError} /> : null}
      {state.status === "done" && state.notice ? <FormMessage tone="success" title={state.notice} /> : null}
      <TextField
        label="Title"
        name="title"
        id={`${uid}-title`}
        autoComplete="off"
        defaultValue={values.title ?? title}
        error={errors.title}
      />
      <TypeSelect id={`${uid}-type`} defaultValue={values.type ?? type} error={errors.type} />
      <SubjectField id={`${uid}-subject`} suggestions={subjects} defaultValue={values.subject ?? subject} error={errors.subject} />
      <SubmitButton pending={pending} pendingLabel="Saving…" className="sm:w-auto sm:self-start sm:px-5">
        Save details
      </SubmitButton>
    </form>
  );
}
