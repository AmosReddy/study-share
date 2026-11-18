"use client";

import { useId, type ChangeEvent } from "react";
import { describedBy, FieldError, inputClassName, TextField } from "@/client/components/auth/text-field";
import { cn } from "@/client/lib/utils";
import type { TypeChoice } from "./type-choices";

type TypeSelectProps = {
  id: string;
  /** The form field's name (the upload form is not a native form post, so it may leave this out). */
  name?: string;
  types: TypeChoice[];
  value?: string;
  defaultValue?: string;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  error?: string;
};

/** "Type": the group's kinds of file, as a native select (phones show their own picker). */
export function TypeSelect({ id, name = "type", types, value, defaultValue, onChange, error }: TypeSelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        Type
      </label>
      <select
        id={id}
        name={name}
        {...(value !== undefined ? { value } : { defaultValue: defaultValue ?? types[0]?.id })}
        onChange={onChange}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, undefined, error)}
        className={cn(inputClassName, "pr-8")}
      >
        {types.map((type) => (
          <option key={type.id} value={type.id}>
            {type.label}
          </option>
        ))}
      </select>
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}

type OtherTextFieldProps = {
  id: string;
  value?: string;
  defaultValue?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  error?: string;
};

/** "What kind of file is it?": shown when the Type is Other. */
export function OtherTextField({ id, value, defaultValue, onChange, error }: OtherTextFieldProps) {
  return (
    <TextField
      label="What kind of file is it?"
      name="typeOther"
      id={id}
      autoComplete="off"
      {...(value !== undefined ? { value } : { defaultValue: defaultValue ?? "" })}
      onChange={onChange}
      error={error}
    />
  );
}

type SubjectFieldProps = {
  id: string;
  /** Subjects the group already uses, offered as suggestions while typing. */
  suggestions: string[];
  value?: string;
  defaultValue?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  error?: string;
};

/** "Subject (optional)": free text, with the group's existing subjects as suggestions. */
export function SubjectField({ id, suggestions, value, defaultValue, onChange, error }: SubjectFieldProps) {
  const listId = `${useId()}-subjects`;
  return (
    <>
      <TextField
        label="Subject (optional)"
        name="subject"
        id={id}
        autoComplete="off"
        list={listId}
        {...(value !== undefined ? { value } : { defaultValue: defaultValue ?? "" })}
        onChange={onChange}
        error={error}
        hint="For example Physics or Maths. Pick one the group already uses to keep the library tidy."
      />
      <datalist id={listId}>
        {suggestions.map((subject) => (
          <option key={subject} value={subject} />
        ))}
      </datalist>
    </>
  );
}
